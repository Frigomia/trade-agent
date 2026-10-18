import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd

from app.agents.market_data import fetch_dated_closes, fetch_profile


def test_dated_history_preserves_dates_when_dropping_invalid_closes():
    frame = pd.DataFrame(
        {"Close": [100.0, float("nan"), 102.0, 0.0, float("inf"), -5.0]},
        index=pd.date_range("2026-10-01", periods=6, tz="Asia/Tokyo"),
    )
    redis, ticker = AsyncMock(), MagicMock()
    redis.get.return_value = None
    ticker.history.return_value = frame
    with (
        patch("app.agents.market_data.get_redis", return_value=redis),
        patch("app.agents.market_data.yf.Ticker", return_value=ticker),
    ):
        result = asyncio.run(fetch_dated_closes("A", "6mo"))

    assert result == {"2026-10-01": 100, "2026-10-03": 102}
    ticker.history.assert_called_once_with(period="6mo")
    assert redis.get.call_args.args == ("dated_closes:v2:A:6mo",)
    assert json.loads(redis.set.call_args.args[1]) == result
    assert redis.set.call_args.kwargs["ex"] == 300


def test_dated_history_cache_hit_avoids_yahoo():
    redis = AsyncMock()
    redis.get.return_value = '{"2026-10-01": 100.0}'
    with (
        patch("app.agents.market_data.get_redis", return_value=redis),
        patch("app.agents.market_data.yf.Ticker") as ticker,
    ):
        assert asyncio.run(fetch_dated_closes("A")) == {"2026-10-01": 100}
    ticker.assert_not_called()


def test_intraday_valuation_refreshes_after_five_minutes_and_ignores_old_day_cache():
    now = 0
    cache = {"dated_closes:A:1y": ('{"2026-10-01": 42.0}', 86400)}
    redis, ticker = AsyncMock(), MagicMock()
    ticker.history.side_effect = [
        pd.DataFrame({"Close": [value]}, index=pd.date_range("2026-10-01", periods=1))
        for value in (100.0, 120.0)
    ]

    async def get(key):
        value, expires = cache.get(key, (None, 0))
        return value if now < expires else None

    async def set_value(key, value, ex):
        cache[key] = (value, now + ex)

    redis.get.side_effect, redis.set.side_effect = get, set_value

    async def exercise():
        nonlocal now
        assert await fetch_dated_closes("A") == {"2026-10-01": 100.0}
        now = 299
        assert await fetch_dated_closes("A") == {"2026-10-01": 100.0}
        now = 301
        assert await fetch_dated_closes("A") == {"2026-10-01": 120.0}

    with (
        patch("app.agents.market_data.get_redis", return_value=redis),
        patch("app.agents.market_data.yf.Ticker", return_value=ticker),
    ):
        asyncio.run(exercise())
    assert ticker.history.call_count == 2


def test_dated_history_retries_then_short_caches_an_empty_result():
    redis, ticker = AsyncMock(), MagicMock()
    redis.get.return_value = None
    ticker.history.side_effect = [RuntimeError("unavailable"), pd.DataFrame({"Close": []})]
    with (
        patch("app.agents.market_data.get_redis", return_value=redis),
        patch("app.agents.market_data.yf.Ticker", return_value=ticker),
        patch("app.agents.market_data.asyncio.sleep", AsyncMock()) as sleep,
    ):
        assert asyncio.run(fetch_dated_closes("A")) == {}
    assert ticker.history.call_count == 2
    sleep.assert_awaited_once()
    assert redis.set.call_args.args[1] == "{}"
    assert redis.set.call_args.kwargs["ex"] == 300


def test_profile_is_read_only_typed_metadata_with_category_and_cached():
    redis, ticker = AsyncMock(), MagicMock()
    redis.get.return_value = None
    ticker.info = {
        "longName": " Fund ",
        "category": "Global Equity",
        "quoteType": "ETF",
        "sector": None,
        "industry": 123,
        "country": "",
        "currency": "USD",
        "exchange": "NMS",
    }
    with (
        patch("app.agents.market_data.get_redis", return_value=redis),
        patch("app.agents.market_data.yf.Ticker", return_value=ticker),
    ):
        result = asyncio.run(fetch_profile("FUND"))
    assert result["name"] == "Fund" and result["category"] == "Global Equity"
    assert result["sector"] is None and result["industry"] is None and result["country"] is None
    assert result["quote_type"] == "ETF" and result["exchange"] == "NMS"
    assert redis.set.call_args.kwargs["ex"] == 86400


def test_profile_cache_hit_avoids_yahoo():
    redis = AsyncMock()
    redis.get.return_value = '{"country": "Japan"}'
    with (
        patch("app.agents.market_data.get_redis", return_value=redis),
        patch("app.agents.market_data.yf.Ticker") as ticker,
    ):
        assert asyncio.run(fetch_profile("A")) == {"country": "Japan"}
    ticker.assert_not_called()


def test_profiles_bound_provider_strings_including_old_cache_entries():
    redis, ticker = AsyncMock(), MagicMock()
    ticker.info = {"sector": "s" * 5000, "country": "c" * 5000}
    for cached in (None, json.dumps(ticker.info)):
        redis.get.return_value = cached
        with (
            patch("app.agents.market_data.get_redis", return_value=redis),
            patch("app.agents.market_data.yf.Ticker", return_value=ticker),
        ):
            result = asyncio.run(fetch_profile("A"))
        assert result["sector"] == "s" * 100
        assert result["country"] == "c" * 100


def test_empty_profiles_are_negative_cached_for_five_minutes():
    redis, ticker = AsyncMock(), MagicMock()
    redis.get.return_value = None
    ticker.info = {}
    with (
        patch("app.agents.market_data.get_redis", return_value=redis),
        patch("app.agents.market_data.yf.Ticker", return_value=ticker),
    ):
        result = asyncio.run(fetch_profile("A"))
    assert not any(result.values())
    assert redis.set.call_args.kwargs["ex"] == 300


def test_exhausted_yahoo_errors_are_sanitized_and_negative_cached(caplog):
    for fetch in (fetch_dated_closes, fetch_profile):
        redis = AsyncMock()
        redis.get.return_value = None
        with (
            patch("app.agents.market_data.get_redis", return_value=redis),
            patch(
                "app.agents.market_data.yf.Ticker", side_effect=RuntimeError("private-token")
            ) as ticker,
            patch("app.agents.market_data.asyncio.sleep", AsyncMock()),
        ):
            assert asyncio.run(fetch("A")) == {}
        assert ticker.call_count == 3
        assert redis.set.call_args.kwargs["ex"] == 300
        assert "private-token" not in caplog.text


def test_negative_cache_hits_skip_all_yahoo_retries():
    for fetch in (fetch_dated_closes, fetch_profile):
        redis = AsyncMock()
        redis.get.return_value = "{}"
        with (
            patch("app.agents.market_data.get_redis", return_value=redis),
            patch("app.agents.market_data.yf.Ticker") as ticker,
        ):
            assert asyncio.run(fetch("A")) == {}
        ticker.assert_not_called()
