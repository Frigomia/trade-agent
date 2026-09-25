from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agents.market_data import fetch_fundamentals, fetch_price_history, fetch_quote_and_history


def test_fetch_quote_and_history_cache_miss_calls_yfinance():
    fake_ticker = MagicMock()
    fake_ticker.history.return_value.__getitem__.return_value.tolist.return_value = [
        100.0,
        101.0,
        102.0,
    ]

    with (
        patch("app.agents.market_data.yf.Ticker", return_value=fake_ticker) as mock_yf,
        patch("app.agents.market_data.get_redis") as mock_get_redis,
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = None
        mock_get_redis.return_value = mock_redis

        import asyncio

        result = asyncio.run(fetch_quote_and_history("AAPL"))

    mock_yf.assert_called_once_with("AAPL")
    assert result == {"price": 102.0, "closes": [100.0, 101.0, 102.0]}
    mock_redis.set.assert_called_once()
    assert mock_redis.set.call_args.kwargs["ex"] == 300


def test_fetch_quote_and_history_cache_hit_skips_yfinance():
    with (
        patch("app.agents.market_data.yf.Ticker") as mock_yf,
        patch("app.agents.market_data.get_redis") as mock_get_redis,
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = '{"price": 99.0, "closes": [99.0]}'
        mock_get_redis.return_value = mock_redis

        import asyncio

        result = asyncio.run(fetch_quote_and_history("AAPL"))

    mock_yf.assert_not_called()
    assert result == {"price": 99.0, "closes": [99.0]}


def test_fetch_fundamentals_normalizes_debt_to_equity():
    fake_ticker = MagicMock()
    fake_ticker.info = {
        "pegRatio": 1.1,
        "returnOnEquity": 0.18,
        "debtToEquity": 45.0,
        "revenueGrowth": 0.10,
        "profitMargins": 0.12,
    }

    with (
        patch("app.agents.market_data.yf.Ticker", return_value=fake_ticker),
        patch("app.agents.market_data.get_redis") as mock_get_redis,
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = None
        mock_get_redis.return_value = mock_redis

        import asyncio

        result = asyncio.run(fetch_fundamentals("AAPL"))

    assert result["debt_to_equity"] == 0.45
    assert result["peg_ratio"] == 1.1
    mock_redis.set.assert_called_once()
    assert mock_redis.set.call_args.kwargs["ex"] == 900


def test_fetch_price_history_cache_miss_calls_yfinance():
    fake_ticker = MagicMock()
    fake_ticker.history.return_value.__getitem__.return_value.tolist.return_value = [
        200.0,
        201.0,
        202.0,
    ]

    with (
        patch("app.agents.market_data.yf.Ticker", return_value=fake_ticker) as mock_yf,
        patch("app.agents.market_data.get_redis") as mock_get_redis,
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = None
        mock_get_redis.return_value = mock_redis

        import asyncio

        result = asyncio.run(fetch_price_history("AAPL", date(2020, 1, 1), date(2024, 1, 1)))

    mock_yf.assert_called_once_with("AAPL")
    fake_ticker.history.assert_called_once_with(start=date(2020, 1, 1), end=date(2024, 1, 1))
    assert result == [200.0, 201.0, 202.0]
    mock_redis.set.assert_called_once()
    assert mock_redis.set.call_args.kwargs["ex"] == 86400


def test_fetch_price_history_cache_hit_skips_yfinance():
    with (
        patch("app.agents.market_data.yf.Ticker") as mock_yf,
        patch("app.agents.market_data.get_redis") as mock_get_redis,
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = "[199.0, 200.0]"
        mock_get_redis.return_value = mock_redis

        import asyncio

        result = asyncio.run(fetch_price_history("AAPL", date(2020, 1, 1), date(2024, 1, 1)))

    mock_yf.assert_not_called()
    assert result == [199.0, 200.0]


def test_fetch_price_history_empty_result_not_cached():
    fake_ticker = MagicMock()
    fake_ticker.history.return_value.__getitem__.return_value.tolist.return_value = []

    with (
        patch("app.agents.market_data.yf.Ticker", return_value=fake_ticker),
        patch("app.agents.market_data.get_redis") as mock_get_redis,
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = None
        mock_get_redis.return_value = mock_redis

        import asyncio

        result = asyncio.run(fetch_price_history("AAPL", date(2020, 1, 1), date(2024, 1, 1)))

    assert result == []
    mock_redis.set.assert_not_called()


def test_fetch_quote_and_history_retries_on_failure_then_succeeds():
    fake_history = MagicMock()
    fake_history.__getitem__.return_value.tolist.return_value = [100.0, 101.0]

    fake_ticker = MagicMock()
    fake_ticker.history.side_effect = [Exception("boom"), fake_history]

    with (
        patch("app.agents.market_data.yf.Ticker", return_value=fake_ticker),
        patch("app.agents.market_data.get_redis") as mock_get_redis,
        patch("app.agents.market_data.asyncio.sleep", AsyncMock()) as mock_sleep,
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = None
        mock_get_redis.return_value = mock_redis

        import asyncio

        result = asyncio.run(fetch_quote_and_history("AAPL"))

    assert result == {"price": 101.0, "closes": [100.0, 101.0]}
    assert fake_ticker.history.call_count == 2
    mock_sleep.assert_called_once()


def test_fetch_quote_and_history_raises_after_exhausting_retries():
    fake_ticker = MagicMock()
    fake_ticker.history.side_effect = RuntimeError("rate limited")

    with (
        patch("app.agents.market_data.yf.Ticker", return_value=fake_ticker),
        patch("app.agents.market_data.get_redis") as mock_get_redis,
        patch("app.agents.market_data.asyncio.sleep", AsyncMock()),
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = None
        mock_get_redis.return_value = mock_redis

        import asyncio

        with pytest.raises(RuntimeError, match="rate limited"):
            asyncio.run(fetch_quote_and_history("AAPL"))

    assert fake_ticker.history.call_count == 3
