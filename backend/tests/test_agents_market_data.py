from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agents.market_data import (
    fetch_currency,
    fetch_fundamentals,
    fetch_price_history,
    fetch_quote_and_history,
)


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


def _run_currency(fast_info, cached=None):
    fake_ticker = MagicMock()
    fake_ticker.fast_info = fast_info
    with (
        patch("app.agents.market_data.yf.Ticker", return_value=fake_ticker) as mock_yf,
        patch("app.agents.market_data.get_redis") as mock_get_redis,
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = cached
        mock_get_redis.return_value = mock_redis
        import asyncio

        result = asyncio.run(fetch_currency("AAPL"))
    return result, mock_yf, mock_redis


def test_fetch_currency_reads_fast_info_and_caches_it():
    result, mock_yf, mock_redis = _run_currency({"currency": "USD"})
    assert result == "USD"
    mock_yf.assert_called_once_with("AAPL")
    assert mock_redis.set.call_args.args[:2] == ("currency:AAPL", "USD")
    assert mock_redis.set.call_args.kwargs["ex"] == 86400


def test_fetch_currency_cache_hit_skips_yfinance():
    result, mock_yf, _ = _run_currency({"currency": "USD"}, cached="GBp")
    assert result == "GBp"
    mock_yf.assert_not_called()


def test_fetch_currency_missing_field_is_none_and_not_cached():
    result, _, mock_redis = _run_currency({"currency": None})
    assert result is None
    mock_redis.set.assert_not_called()


@pytest.mark.parametrize("fetch", ["quote", "history"])
def test_empty_trailing_closes_are_dropped(fetch):
    """Yahoo's newest row can have no close (nan, e.g. at the weekend): the price is the last real
    close, not nan."""
    fake_ticker = MagicMock()
    fake_ticker.history.return_value.__getitem__.return_value.tolist.return_value = [
        100.0,
        101.0,
        float("nan"),
    ]

    with (
        patch("app.agents.market_data.yf.Ticker", return_value=fake_ticker),
        patch("app.agents.market_data.get_redis") as mock_get_redis,
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = None
        mock_get_redis.return_value = mock_redis

        import asyncio

        if fetch == "quote":
            result = asyncio.run(fetch_quote_and_history("IWDA.L"))
            assert result == {"price": 101.0, "closes": [100.0, 101.0]}
        else:
            result = asyncio.run(fetch_price_history("IWDA.L", date(2026, 9, 1), date(2026, 10, 9)))
            assert result == [100.0, 101.0]
