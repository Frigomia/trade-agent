"""Risk characteristics of a candidate: measured and displayed, never used to exclude (plan 4.2).

A value that cannot be measured stays None and raises no flag. The cut-offs below are labels for
the reader, proposed defaults, not eligibility rules.
"""

import math
from decimal import Decimal
from statistics import stdev
from typing import Any

from app.fx import SUBUNITS
from app.schemas_discovery import RiskLevel, RiskProfile, SizeBucket

MIN_HISTORY_DAYS = 120  # under this there is no volatility or drawdown (approved)
TRADING_DAYS = 252
SIZE_BOUNDS_EUR: tuple[tuple[float, SizeBucket], ...] = (
    (300e6, "micro"),
    (2e9, "small"),
    (10e9, "mid"),
)
LEVELS: tuple[RiskLevel, RiskLevel, RiskLevel] = ("low", "medium", "high")  # by number of flags
THIN_LIQUIDITY_EUR = 1e6  # average daily traded value (approved)
HIGH_VOLATILITY = 0.40  # annualized
HIGH_LEVERAGE = 2.0  # debt as a multiple of equity; judged for non-financial companies only


def _number(value: Any) -> float | None:
    ok = isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
    return float(value) if ok else None


def size_bucket_for(market_cap_eur: float | None) -> SizeBucket:
    cap = _number(market_cap_eur)
    if cap is None:
        return "unknown"
    return next((label for bound, label in SIZE_BOUNDS_EUR if cap < bound), "large")


def market_cap_to_eur(cap: Any, currency: str, rates: dict[str, Decimal]) -> float | None:
    """EUR value of a market cap quoted for a stock whose price currency is `currency`.

    Yahoo reports the market cap in the major unit even when the price is in a minor unit (a
    London stock is priced in pence, GBp, but its market cap is in pounds), so a minor-unit
    rate is scaled back up to the main currency first.
    """
    value, rate = _number(cap), rates.get(currency)
    if value is None or rate is None:
        return None
    if currency in SUBUNITS:
        rate = rate / SUBUNITS[currency][1]
    return float(Decimal(str(value)) * rate)


def _price_risk(closes: list[float]) -> tuple[float | None, float | None]:
    window = closes[-TRADING_DAYS:]
    if len(window) < MIN_HISTORY_DAYS or any(not c > 0 or not math.isfinite(c) for c in window):
        return None, None
    returns = [math.log(b / a) for a, b in zip(window, window[1:], strict=False)]
    peak, worst = window[0], 0.0
    for close in window:
        peak = max(peak, close)
        worst = min(worst, close / peak - 1)
    return stdev(returns) * math.sqrt(TRADING_DAYS), worst


def build_risk_profile(
    *,
    group: str,
    market_cap: Any,
    currency: str,
    rates: dict[str, Decimal],
    avg_volume: Any,
    price: Any,
    closes: list[float],
    metrics: dict[str, Any],
) -> RiskProfile:
    cap_eur = market_cap_to_eur(market_cap, currency, rates)
    volume, px, rate = _number(avg_volume), _number(price), rates.get(currency)
    # price is in the quote unit (pence included), so the quote-unit rate converts it directly
    daily = volume * px * float(rate) if volume is not None and px is not None and rate else None
    size = size_bucket_for(cap_eur)
    volatility, drawdown = _price_risk(closes)

    flags: list[str] = []
    if size in ("micro", "small") and cap_eur is not None:
        flags.append(f"small_cap: {cap_eur / 1e6:,.0f}M EUR market cap")
    if daily is not None and daily < THIN_LIQUIDITY_EUR:
        flags.append(f"thin_liquidity: {daily / 1e6:.1f}M EUR traded a day")
    if volatility is not None and volatility > HIGH_VOLATILITY:
        flags.append(f"high_volatility: {volatility:.0%} a year")
    debt, book, fcf, growth = (
        _number(metrics.get(key))
        for key in ("debtToEquity", "priceToBook", "fcfMargin", "revenueGrowth")
    )
    if (book is not None and book <= 0) or (debt is not None and debt < 0):
        flags.append("negative_equity: book value is zero or negative")
    if group == "general":  # banks, insurers, REITs and utilities are leveraged by design
        if debt is not None and debt > HIGH_LEVERAGE:
            flags.append(f"high_leverage: debt is {debt:.1f}x equity")
        if fcf is not None and fcf < 0:
            flags.append(f"negative_fcf: free cash flow is {fcf:.0%} of revenue")
        if growth is not None and growth < 0:
            flags.append(f"shrinking_revenue: revenue growth is {growth:.0%}")

    measured = cap_eur is not None or daily is not None or volatility is not None
    level: RiskLevel = LEVELS[min(len(flags), 2)] if measured else "unknown"
    return RiskProfile(
        market_cap_eur=cap_eur,
        avg_daily_value_eur=daily,
        size_bucket=size,
        volatility_annualized=volatility,
        max_drawdown_1y=drawdown,
        risk_flags=flags,
        risk_level=level,
    )
