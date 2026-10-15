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
    # Global discovery universe (plan 2026-10-14-market-discovery, Phase 1a)
    "HKD": "EURHKD=X",
    "CNY": "EURCNY=X",
    "INR": "EURINR=X",
    "KRW": "EURKRW=X",
    "TWD": "EURTWD=X",
    "SGD": "EURSGD=X",
    "BRL": "EURBRL=X",
    "MXN": "EURMXN=X",
    "ZAR": "EURZAR=X",
    "NZD": "EURNZD=X",
    "CZK": "EURCZK=X",
    "HUF": "EURHUF=X",
    "TRY": "EURTRY=X",
    "ILS": "EURILS=X",
    "SAR": "EURSAR=X",
    "AED": "EURAED=X",
    "THB": "EURTHB=X",
    "IDR": "EURIDR=X",
    "MYR": "EURMYR=X",
    "CLP": "EURCLP=X",
    "COP": "EURCOP=X",
    "QAR": "EURQAR=X",
    "KWD": "EURKWD=X",
    "PHP": "EURPHP=X",
    "EGP": "EUREGP=X",
}
# Minor units: 1/100 of the main unit. Yahoo quotes London in pence (GBp or GBX), Johannesburg
# in cents (ZAc) and Tel Aviv in agorot (ILA).
SUBUNITS = {
    "GBp": ("GBP", Decimal("0.01")),
    "GBX": ("GBP", Decimal("0.01")),
    "ZAc": ("ZAR", Decimal("0.01")),
    "ILA": ("ILS", Decimal("0.01")),
}
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


def rate_symbol(currency: str) -> str | None:
    """The Yahoo symbol quoting units of `currency` per 1 EUR; None for EUR or an unsupported one.

    A minor unit (GBp, ZAc, ILA) uses the rate of its main currency.
    """
    return RATE_SYMBOLS.get(SUBUNITS.get(currency, (currency, Decimal(1)))[0])


def rate_from_price(currency: str, per_eur: object) -> Decimal | None:
    """EUR per 1 unit of `currency`, from the quoted units of that currency per 1 EUR."""
    if currency == "EUR":
        return Decimal(1)
    price = _positive(per_eur)
    if price is None:
        return None
    return SUBUNITS.get(currency, (currency, Decimal(1)))[1] / price


async def eur_rate(currency: str) -> Decimal | None:
    """EUR per 1 unit of `currency` (per 1 minor unit for GBp, ZAc, ILA); None when not found."""
    if currency == "EUR":
        return Decimal(1)
    symbol = rate_symbol(currency)
    if symbol is None:
        return None
    try:
        data = await fetch_quote_and_history(symbol)
    except Exception as exc:
        logger.warning("Rate lookup failed for %s (%s)", symbol, type(exc).__name__)
        return None
    return rate_from_price(currency, data.get("price") if isinstance(data, dict) else None)


async def eur_prices(tickers: set[str]) -> tuple[dict[str, EurPrice], dict[str, str]]:
    ordered = sorted(tickers)
    sem = asyncio.Semaphore(LOOKUP_CONCURRENCY)

    async def one(ticker: str) -> tuple[str, tuple[Decimal, str] | str]:
        """The ticker's (price, currency), or the reason it is left out."""
        try:
            async with sem:
                data = await fetch_quote_and_history(ticker)
        except Exception as exc:
            logger.warning("Price lookup failed (%s)", type(exc).__name__)
            return ticker, "No price available."
        price = _positive(data.get("price")) if isinstance(data, dict) else None
        if price is None:
            return ticker, "No price available."
        try:
            async with sem:
                currency = await fetch_currency(ticker)
        except Exception as exc:
            logger.warning("Currency lookup failed (%s)", type(exc).__name__)
            currency = None
        if not currency:
            return ticker, "Its currency is unknown."
        if currency not in SUPPORTED:
            return ticker, f"Currency {currency[:8]} is not supported."
        return ticker, (price, currency)

    found = await asyncio.gather(*(one(t) for t in ordered))
    currencies = sorted({r[1] for _, r in found if not isinstance(r, str)})
    # zip pairs each currency with its rate; strict=True fails loudly if the lengths differ
    found_rates = await asyncio.gather(*(eur_rate(c) for c in currencies))
    rates = dict(zip(currencies, found_rates, strict=True))

    prices: dict[str, EurPrice] = {}
    skipped: dict[str, str] = {}
    for ticker, result in found:
        if isinstance(result, str):
            skipped[ticker] = result
            continue
        price, currency = result
        rate = rates[currency]
        if rate is None or not MIN_RATE <= rate <= MAX_RATE:
            skipped[ticker] = f"No exchange rate for {currency}."
            continue
        price_eur = price * rate
        if not MIN_PRICE_EUR <= price_eur <= MAX_PRICE_EUR:
            skipped[ticker] = "Its price is outside the supported range."
            continue
        prices[ticker] = EurPrice(price_eur, currency, rate)
    return prices, skipped
