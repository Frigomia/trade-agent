"""Whether an ETF can be recommended at all, and whether it passes the quality filter (spec:
"Eligibility (ETF lane)" and "Quality filter").

Pure rules, no network. The first failure wins and is recorded as an `Exclusion` with a plain
explanation. Keeping only the cheapest of several near-copy candidates is the shortlist's job.
"""

import math
import re
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal

from app.analysis.discovery_score import fit_dimension
from app.analysis.portfolio import (
    Histories,
    ReturnSeries,
    clean_history,
    log_returns,
    marginal_effect,
    pairwise_correlation,
)
from app.discovery.risk import build_risk_profile, market_cap_to_eur
from app.discovery.screen import PRICE_DATE_UNCERTAIN_PREFIX
from app.discovery.snapshot import Freshness, SymbolSnapshot, etf_coverage_of
from app.fx import SUPPORTED
from app.schemas_discovery import CandidateMetrics, Exclusion, PortfolioExposure

ETF_SLOTS = 3
ETF_MAX_EXPENSE_RATIO = 0.005  # a fraction: 0.50% a year, proposed
ETF_MIN_SIZE_EUR = 100_000_000.0  # proposed
# A one-year fetch returns about 251 to 253 sessions; the margin keeps a few missing days from
# excluding a healthy fund, and the fit step only needs 60 of them.
ETF_MIN_CLOSES = 200
# Must equal `analysis.portfolio.MIN_RETURNS`: the fit step needs this many intervals shared by
# the candidate and every holding, and a fund below it could never be scored (a test checks it).
ETF_MIN_SHARED_INTERVALS = 60
ETF_NEAR_COPY_CORRELATION = 0.95
ETF_MIN_HOLDINGS = 2
ETF_LANE_SKIPPED = "ETF ideas need at least two holdings with price history"
ETF_LANE_NEEDS_HISTORY = "ETF ideas need price history for every holding"
ETF_LANE_UNAVAILABLE = "ETF ideas were unavailable in this scan"

# Lowercase tokens tested against the fund's name and category (leveraged, inverse and other trading
# funds are out). A bare "short" is deliberately not a marker: "Short Duration" and "Ultrashort
# Bond" are ordinary bond funds, exactly the low-correlation ideas the lane exists to find.
LEVERAGED_MARKERS = (
    "-1x",
    "leveraged",
    "leverage shares",
    "inverse",
    "short daily",
    "daily short",
    "shortdax",
    "trading--",  # Morningstar's category prefix for leveraged and inverse funds
)

# 2x, 3x, 5x, x2, x3 and x5 as whole tokens: "STOXX50" and "ESTX50" hold "x5" but are index names.
LEVERAGE_FACTOR = re.compile(r"(?<![a-z])x[235](?!\d)|[235]x(?![a-z0-9])")

ExcludedFor = Literal[
    "not_ucits",
    "unreliable_price",
    "currency_unsupported",
    "insufficient_data",
    "fails_quality_filter",
    "overlaps_holding",
]


def fund_size_eur(snap: SymbolSnapshot, rates: Mapping[str, Decimal]) -> float | None:
    """The fund's size in EUR: the universe file's figure when there is one, else Yahoo's total
    assets converted from the quote currency (assumed to be the currency of `totalAssets`, in the
    major unit even for a pence quote, as Yahoo does for market cap). None when unknown."""
    override = snap.metrics.get("fundSizeEur")
    if override is not None and math.isfinite(override) and override > 0:
        return override
    return market_cap_to_eur(snap.metrics.get("totalAssets"), snap.currency or "", dict(rates))


def _shared_intervals(series: list[ReturnSeries]) -> int:
    """How many return intervals every series has, counted as `analysis.portfolio` aligns them."""
    shared = set(series[0])
    for values in series[1:]:
        shared.intersection_update(values)
    return sum(all(math.isfinite(values[key]) for values in series) for key in shared)


def _is_leveraged(snap: SymbolSnapshot) -> bool:
    text = f"{snap.name} {snap.category or ''}".lower()
    return bool(LEVERAGE_FACTOR.search(text)) or any(m in text for m in LEVERAGED_MARKERS)


def _is_near_copy(
    category_a: str | None, category_b: str | None, returns_a: ReturnSeries, returns_b: ReturnSeries
) -> bool:
    """The one near-copy rule, for held ETFs and for rival candidates alike.

    The same category and a correlation at or above the limit make a copy. When either category is
    unknown the correlation alone decides: a missing category cannot prove two funds differ.
    """
    if category_a and category_b and category_a.casefold() != category_b.casefold():
        return False
    correlation = pairwise_correlation(returns_a, returns_b)
    return correlation is not None and correlation >= ETF_NEAR_COPY_CORRELATION


def _overlapping_holding(
    snap: SymbolSnapshot,
    returns: ReturnSeries,
    holding_returns: Mapping[str, ReturnSeries],
    held_etfs: Collection[str],
    held_categories: Mapping[str, str | None],
) -> str | None:
    """The held ETF this fund is a near-copy of, if any."""
    for held in held_etfs:
        held_returns = holding_returns.get(held)
        if held_returns is None:
            continue
        if _is_near_copy(snap.category, held_categories.get(held), returns, held_returns):
            return held
    return None


def etf_exclusion(
    snap: SymbolSnapshot,
    *,
    stale: str | None,
    rates: Mapping[str, Decimal],
    returns: ReturnSeries,
    holding_returns: Mapping[str, ReturnSeries],
    held_etfs: Collection[str],
    held_categories: Mapping[str, str | None],
) -> Exclusion | None:
    """Why this ETF is out, or None when it is eligible and passes the quality filter.

    `stale` is the reason `check_freshness` gave for this ticker, if any. `returns` are the fund's
    dated log returns and `holding_returns` those of every valued holding.
    """

    def out(reason: ExcludedFor, explanation: str) -> Exclusion:
        return _exclusion(snap, reason, explanation)

    if not snap.ucits:
        return out("not_ucits", "not available to EU retail investors")
    if snap.currency not in SUPPORTED:
        return out("currency_unsupported", f"quote currency {snap.currency} cannot be converted")
    price = snap.price
    if price is None or not math.isfinite(price) or price <= 0:
        return out("unreliable_price", "the price is missing or not a positive number")
    if not snap.closes or not all(math.isfinite(c) and c > 0 for c in snap.closes):
        return out("unreliable_price", "no price history, or it holds an invalid close")
    if stale:
        return out("unreliable_price", f"the price is out of date: {stale}")
    if len(snap.closes) < ETF_MIN_CLOSES:
        return out(
            "insufficient_data",
            f"{len(snap.closes)} daily closes, at least {ETF_MIN_CLOSES} are needed",
        )
    shared = _shared_intervals([returns, *holding_returns.values()])
    if shared < ETF_MIN_SHARED_INTERVALS:
        return out(
            "insufficient_data",
            f"{shared} return intervals match the holdings, at least {ETF_MIN_SHARED_INTERVALS} "
            "are needed",
        )
    cost = snap.metrics.get("expenseRatio")
    if cost is None or not math.isfinite(cost):
        return out("insufficient_data", "the fund's expense ratio is not known")
    if _is_leveraged(snap):
        return out("fails_quality_filter", "a leveraged or inverse fund")
    held = _overlapping_holding(snap, returns, holding_returns, held_etfs, held_categories)
    if held is not None:
        return out(
            "overlaps_holding",
            f"moves almost exactly like {held}, which is already held "
            f"(correlation at least {ETF_NEAR_COPY_CORRELATION:.2f})",
        )
    if cost > ETF_MAX_EXPENSE_RATIO:
        return out(
            "fails_quality_filter",
            f"the expense ratio {cost:.2%} is above the {ETF_MAX_EXPENSE_RATIO:.2%} limit",
        )
    size = fund_size_eur(snap, rates)
    if size is not None and size < ETF_MIN_SIZE_EUR:
        return out(
            "fails_quality_filter",
            f"the fund is worth EUR {size / 1e6:,.0f} million, under the "
            f"EUR {ETF_MIN_SIZE_EUR / 1e6:,.0f} million minimum",
        )
    return None


def build_etf_candidate(
    snap: SymbolSnapshot, rates: Mapping[str, Decimal], uncertain: str | None
) -> CandidateMetrics:
    """The candidate for one ETF: no peer table; the fund's cost and size travel in `fundamentals`.

    The market cap is left out of the risk profile on purpose: a fund's size is not a company's
    size and must not raise a "small cap" flag. Volatility, drawdown and liquidity still apply.
    """
    risk = build_risk_profile(
        group="etf",
        market_cap=None,
        currency=snap.currency or "",
        rates=dict(rates),
        avg_volume=snap.avg_volume,
        price=snap.price,
        closes=snap.closes,
        metrics=snap.metrics,
    )
    return CandidateMetrics(
        ticker=snap.ticker,
        name=snap.name,
        asset_type="ETF",
        exchange=snap.exchange,
        country=snap.country,
        sector=None,
        industry=snap.category,
        currency=snap.currency,
        price=snap.price,
        price_as_of=datetime.fromisoformat(snap.dates[-1]).replace(tzinfo=UTC)
        if snap.dates
        else None,
        # The converted size, so a fund whose size is only Yahoo's native-currency figure shows it.
        fundamentals={**snap.metrics, "fundSizeEur": fund_size_eur(snap, rates)},
        coverage=etf_coverage_of(snap.metrics),
        peers=[],
        risk=risk,
        origin="universe",
        origin_note=None,
        data_notes=[f"{PRICE_DATE_UNCERTAIN_PREFIX} {uncertain}"] if uncertain else [],
    )


@dataclass(frozen=True)
class EtfShortlist:
    candidates: list[CandidateMetrics]  # best gap score first, at most one per category
    excluded: list[Exclusion]
    eligible: int  # funds scored, one per category, before the cut to `size`
    skipped_reason: str | None  # set when the lane did not run; not an "ETF found nothing" result


def _exclusion(snap: SymbolSnapshot, reason: ExcludedFor, explanation: str) -> Exclusion:
    return Exclusion(
        ticker=snap.ticker, name=snap.name, reason=reason, explanation=explanation, evidence=[]
    )


def shortlist_etfs(
    snapshots: Sequence[SymbolSnapshot],
    freshness: Freshness,
    rates: Mapping[str, Decimal],
    *,
    holdings: Collection[str],
    held_etfs: Collection[str],
    exposure: PortfolioExposure,
    histories: Histories,
    today: date,
    avoid_sectors: Collection[str] = (),
    size: int = ETF_SLOTS,
) -> EtfShortlist:
    """The ETFs that fill the biggest gaps in the portfolio, best first.

    `histories` must hold only holdings with usable history (as `load_fit_context` returns them):
    a candidate that lacks 60 shared return intervals with any one of them is excluded, so a
    holding without a usable history would exclude every fund.
    """
    if len(exposure.positions) < ETF_MIN_HOLDINGS:
        return EtfShortlist([], [], 0, ETF_LANE_SKIPPED)
    held = {t.casefold() for t in holdings}
    avoided = {s.casefold() for s in avoid_sectors}  # held and avoided funds are left out silently
    holding_returns = {ticker: log_returns(values) for ticker, values in histories.items()}
    category_of = {s.ticker: s.category for s in snapshots}
    held_categories = {ticker: category_of.get(ticker) for ticker in held_etfs}

    excluded: list[Exclusion] = []
    survivors: list[SymbolSnapshot] = []
    returns: dict[str, ReturnSeries] = {}
    for snap in snapshots:
        if snap.asset_type != "ETF" or snap.ticker.casefold() in held:
            continue
        if (snap.sector or "").casefold() in avoided:
            continue
        returns[snap.ticker] = log_returns(
            clean_history(dict(zip(snap.dates, snap.closes, strict=True)), today)
        )
        why = etf_exclusion(
            snap,
            stale=freshness.stale.get(snap.ticker),
            rates=rates,
            returns=returns[snap.ticker],
            holding_returns=holding_returns,
            held_etfs=held_etfs,
            held_categories=held_categories,
        )
        if why is None:
            survivors.append(snap)
        else:
            excluded.append(why)

    def cheapest_then_largest(snap: SymbolSnapshot) -> tuple[float, float, str]:
        # etf_exclusion has already required a finite expense ratio; an unknown size sorts last
        cost = snap.metrics["expenseRatio"] or 0.0
        return (cost, -(fund_size_eur(snap, rates) or 0.0), snap.ticker)

    # Near-copies: of each group the cheapest fund stays (then the largest); the rest say who did.
    kept: list[SymbolSnapshot] = []
    for snap in sorted(survivors, key=cheapest_then_largest):
        mine = returns[snap.ticker]
        twin = next(
            (k for k in kept if _is_near_copy(snap.category, k.category, mine, returns[k.ticker])),
            None,
        )
        if twin is None:
            kept.append(snap)
        else:
            excluded.append(
                _exclusion(
                    snap,
                    "fails_quality_filter",
                    f"moves almost exactly like {twin.ticker}, which is cheaper or larger "
                    f"(correlation at least {ETF_NEAR_COPY_CORRELATION:.2f}); only that one "
                    "is kept",
                )
            )

    scored: list[tuple[int, CandidateMetrics]] = []
    for snap in kept:
        fit = marginal_effect(
            exposure,
            returns[snap.ticker],
            None,
            ticker=snap.ticker,
            portfolio_returns=holding_returns,
        )
        score = fit_dimension(fit).score
        if score is None:
            unmeasured = "its effect on the portfolio cannot be measured"
            excluded.append(_exclusion(snap, "insufficient_data", unmeasured))
        else:
            candidate = build_etf_candidate(snap, rates, freshness.uncertain.get(snap.ticker))
            scored.append((score, candidate))
    scored.sort(key=lambda row: (-row[0], row[1].ticker))

    # One fund per category; a fund with no category cannot share one, so it always stays.
    chosen: list[CandidateMetrics] = []
    seen: set[str] = set()
    for _, candidate in scored:
        category = (candidate.industry or "").casefold()
        if category and category in seen:
            continue
        seen.add(category)
        chosen.append(candidate)
    return EtfShortlist(chosen[: max(size, 0)], excluded, len(chosen), None)
