import asyncio
import json
from typing import Any

import yfinance as yf

from app.redis_client import get_redis

QUOTE_CACHE_TTL = 300
FUNDAMENTALS_CACHE_TTL = 900


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

    result = await asyncio.to_thread(_fetch)
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
            "peg_ratio": info.get("pegRatio"),
            "roe": info.get("returnOnEquity"),
            # yfinance reports debtToEquity as a percent-like number (e.g. 45.0
            # meaning 45%), not a plain ratio -- normalize to match the other
            # plain-decimal fields. Verify against real data in Task 10.
            "debt_to_equity": (debt_to_equity / 100 if debt_to_equity is not None else None),
            "revenue_growth": info.get("revenueGrowth"),
            "profit_margin": info.get("profitMargins"),
        }

    result = await asyncio.to_thread(_fetch)
    await redis.set(cache_key, json.dumps(result), ex=FUNDAMENTALS_CACHE_TTL)
    return result
