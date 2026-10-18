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
    assert redis.get.call_args.args == ("dated_closes:A:6mo",)
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


def test_dated_history_retries_and_does_not_cache_an_empty_result():
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
    redis.set.assert_not_called()


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
