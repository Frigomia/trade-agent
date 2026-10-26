import asyncio
import json
import logging
import math
import warnings
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

import yfinance as yf
from yfinance.exceptions import YFPricesMissingError

from app.redis_client import get_redis

logger = logging.getLogger(__name__)

# `history(raise_errors=True)` is the per-call way to see request failures (the alternative is a
# process-wide flag other callers would feel); yfinance 1.x only marks it as deprecated.
warnings.filterwarnings("ignore", message="'raise_errors' deprecated", category=DeprecationWarning)

QUOTE_CACHE_TTL = 300
FUNDAMENTALS_CACHE_TTL = 900
HISTORY_CACHE_TTL = 86400
SEARCH_CACHE_TTL = 3600
SEARCH_MAX_RESULTS = 8
STALE_DAYS = 5  # quote display fallback; discovery keeps its exchange-aware freshness rules

RETRY_ATTEMPTS = 3
RETRY_BASE_DELAY_SECONDS = 1.0


def _finite(closes: list[float]) -> list[float]:
    """Yahoo's newest row can have no close (nan, e.g. at the weekend); drop those rows."""
    return [c for c in closes if math.isfinite(c)]


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
        result = dict(json.loads(cached))
        result.setdefault("as_of", None)
        result["stale"] = quote_is_stale(result.get("as_of"))
        return result

    def _fetch() -> dict[str, Any]:
        history = yf.Ticker(ticker).history(period="1y")
        values = history["Close"].tolist()
        closes = _finite(values)
        valid = [i for i, value in enumerate(values) if math.isfinite(value)]
        as_of = history.index[valid[-1]].date().isoformat() if valid else None
        return {"price": closes[-1] if closes else None, "closes": closes, "as_of": as_of}

    result = await _retry_fetch(_fetch)
    await redis.set(cache_key, json.dumps(result), ex=QUOTE_CACHE_TTL)
    result["stale"] = quote_is_stale(result.get("as_of"))
    return result


def quote_is_stale(as_of: object) -> bool:
    if not isinstance(as_of, str):
        return True
    try:
        age = (datetime.now(UTC).date() - date.fromisoformat(as_of)).days
    except ValueError:
        return True
    # Exchange-local bars may be one calendar day ahead of UTC.
    return age < -1 or age > STALE_DAYS


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
        return _finite(history["Close"].tolist())

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
ANALYTICS_NEGATIVE_CACHE_TTL = 300
PROFILE_TEXT_CHARS = 100


def _profile_text(value: object, max_chars: int = PROFILE_TEXT_CHARS) -> str | None:
    text = " ".join(value.split()) if isinstance(value, str) else ""
    return text[:max_chars] or None


def _symbol_has_no_prices(exc: YFPricesMissingError) -> bool:
    """True when Yahoo answered that the symbol has no data, not that it failed to answer."""
    reason = (exc.yahoo_reason or "").lower()
    if reason:
        return "no data found" in reason or "delisted" in reason
    return "status_code" not in str(exc.debug_info)  # an HTTP error body is not "no prices"


def _history_closes(ticker: str, **kwargs: Any) -> dict[str, float]:
    """`Ticker.history(**kwargs)` as closes by date: {} when Yahoo has no prices for the symbol, and
    anything else it raises (a throttle, a server error, with `raise_errors`) is an outage."""
    try:
        frame = yf.Ticker(ticker).history(**kwargs)
    except YFPricesMissingError as exc:  # only raised with raise_errors
        if _symbol_has_no_prices(exc):
            return {}
        raise
    return _closes_by_date(frame)


def _closes_by_date(frame: Any) -> dict[str, float]:
    """A history frame's positive finite closes by ISO date; {} for an unknown or delisted one."""
    if "Close" not in frame:
        return {}
    return {
        stamp.date().isoformat(): float(value)
        for stamp, value in frame["Close"].items()
        if math.isfinite(value) and value > 0
    }


async def fetch_closes_between(ticker: str, start: date, end: date) -> dict[str, float]:
    """Daily closes by date from `start` up to `end`, adjusted for splits but not for dividends
    (a price return). A provider failure is raised, never an empty result: {} means only that
    Yahoo has no prices for the symbol, so the caller can tell an outage from a dead ticker. Not
    cached."""

    return await _retry_fetch(
        lambda: _history_closes(ticker, start=start, end=end, auto_adjust=False, raise_errors=True)
    )


async def fetch_dated_closes(
    ticker: str, period: str = "1y", *, strict: bool = False
) -> dict[str, float]:
    """Positive finite daily closes with their actual dates; no forward fill across markets.

    A provider failure gives {} (cached briefly) so analytics degrade quietly. With `strict` it is
    raised instead and nothing is cached, for a caller that must tell an outage from no history:
    yfinance itself swallows a timeout or a bad response into an empty frame, so a strict read
    asks it to raise, and only "Yahoo has no prices for this symbol" stays an empty result.
    """
    redis = get_redis()
    # New namespace ignores entries written with the former 24-hour valuation TTL.
    cache_key = f"dated_closes:v2:{ticker}:{period}"
    cached = await redis.get(cache_key)
    if cached is not None:
        known = dict(json.loads(cached))
        # A strict caller does not trust a cached empty answer: another caller may have stored it
        # during an outage, and it would pass for "no history".
        if known or not strict:
            return known

    try:
        result = await _retry_fetch(
            lambda: _history_closes(
                ticker, period=period, **({"raise_errors": True} if strict else {})
            )
        )
    except Exception as exc:
        logger.warning("Dated history unavailable (%s)", type(exc).__name__)
        if strict:
            raise
        result = {}
    ttl = QUOTE_CACHE_TTL if result else ANALYTICS_NEGATIVE_CACHE_TTL
    await redis.set(cache_key, json.dumps(result), ex=ttl)
    return result


async def fetch_profile(ticker: str) -> dict[str, str | None]:
    """Cached metadata for analytics and holding auto-fill; never invented when unavailable."""
    redis = get_redis()
    cache_key = f"profile:v2:{ticker}"
    cached = await redis.get(cache_key)
    if cached is not None:
        # Bound old cached entries too; a rollout must not preserve oversized provider strings.
        return {
            field: _profile_text(value, 200 if field == "name" else PROFILE_TEXT_CHARS)
            for field, value in dict(json.loads(cached)).items()
        }

    def _fetch() -> dict[str, str | None]:
        info = yf.Ticker(ticker).info or {}
        keys = {
            "name": "longName",
            "sector": "sector",
            "industry": "industry",
            "country": "country",
            "quote_type": "quoteType",
            "exchange": "exchange",
            "category": "category",
            "currency": "currency",
        }
        return {
            field: _profile_text(info.get(key), 200 if field == "name" else PROFILE_TEXT_CHARS)
            for field, key in keys.items()
        }

    try:
        result = await _retry_fetch(_fetch)
    except Exception as exc:
        logger.warning("Profile unavailable (%s)", type(exc).__name__)
        result = {}
    ttl = CURRENCY_CACHE_TTL if any(result.values()) else ANALYTICS_NEGATIVE_CACHE_TTL
    await redis.set(cache_key, json.dumps(result), ex=ttl)
    return result


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


EARNINGS_CACHE_TTL = 21600  # a next-earnings date changes rarely; six hours is plenty
EARNINGS_NONE_TTL = 3600  # "no date" is shorter: an empty answer can be a throttled one


def next_earnings_date(calendar: Any, today: date) -> date | None:
    """The next upcoming earnings date in yfinance's calendar (today or later), or None.

    The calendar is a dict whose "Earnings Date" holds one or two dates (a window while the
    exact day is unconfirmed); anything that is not a date is ignored, never guessed at.
    """
    raw = calendar.get("Earnings Date") if isinstance(calendar, dict) else None
    candidates = raw if isinstance(raw, list | tuple) else [raw]
    found: list[date] = []
    for item in candidates:
        day = item.date() if isinstance(item, datetime) else item
        if isinstance(day, date) and day >= today:
            found.append(day)
    return min(found) if found else None


async def fetch_next_earnings(ticker: str) -> date | None:
    """The next earnings date, cached; None when the provider has none (an ETF, no schedule).

    A provider failure raises after the retries, so a caller can tell "no date" from "could not
    look".
    """
    redis = get_redis()
    cache_key = f"next_earnings:v1:{ticker}"
    cached = await redis.get(cache_key)
    today = datetime.now(UTC).date()
    if cached is not None:
        stored = json.loads(cached)  # an ISO date, or null for "the provider has none"
        found = date.fromisoformat(stored) if stored else None
        # A date that has passed is no longer "the next" one: look again rather than answer None.
        if found is None or found >= today:
            return found

    calendar = await _retry_fetch(lambda: yf.Ticker(ticker).calendar)
    if not isinstance(calendar, dict):
        # An empty dict is a real "no schedule" answer; any other shape is not an answer at all, so
        # it is neither cached as one nor reported as one.
        raise ValueError("unexpected earnings calendar")
    found = next_earnings_date(calendar, today)
    await redis.set(
        cache_key,
        json.dumps(found.isoformat() if found else None),
        ex=EARNINGS_CACHE_TTL if found else EARNINGS_NONE_TTL,
    )
    return found
