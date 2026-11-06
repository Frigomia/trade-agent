"""Closed-session estimation inputs. Never a live quote or a broker fill."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import exchange_calendars as calendars  # type: ignore[import-untyped]
import yfinance as yf

from app.agents.market_data import _retry_fetch, fetch_closes_between
from app.fx import SUPPORTED, _positive, minor_unit, rate_from_price, rate_symbol

# Provider exchange identifiers, not client text. Unknown markets require explicit support.
EXCHANGES = {
    "NMS": "XNYS",
    "NGM": "XNYS",
    "NCM": "XNYS",
    "NYQ": "XNYS",
    "ASE": "XNYS",
    "PCX": "XNYS",
    "BTS": "XNYS",
    "GER": "XETR",
    "FRA": "XFRA",
    "LSE": "XLON",
    "PAR": "XPAR",
    "AMS": "XAMS",
    "BRU": "XBRU",
    "MIL": "XMIL",
    "EBS": "XSWX",
    "SWX": "XSWX",
    "TOR": "XTSE",
    "HKG": "XHKG",
    "JPX": "XTKS",
    "ASX": "XASX",
}


class MarketUnavailable(Exception):
    """Safe explanation of missing inputs, never provider exception text."""


async def instrument(ticker: str, asset_type: str) -> dict[str, str]:
    def read() -> dict[str, str]:
        info = yf.Ticker(ticker).info
        expected = "ETF" if asset_type == "ETF" else "EQUITY"
        if info.get("quoteType") != expected or info.get("exchange") not in EXCHANGES:
            raise MarketUnavailable("Choose a stock or ETF listing on a supported exchange.")
        currency = info.get("currency")
        if currency not in SUPPORTED:
            raise MarketUnavailable("The listing's quote currency is not supported.")
        return {
            "exchange": str(info["exchange"]),
            "currency": str(currency),
            "name": str(info.get("shortName") or info.get("longName") or ticker)[:200],
        }

    try:
        return await _retry_fetch(read)
    except MarketUnavailable:
        raise
    except Exception:
        raise MarketUnavailable(
            "Listing details are unavailable. Retry when market data returns."
        ) from None


def effective_session(exchange: str, scheduled: date, now: datetime) -> date:
    name = EXCHANGES.get(exchange)
    if name is None:
        raise MarketUnavailable("This exchange calendar is not supported.")
    calendar: Any = calendars.get_calendar(
        name, start=scheduled - timedelta(days=10), end=scheduled + timedelta(days=40)
    )
    session = calendar.date_to_session(scheduled.isoformat(), direction="next")
    if calendar.session_close(session).to_pydatetime() + timedelta(hours=2) > now:
        raise MarketUnavailable(
            "Waiting for the effective trading session's published daily close."
        )
    return session.date()  # type: ignore[no-any-return]


async def historical_fx(contribution: str, quote: str, day: date) -> tuple[Decimal, date]:
    source_major, source_unit = minor_unit(contribution)
    target_major, target_unit = minor_unit(quote)
    if source_major == target_major:
        return source_unit / target_unit, day
    currencies = [contribution, quote]
    histories: list[dict[str, float]] = []
    for currency in currencies:
        major, _ = minor_unit(currency)
        if major == "EUR":
            histories.append({})
            continue
        symbol = rate_symbol(currency)
        if symbol is None:
            raise MarketUnavailable("Historical FX is not supported for this currency.")
        histories.append(
            await fetch_closes_between(symbol, day - timedelta(days=7), day + timedelta(days=1))
        )
    candidates = {day.isoformat()}
    for history in histories:
        if history:
            candidates |= set(history)
    for candidate in sorted(candidates, reverse=True):
        fx_day = date.fromisoformat(candidate)
        if not day - timedelta(days=7) <= fx_day <= day:
            continue
        rates = [
            rate_from_price(c, 1 if minor_unit(c)[0] == "EUR" else h.get(candidate))
            for c, h in zip(currencies, histories, strict=True)
        ]
        if all(r is not None for r in rates):
            source, target = rates
            assert source is not None and target is not None
            return source / target, fx_day
    raise MarketUnavailable(
        "Waiting for historical FX (no common published rate within seven days)."
    )


@dataclass(frozen=True)
class Estimate:
    effective_date: date
    price: Decimal
    currency: str
    fx_rate: Decimal
    fx_date: date


async def estimate(
    ticker: str,
    asset_type: str,
    scheduled: date,
    contribution: str,
    earliest: date | None = None,
    now: datetime | None = None,
) -> Estimate:
    now = now or datetime.now(UTC)
    try:
        listing = await instrument(ticker, asset_type)
        day = effective_session(listing["exchange"], scheduled, now)

        # Yahoo Close is split-adjusted even with auto_adjust=False. Without a corporate-action
        # ledger we refuse the affected history instead of turning it into fictitious quantities.
        def read_close() -> Decimal:
            frame = yf.Ticker(ticker).history(
                start=min(earliest or day, day),
                end=now.date() + timedelta(days=1),
                auto_adjust=False,
                back_adjust=False,
                actions=True,
                raise_errors=True,
            )
            if "Stock Splits" in frame and any(v != 0 for v in frame["Stock Splits"].fillna(0)):
                raise MarketUnavailable(
                    "Stock split requires manual review; no estimate was posted."
                )
            for stamp, value in frame["Close"].items():
                if stamp.date() == day:
                    price = _positive(value)
                    if price is not None and price.quantize(Decimal("0.000001")) > 0:
                        return price.quantize(Decimal("0.000001"))
            raise MarketUnavailable("Waiting for the effective session's historical daily close.")

        price = await _retry_fetch(read_close)
        rate, fx_day = await historical_fx(contribution, listing["currency"], day)
        return Estimate(day, price, listing["currency"], rate, fx_day)
    except MarketUnavailable:
        raise
    except Exception:
        raise MarketUnavailable(
            "Market prices or historical FX are unavailable; will retry."
        ) from None
