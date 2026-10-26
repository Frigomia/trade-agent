"""Bounded, major-unit daily history shared by saved ideas and saved companies."""

import asyncio
from datetime import date

from app.agents.market_data import fetch_currency, fetch_dated_closes
from app.fx import SUBUNITS
from app.schemas import HistoryRange, PriceHistoryOut, PricePointOut

HISTORY_PERIODS = {"1w": "5d", "1m": "1mo", "6m": "6mo", "1y": "1y", "5y": "5y"}


class HistoryUnavailable(Exception):
    """The provider or its currency unit could not be read safely."""


def _major_unit(
    quote_currency: str | None, saved_currency: str | None
) -> tuple[str | None, float | None]:
    if quote_currency:
        major, unit = SUBUNITS.get(quote_currency, (quote_currency, 1))
        return major, float(unit)
    # Saved ideas keep the major unit; GBP/ZAR/ILS cannot identify a minor-unit quote.
    if saved_currency and saved_currency not in {major for major, _ in SUBUNITS.values()}:
        return saved_currency, 1.0
    return saved_currency, None


async def load_price_history(
    ticker: str, range_: HistoryRange, saved_currency: str | None = None
) -> PriceHistoryOut:
    async def quote_currency() -> str | None:
        try:
            return await fetch_currency(ticker)
        except Exception:
            return None

    try:
        closes, currency = await asyncio.gather(
            fetch_dated_closes(ticker, HISTORY_PERIODS[range_], strict=True), quote_currency()
        )
    except Exception as exc:
        raise HistoryUnavailable from exc
    major, factor = _major_unit(currency, saved_currency)
    if factor is None and closes:
        raise HistoryUnavailable
    points = [
        PricePointOut(date=date.fromisoformat(day), close=round(close * (factor or 1), 6))
        for day, close in sorted(closes.items())
    ]
    return PriceHistoryOut(
        ticker=ticker,
        currency=major,
        as_of=points[-1].date if points else None,
        range=range_,
        points=points,
    )
