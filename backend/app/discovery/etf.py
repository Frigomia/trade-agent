"""Whether an ETF can be recommended at all, and whether it passes the quality filter (spec:
"Eligibility (ETF lane)" and "Quality filter").

Pure rules, no network. The first failure wins and is recorded as an `Exclusion` with a plain
explanation. Keeping only the cheapest of several near-copy candidates is the shortlist's job.
"""

import math
from collections.abc import Collection, Mapping
from decimal import Decimal
from typing import Literal

from app.analysis.portfolio import ReturnSeries, pairwise_correlation
from app.discovery.risk import market_cap_to_eur
from app.discovery.snapshot import SymbolSnapshot
from app.fx import SUPPORTED
from app.schemas_discovery import Exclusion

ETF_SLOTS = 3
ETF_MAX_EXPENSE_RATIO = 0.005  # a fraction: 0.50% a year, proposed
ETF_MIN_SIZE_EUR = 100_000_000.0  # proposed
ETF_MIN_CLOSES = 250  # about one year of trading days
# Must equal `analysis.portfolio.MIN_RETURNS`: the fit step needs this many intervals shared by
# the candidate and every holding, and a fund below it could never be scored (a test checks it).
ETF_MIN_SHARED_INTERVALS = 60
ETF_NEAR_COPY_CORRELATION = 0.95
ETF_MIN_HOLDINGS = 2

# Lowercase tokens tested against the fund's name and category (leveraged, inverse and other trading
# funds are out). A bare "short" is deliberately not a marker: "Short Duration" and "Ultrashort
# Bond" are ordinary bond funds, exactly the low-correlation ideas the lane exists to find.
LEVERAGED_MARKERS = (
    "2x",
    "3x",
    "5x",
    "x2",
    "x3",
    "x5",
    "-1x",
    "leveraged",
    "leverage shares",
    "inverse",
    "short daily",
    "daily short",
    "shortdax",
    "trading--",  # Morningstar's category prefix for leveraged and inverse funds
)

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
    return any(marker in text for marker in LEVERAGED_MARKERS)


def _overlapping_holding(
    snap: SymbolSnapshot,
    returns: ReturnSeries,
    holding_returns: Mapping[str, ReturnSeries],
    held_etfs: Collection[str],
    held_categories: Mapping[str, str | None],
) -> str | None:
    """The held ETF this fund is a near-copy of, if any.

    The same category and a correlation at or above the limit make a copy. When either category is
    unknown the correlation alone decides: a missing category cannot prove two funds differ.
    """
    for held in held_etfs:
        held_returns = holding_returns.get(held)
        if held_returns is None:
            continue
        category = held_categories.get(held)
        if snap.category and category and snap.category.casefold() != category.casefold():
            continue
        correlation = pairwise_correlation(returns, held_returns)
        if correlation is not None and correlation >= ETF_NEAR_COPY_CORRELATION:
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
        return Exclusion(
            ticker=snap.ticker, name=snap.name, reason=reason, explanation=explanation, evidence=[]
        )

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
