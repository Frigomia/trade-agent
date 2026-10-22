import asyncio
import inspect
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

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


def test_dated_history_failure_is_empty_and_cached_briefly_unless_strict():
    redis, ticker = AsyncMock(), MagicMock()
    redis.get.return_value = None
    ticker.history.side_effect = RuntimeError("yahoo down")
    with (
        patch("app.agents.market_data.get_redis", return_value=redis),
        patch("app.agents.market_data.yf.Ticker", return_value=ticker),
        patch("app.agents.market_data.asyncio.sleep", AsyncMock()),
    ):
        assert asyncio.run(fetch_dated_closes("A")) == {}
        assert redis.set.call_count == 1  # the empty answer is cached for a short while

        redis.set.reset_mock()
        with pytest.raises(RuntimeError):
            asyncio.run(fetch_dated_closes("A", strict=True))
        redis.set.assert_not_called()  # an outage is not remembered as "no history"


def test_dated_history_for_an_unknown_symbol_is_empty_not_an_error_even_when_strict():
    redis, ticker = AsyncMock(), MagicMock()
    redis.get.return_value = None
    ticker.history.return_value = pd.DataFrame()  # what yfinance returns for a delisted symbol
    with (
        patch("app.agents.market_data.get_redis", return_value=redis),
        patch("app.agents.market_data.yf.Ticker", return_value=ticker),
    ):
        assert asyncio.run(fetch_dated_closes("GONE", strict=True)) == {}


def test_strict_dated_history_ignores_a_cached_empty_answer_but_not_a_cached_series():
    redis, ticker = AsyncMock(), MagicMock()
    ticker.history.return_value = pd.DataFrame(
        {"Close": [100.0]}, index=pd.date_range("2026-10-01", periods=1)
    )
    with (
        patch("app.agents.market_data.get_redis", return_value=redis),
        patch("app.agents.market_data.yf.Ticker", return_value=ticker),
    ):
        redis.get.return_value = "{}"  # stored by a caller during an outage
        assert asyncio.run(fetch_dated_closes("A")) == {}
        assert asyncio.run(fetch_dated_closes("A", strict=True)) == {"2026-10-01": 100.0}

        redis.get.return_value = '{"2026-10-02": 7.0}'
        ticker.history.reset_mock()
        assert asyncio.run(fetch_dated_closes("A", strict=True)) == {"2026-10-02": 7.0}
        ticker.history.assert_not_called()


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
    redis.get.assert_awaited_once_with("profile:v2:A")


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


def test_profile_cache_namespace_ignores_legacy_entries_without_currency():
    redis, ticker = AsyncMock(), MagicMock()
    redis.get.side_effect = lambda key: '{"country":"Japan"}' if key == "profile:A" else None
    ticker.info = {"longName": "A" * 180, "currency": "JPY"}
    with (
        patch("app.agents.market_data.get_redis", return_value=redis),
        patch("app.agents.market_data.yf.Ticker", return_value=ticker),
    ):
        result = asyncio.run(fetch_profile("A"))
    assert result["currency"] == "JPY"
    assert result["name"] == "A" * 180
    assert redis.set.call_args.args[0] == "profile:v2:A"


def test_profile_cached_names_are_bounded_to_holding_name_column():
    redis = AsyncMock()
    redis.get.return_value = json.dumps({"name": "A" * 500, "sector": "s" * 500})
    with patch("app.agents.market_data.get_redis", return_value=redis):
        result = asyncio.run(fetch_profile("A"))
    assert result == {"name": "A" * 200, "sector": "s" * 100}


def _real_history(strict: bool, transport: object) -> tuple[dict[str, float] | str, int]:
    """fetch_dated_closes through yfinance's own history code, with only the HTTP getter faked.

    Returns the result (or the name of the exception it raised) and how many cache writes it made.
    """
    redis = AsyncMock()
    redis.get.return_value = None
    with (
        patch("app.agents.market_data.get_redis", return_value=redis),
        patch("yfinance.data.YfData.get", side_effect=transport),
        patch("yfinance.data.YfData.cache_get", side_effect=transport),
        patch("app.agents.market_data.asyncio.sleep", AsyncMock()),
    ):
        try:
            result = asyncio.run(fetch_dated_closes("AAPL", "1y", strict=strict))
        except Exception as exc:
            result = type(exc).__name__
    return result, redis.set.call_count


def test_a_transport_timeout_inside_yfinance_is_an_outage_only_for_a_strict_read():
    # yfinance swallows a request timeout into an empty frame unless it is asked to raise.
    assert _real_history(False, TimeoutError("timed out")) == ({}, 1)
    # An outage is raised and not remembered as "no history".
    assert _real_history(True, TimeoutError("timed out")) == ("TimeoutError", 0)


def test_yahoo_saying_there_are_no_prices_is_empty_history_even_for_a_strict_read():
    response = MagicMock(text="{}")
    response.json.return_value = {
        "chart": {"result": None, "error": {"description": "No data found, symbol may be delisted"}}
    }

    assert _real_history(True, [response] * 10) == ({}, 1)


@pytest.mark.parametrize(
    "body",
    [
        {"chart": {"result": None, "error": {"description": "Too Many Requests"}}},
        {"chart": {"result": None, "error": {"description": "Internal Server Error"}}},
        {"status_code": 502},
    ],
)
def test_other_yahoo_errors_are_an_outage_for_a_strict_read(body):
    response = MagicMock(text="{}")
    response.json.return_value = body

    result, cached = _real_history(True, [response] * 10)

    assert result == "YFPricesMissingError"
    assert cached == 0


def test_yfinance_still_has_the_per_call_switch_the_strict_read_relies_on():
    # An upgrade that drops `raise_errors` must fail here, not as a quiet empty chart in production.
    from yfinance.scrapers.history import PriceHistory

    assert "raise_errors" in inspect.signature(PriceHistory.history).parameters
