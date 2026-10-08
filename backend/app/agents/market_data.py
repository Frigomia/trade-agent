import asyncio
import json
import logging
from collections.abc import Callable
from datetime import date
from typing import Any

import yfinance as yf

from app.redis_client import get_redis

logger = logging.getLogger(__name__)

QUOTE_CACHE_TTL = 300
FUNDAMENTALS_CACHE_TTL = 900
HISTORY_CACHE_TTL = 86400
SEARCH_CACHE_TTL = 3600
SEARCH_MAX_RESULTS = 8

RETRY_ATTEMPTS = 3
RETRY_BASE_DELAY_SECONDS = 1.0


async def _retry_fetch[T](fetch: Callable[[], T]) -> T:
    for attempt in range(RETRY_ATTEMPTS):
        try:
            return await asyncio.to_thread(fetch)
        except Exception as exc:
            if attempt == RETRY_ATTEMPTS - 1:
                raise
            logger.warning(
                "yfinance call failed (attempt %d/%d), retrying: %s",
                attempt + 1,
                RETRY_ATTEMPTS,
                type(exc).__name__,
            )
            await asyncio.sleep(RETRY_BASE_DELAY_SECONDS * (2**attempt))
    raise AssertionError("unreachable: loop always returns or raises")


async def fetch_quote_and_history(ticker: str) -> dict[str, Any]:
    redis = get_redis()
    cache_key = f"quote:{ticker}"
    cached = await redis.get(cache_key)
    if cached is not None:
        return dict(json.loads(cached))

    def _fetch() -> dict[str, Any]:
        history = yf.Ticker(ticker).history(period="1y")
        closes = history["Close"].tolist()
        return {"price": closes[-1] if closes else None, "closes": closes}

    result = await _retry_fetch(_fetch)
    await redis.set(cache_key, json.dumps(result), ex=QUOTE_CACHE_TTL)
    return result


async def fetch_fundamentals(ticker: str) -> dict[str, Any]:
    redis = get_redis()
    cache_key = f"fundamentals:{ticker}"
    cached = await redis.get(cache_key)
    if cached is not None:
        return dict(json.loads(cached))

    def _fetch() -> dict[str, Any]:
        info = yf.Ticker(ticker).info
        debt_to_equity = info.get("debtToEquity")
        return {
            "peg_ratio": info.get("pegRatio") or info.get("trailingPegRatio"),
            "roe": info.get("returnOnEquity"),
            # yfinance reports debtToEquity as a percent-like number (e.g. 45.0
            # meaning 45%), not a plain ratio -- normalize to match the other
            # plain-decimal fields. Verify against real data in Task 10.
            "debt_to_equity": (debt_to_equity / 100 if debt_to_equity is not None else None),
            "revenue_growth": info.get("revenueGrowth"),
            "profit_margin": info.get("profitMargins"),
        }

    result = await _retry_fetch(_fetch)
    await redis.set(cache_key, json.dumps(result), ex=FUNDAMENTALS_CACHE_TTL)
    return result


async def fetch_price_history(ticker: str, start: date, end: date) -> list[float]:
    redis = get_redis()
    cache_key = f"history:{ticker}:{start.isoformat()}:{end.isoformat()}"
    cached = await redis.get(cache_key)
    if cached is not None:
        return json.loads(cached)  # type: ignore[no-any-return]

    def _fetch() -> list[float]:
        history = yf.Ticker(ticker).history(start=start, end=end)
        closes: list[float] = history["Close"].tolist()
        return closes

    result = await _retry_fetch(_fetch)
    if not result:
        return result
    await redis.set(cache_key, json.dumps(result), ex=HISTORY_CACHE_TTL)
    return result


# Yahoo also returns futures, crypto, indexes and currencies; only these two are things you hold.
_SEARCH_TYPES = {"EQUITY": "STOCK", "ETF": "ETF"}


async def search_symbols(query: str) -> list[dict[str, str]]:
    """Stocks and ETFs matching a name, a ticker or an ISIN, as `{symbol, name, type, exchange}`."""
    normalized = query.strip().lower()
    redis = get_redis()
    cache_key = f"search:{normalized}"
    cached = await redis.get(cache_key)
    if cached is not None:
        return list(json.loads(cached))

    def _fetch() -> list[dict[str, str]]:
        # Ask for double: futures, crypto and the like are filtered out below, and 8 should remain.
        quotes = yf.Search(normalized, max_results=SEARCH_MAX_RESULTS * 2, news_count=0).quotes
        matches = [
            {
                "symbol": quote["symbol"],
                "name": quote.get("longname") or quote.get("shortname") or quote["symbol"],
                "type": _SEARCH_TYPES[quote["quoteType"]],
                "exchange": quote.get("exchDisp") or quote.get("exchange") or "",
            }
            for quote in quotes
            if quote.get("symbol") and quote.get("quoteType") in _SEARCH_TYPES
        ]
        return matches[:SEARCH_MAX_RESULTS]

    result = await _retry_fetch(_fetch)
    await redis.set(cache_key, json.dumps(result), ex=SEARCH_CACHE_TTL)
    return result


CURRENCY_CACHE_TTL = 86400


async def fetch_currency(ticker: str) -> str | None:
    """The currency a ticker is quoted in (for example "EUR", "USD", "GBp"), or None if unknown."""
    redis = get_redis()
    cache_key = f"currency:{ticker}"
    cached = await redis.get(cache_key)
    if cached:
        return str(cached)

    def _fetch() -> str | None:
        value = yf.Ticker(ticker).fast_info["currency"]
        return str(value) if value else None

    currency = await _retry_fetch(_fetch)
    if currency:
        await redis.set(cache_key, currency, ex=CURRENCY_CACHE_TTL)
    return currency
