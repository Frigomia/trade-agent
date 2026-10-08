"""Trading currency and EUR conversion for the contribution plan.

Nothing is stored: the quote source tells each ticker's currency and a cached rate converts it. The
rate symbol comes from a fixed table, never from user text. A ticker that cannot be priced in EUR is
left out with a short reason; a plan never gets a NaN, infinite or negative amount from here.
"""

import asyncio
import logging
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from app.agents.market_data import fetch_currency, fetch_quote_and_history

logger = logging.getLogger(__name__)

# currency -> the Yahoo symbol that gives units of that currency per 1 EUR
RATE_SYMBOLS = {
    "USD": "EURUSD=X",
    "GBP": "EURGBP=X",
    "CHF": "EURCHF=X",
    "JPY": "EURJPY=X",
    "CAD": "EURCAD=X",
    "AUD": "EURAUD=X",
    "SEK": "EURSEK=X",
    "NOK": "EURNOK=X",
    "DKK": "EURDKK=X",
    "PLN": "EURPLN=X",
}
# pence: 1/100 of a pound (yfinance reports either spelling)
SUBUNITS = {"GBp": ("GBP", Decimal("0.01")), "GBX": ("GBP", Decimal("0.01"))}
SUPPORTED = frozenset({"EUR", *RATE_SYMBOLS, *SUBUNITS})
LOOKUP_CONCURRENCY = 8
# Bounds that keep amounts inside the plan columns (Numeric 18,6 for prices and 18,8 for rates)
MIN_PRICE_EUR = Decimal("0.0001")
MAX_PRICE_EUR = Decimal("1000000000")
MIN_RATE = Decimal("0.00000001")
MAX_RATE = Decimal("100000000")


@dataclass(frozen=True)
class EurPrice:
    price_eur: Decimal
    currency: str  # the currency the ticker is quoted in
    rate: Decimal  # EUR per 1 unit of that currency (per 1 penny for GBp)


def _positive(value: object) -> Decimal | None:
    """A finite number above zero as a Decimal, else None."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() and number > 0 else None


async def _rate(currency: str) -> Decimal | None:
    """EUR per 1 unit of `currency` (per 1 penny for GBp); None when it cannot be found."""
    if currency == "EUR":
        return Decimal(1)
    base, factor = SUBUNITS.get(currency, (currency, Decimal(1)))
    symbol = RATE_SYMBOLS.get(base)
    if symbol is None:
        return None
    try:
        data = await fetch_quote_and_history(symbol)
    except Exception as exc:
        logger.warning("Rate lookup failed for %s (%s)", base, type(exc).__name__)
        return None
    per_eur = _positive(data.get("price")) if isinstance(data, dict) else None
    return factor / per_eur if per_eur is not None else None


async def eur_prices(tickers: set[str]) -> tuple[dict[str, EurPrice], dict[str, str]]:
    ordered = sorted(tickers)
    sem = asyncio.Semaphore(LOOKUP_CONCURRENCY)

    async def one(ticker: str) -> tuple[str, Decimal | None, str | None, str | None]:
        try:
            async with sem:
                data = await fetch_quote_and_history(ticker)
        except Exception as exc:
            logger.warning("Price lookup failed (%s)", type(exc).__name__)
            return ticker, None, None, f"{ticker} is left out: no price available."
        price = _positive(data.get("price")) if isinstance(data, dict) else None
        if price is None:
            return ticker, None, None, f"{ticker} is left out: no price available."
        try:
            async with sem:
                currency = await fetch_currency(ticker)
        except Exception as exc:
            logger.warning("Currency lookup failed (%s)", type(exc).__name__)
            currency = None
        if not currency:
            return ticker, None, None, f"{ticker} is left out: its currency is unknown."
        if currency not in SUPPORTED:
            note = f"{ticker} is left out: currency {currency[:8]} is not supported."
            return ticker, None, None, note
        return ticker, price, currency, None

    found = await asyncio.gather(*(one(t) for t in ordered))
    currencies = sorted({c for _, _, c, _ in found if c is not None})
    # zip pairs each currency with its rate; strict=True fails loudly if the lengths differ
    found_rates = await asyncio.gather(*(_rate(c) for c in currencies))
    rates = dict(zip(currencies, found_rates, strict=True))

    prices: dict[str, EurPrice] = {}
    skipped: dict[str, str] = {}
    for ticker, price, currency, reason in found:
        if reason is not None or price is None or currency is None:
            skipped[ticker] = reason or f"{ticker} is left out: no price available."
            continue
        rate = rates[currency]
        if rate is None or not MIN_RATE <= rate <= MAX_RATE:
            skipped[ticker] = f"{ticker} is left out: no exchange rate for {currency}."
            continue
        price_eur = price * rate
        if not MIN_PRICE_EUR <= price_eur <= MAX_PRICE_EUR:
            skipped[ticker] = f"{ticker} is left out: its price is outside the supported range."
            continue
        prices[ticker] = EurPrice(price_eur, currency, rate)
    return prices, skipped
