"""Risk characteristics of a candidate: measured and displayed, never used to exclude (plan 4.2).

A value that cannot be measured stays None and raises no flag. The cut-offs below are labels for
the reader, proposed defaults, not eligibility rules.
"""

import math
from collections.abc import Callable
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
HIGH_LEVERAGE = 2.0  # debt as a multiple of equity

# Where a stability measure means something else, and why. Revenue and equity count everywhere.
NOT_JUDGED: dict[str, frozenset[str]] = {
    # Banks and insurers owe deposits and policy reserves; REITs and utilities fund assets with
    # debt by design. Debt to equity is not comparable with non-financial companies.
    "high_leverage": frozenset({"bank", "insurer", "financial_other", "reit", "utility"}),
    # For banks, insurers and other financials, operating cash flow includes deposits, premiums
    # and trading flows, so it is not free cash in the usual sense.
    "negative_fcf": frozenset({"bank", "insurer", "financial_other"}),
}
STABILITY: tuple[tuple[str, str, Callable[[float], bool], str], ...] = (
    ("high_leverage", "debtToEquity", lambda v: v > HIGH_LEVERAGE, "debt is {:.1f}x equity"),
    ("negative_fcf", "fcfMargin", lambda v: v < 0, "free cash flow is {:.0%} of revenue"),
    ("shrinking_revenue", "revenueGrowth", lambda v: v < 0, "revenue growth is {:.0%}"),
)


def _number(
    value: Any, *, above: float | None = None, atleast: float | None = None
) -> float | None:
    """A finite number within the bounds, else None: an invalid input is not a measurement."""
    ok = isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
    if not ok:
        return None
    number = float(value)
    if (above is not None and number <= above) or (atleast is not None and number < atleast):
        return None
    return number


def size_bucket_for(market_cap_eur: float | None) -> SizeBucket:
    cap = _number(market_cap_eur, above=0)
    if cap is None:
        return "unknown"
    return next((label for bound, label in SIZE_BOUNDS_EUR if cap < bound), "large")


def market_cap_to_eur(cap: Any, currency: str, rates: dict[str, Decimal]) -> float | None:
    """EUR value of a market cap quoted for a stock whose price currency is `currency`.

    Yahoo reports the market cap in the major unit even when the price is in a minor unit (a
    London stock is priced in pence, GBp, but its market cap is in pounds), so a minor-unit
    rate is scaled back up to the main currency first. A cap or a rate that is not positive
    converts nothing.
    """
    value, rate = _number(cap, above=0), rates.get(currency)
    if value is None or rate is None or rate <= 0:
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
    volume, px, rate = _number(avg_volume, atleast=0), _number(price, above=0), rates.get(currency)
    # price is in the quote unit (pence included), so the quote-unit rate converts it directly;
    # zero volume is a real observation of illiquidity, a negative one is invalid
    daily = volume * px * float(rate) if volume is not None and px and rate and rate > 0 else None
    size = size_bucket_for(cap_eur)
    volatility, drawdown = _price_risk(closes)

    flags: list[str] = []
    if size in ("micro", "small") and cap_eur is not None:
        flags.append(f"small_cap: {cap_eur / 1e6:,.0f}M EUR market cap")
    if daily is not None and daily < THIN_LIQUIDITY_EUR:
        flags.append(f"thin_liquidity: {daily / 1e6:.1f}M EUR traded a day")
    if volatility is not None and volatility > HIGH_VOLATILITY:
        flags.append(f"high_volatility: {volatility:.0%} a year")
    measured = cap_eur is not None or daily is not None or volatility is not None

    # Negative equity: the sign of debt to equity says so on its own. A negative price to book
    # does too, but only for a valid positive price, and a zero ratio proves nothing.
    equity = [
        _number(metrics.get("debtToEquity")),
        _number(metrics.get("priceToBook")) if px else None,
    ]
    measured = measured or any(value is not None for value in equity)
    if any(value is not None and value < 0 for value in equity):
        flags.append("negative_equity: book value is negative")
    for flag, key, is_problem, text in STABILITY:
        value = _number(metrics.get(key))
        if value is None or group in NOT_JUDGED.get(flag, ()):
            continue
        measured = True
        if is_problem(value):
            flags.append(f"{flag}: {text.format(value)}")

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
