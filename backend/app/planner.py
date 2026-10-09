"""The monthly contribution plan: pure arithmetic, no I/O, no Claude, no broker.

Everything is in EUR and `Decimal`. Weights and gaps are computed on the pool of items that have a
target (an item without a target is outside the pool). See the design spec for the rules.
"""

from dataclasses import dataclass, field
from decimal import ROUND_FLOOR, ROUND_HALF_EVEN, Decimal

ZERO = Decimal(0)
CENT = Decimal("0.01")
SHARE_PLACES = Decimal("0.001")
FAVOUR_FACTOR = Decimal("1.25")
MIN_LINE_EUR = Decimal("25")
EXCLUDING_CALLS = frozenset({"TRIM", "SELL"})
FAVOURING_CALLS = frozenset({"ADD", "BUY"})


@dataclass(frozen=True)
class Candidate:
    ticker: str
    name: str
    held: bool  # open position (shares > 0); a watchlist item or a closed position is not held
    current_value: Decimal  # EUR, 0 when not held
    target: Decimal | None
    price_eur: Decimal
    currency: str
    rate: Decimal  # EUR per 1 unit of the quote currency (1 for EUR)
    call: str | None = None  # action of the newest PENDING recommendation, if any


@dataclass(frozen=True)
class PlanLine:
    ticker: str
    name: str
    amount_eur: Decimal
    shares: Decimal
    price_eur: Decimal
    currency: str
    rate: Decimal
    weight_before: Decimal | None
    weight_after: Decimal | None
    reason: str  # "new_position" | "favoured" | "underweight" | "remainder"
    target_weight: Decimal  # the target after normalising the pool's targets to add up to 1


@dataclass(frozen=True)
class LeftOut:
    ticker: str
    name: str
    kind: str  # see LeftOut in frontend/lib/plans.ts
    reason: str


@dataclass(frozen=True)
class Plan:
    lines: list[PlanLine]
    notes: list[str]
    total_before: Decimal  # EUR value of the pool before the contribution
    leftover: Decimal  # part of the contribution no line uses
    left_out: list[LeftOut] = field(default_factory=list)  # tickers excluded or dropped, and why


@dataclass(frozen=True)
class DriftItem:
    ticker: str
    name: str
    weight: Decimal
    target: Decimal
    points: Decimal  # weight minus target, in percentage points


def _targeted(candidates: list[Candidate]) -> list[tuple[Candidate, Decimal]]:
    """Each candidate that has a target above zero, with that target."""
    return [(c, c.target) for c in candidates if c.target is not None and c.target > ZERO]


def _round_to_total(raw: dict[str, Decimal], total: Decimal) -> dict[str, Decimal]:
    """Whole cents that add up to `total`: floor each, then hand the missing cents to the largest
    fractions (ties: larger amount, then ticker)."""
    floors = {k: int((v * 100).to_integral_value(rounding=ROUND_FLOOR)) for k, v in raw.items()}
    missing = int((total * 100).to_integral_value()) - sum(floors.values())
    order = sorted(raw, key=lambda k: (raw[k] * 100 - floors[k], raw[k], k), reverse=True)
    for ticker in order[: max(missing, 0)]:
        floors[ticker] += 1
    return {k: (Decimal(c) / 100).quantize(CENT) for k, c in floors.items()}


def _merge_small(raw: dict[str, Decimal]) -> dict[str, Decimal]:
    """Lines under MIN_LINE_EUR join the largest line, so nobody is told to buy 3 EUR of a stock."""
    big = {k: v for k, v in raw.items() if v >= MIN_LINE_EUR}
    small = sum((v for k, v in raw.items() if k not in big), ZERO)
    if small == ZERO:
        return raw
    pool = big or raw
    top = max(pool, key=lambda k: (pool[k], k))
    if not big:
        return {top: sum(raw.values(), ZERO)}
    big[top] += small
    return big


def build_plan(candidates: list[Candidate], amount: Decimal, *, whole_shares: bool = False) -> Plan:
    amount = amount.quantize(CENT, ROUND_FLOOR)  # whole cents only, so the lines can add up exactly
    targeted = _targeted(candidates)
    pool_before = sum((c.current_value for c, _ in targeted), ZERO)
    if amount <= ZERO:
        return Plan([], ["The contribution must be more than zero."], pool_before, ZERO)
    if not targeted:
        return Plan(
            [], ["No holding or watchlist item has a target weight yet."], pool_before, amount
        )

    notes: list[str] = []
    left_out: list[LeftOut] = []
    total_target = sum((t for _, t in targeted), ZERO)
    weight = {c.ticker: t / total_target for c, t in targeted}
    pool = pool_before + amount

    eligible = []
    for c in sorted((c for c, _ in targeted), key=lambda c: c.ticker):
        if not c.price_eur.is_finite() or c.price_eur <= ZERO:
            left_out.append(LeftOut(c.ticker, c.name, "unusable_price", "Its price is not usable."))
        elif c.call in EXCLUDING_CALLS:
            left_out.append(
                LeftOut(c.ticker, c.name, "excluded_call", f"Its newest pending call is {c.call}.")
            )
        else:
            eligible.append(c)
    if not eligible:
        notes.append("Every ticker with a target is excluded or unpriced, so nothing is proposed.")
        return Plan([], notes, pool_before, amount, left_out)

    gap: dict[str, Decimal] = {}
    for c in eligible:
        g = max(weight[c.ticker] * pool - c.current_value, ZERO)
        gap[c.ticker] = g * FAVOUR_FACTOR if c.call in FAVOURING_CALLS else g
    gap_sum = sum(gap.values(), ZERO)
    if gap_sum >= amount:
        raw = {t: amount * g / gap_sum for t, g in gap.items() if g > ZERO}
    else:  # fill every gap, then share the rest by target weight
        weight_sum = sum((weight[c.ticker] for c in eligible), ZERO)
        rest = amount - gap_sum
        raw = {c.ticker: gap[c.ticker] + rest * weight[c.ticker] / weight_sum for c in eligible}

    cents = _round_to_total(_merge_small(raw), amount)
    by_ticker = {c.ticker: c for c in eligible}
    drafts: list[tuple[Candidate, Decimal, Decimal]] = []
    for ticker, cash in sorted(cents.items(), key=lambda kv: (-kv[1], kv[0])):
        c = by_ticker[ticker]
        if whole_shares:
            shares = (cash / c.price_eur).to_integral_value(rounding=ROUND_FLOOR)
            if shares <= ZERO:
                left_out.append(
                    LeftOut(
                        ticker,
                        c.name,
                        "too_small",
                        f"{cash} EUR is less than one share ({c.price_eur:.2f} EUR).",
                    )
                )
                continue
            cash = (shares * c.price_eur).quantize(CENT, ROUND_HALF_EVEN)
        else:
            shares = (cash / c.price_eur).quantize(SHARE_PLACES, ROUND_HALF_EVEN)
        drafts.append((c, cash, shares))

    spent = sum((cash for _, cash, _ in drafts), ZERO)
    total_after = pool_before + spent
    lines = []
    for c, cash, shares in drafts:
        if gap[c.ticker] == ZERO:
            reason = "remainder"
        elif not c.held:
            reason = "new_position"
        elif c.call in FAVOURING_CALLS:
            reason = "favoured"
        else:
            reason = "underweight"
        lines.append(
            PlanLine(
                ticker=c.ticker,
                name=c.name,
                amount_eur=cash,
                shares=shares,
                price_eur=c.price_eur,
                currency=c.currency,
                rate=c.rate,
                weight_before=c.current_value / pool_before if pool_before > ZERO else None,
                weight_after=(c.current_value + cash) / total_after if total_after > ZERO else None,
                reason=reason,
                target_weight=weight[c.ticker],
            )
        )
    return Plan(lines, notes, pool_before, amount - spent, left_out)


def drift_items(candidates: list[Candidate], threshold_points: Decimal) -> list[DriftItem]:
    """Open holdings with a target whose weight is at least `threshold_points` away from it (both
    weights taken within the pool of such holdings)."""
    held = [(c, t) for c, t in _targeted(candidates) if c.held and c.current_value > ZERO]
    pool = sum((c.current_value for c, _ in held), ZERO)
    if pool <= ZERO:
        return []
    total_target = sum((t for _, t in held), ZERO)
    items = []
    for c, target in held:
        weight_now = c.current_value / pool
        weight_target = target / total_target
        points = (weight_now - weight_target) * 100
        if abs(points) >= threshold_points:
            items.append(DriftItem(c.ticker, c.name, weight_now, weight_target, points))
    return sorted(items, key=lambda i: (-abs(i.points), i.ticker))
