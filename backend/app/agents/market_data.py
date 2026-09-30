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
