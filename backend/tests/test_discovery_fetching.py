from datetime import date
from typing import Any

import pandas as pd
import pytest

import app.discovery.fetching as fetching
from app.discovery.fetching import RawSymbolData, fetch_all, fetch_yfinance


class YFRateLimitError(Exception):
    """Same class name yfinance uses: the code matches on the name, not the import."""


def empty() -> RawSymbolData:
    return RawSymbolData(info={}, history_days=0, last_close_date=None)


def fake_ticker(info: dict[str, Any], closes: list[float], dates: list[str]) -> Any:
    class FakeTicker:
        def __init__(self, symbol: str) -> None:
            self.info = info

        def history(self, period: str) -> pd.DataFrame:
            return pd.DataFrame({"Close": closes}, index=pd.to_datetime(dates))

    return FakeTicker


def test_fetch_returns_the_dated_closes_without_the_gaps(monkeypatch: pytest.MonkeyPatch) -> None:
    ticker = fake_ticker(
        {"longName": "SAP SE"},
        [10.0, 11.0, float("nan"), 12.0],
        ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"],
    )
    monkeypatch.setattr(fetching.yf, "Ticker", ticker)

    raw = fetch_yfinance("SAP.DE")

    assert raw.info == {"longName": "SAP SE"}
    assert raw.closes == [10.0, 11.0, 12.0]
    assert raw.dates == ["2026-10-12", "2026-10-13", "2026-10-15"]  # the NaN bar is dropped
    assert (raw.history_days, raw.last_close_date) == (3, date(2026, 10, 15))


def test_a_symbol_with_no_bars_has_empty_series(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fetching.yf, "Ticker", fake_ticker({}, [], []))

    raw = fetch_yfinance("GONE")

    assert (raw.closes, raw.dates, raw.history_days, raw.last_close_date) == ([], [], 0, None)


def test_fetch_raises_the_last_error_after_three_attempts(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts: list[str] = []

    def failing_ticker(symbol: str) -> None:
        attempts.append(symbol)
        raise ValueError(f"attempt {len(attempts)}")

    monkeypatch.setattr(fetching.yf, "Ticker", failing_ticker)
    monkeypatch.setattr(fetching.time, "sleep", lambda seconds: None)

    with pytest.raises(ValueError, match="attempt 3"):
        fetch_yfinance("SAP.DE")

    assert attempts == ["SAP.DE"] * 3


def test_a_rate_limit_is_not_retried_inside_the_fetch(monkeypatch: pytest.MonkeyPatch) -> None:
    # The cooldown pass in fetch_all handles it; retrying at once would only deepen the throttle.
    attempts: list[str] = []

    def throttled(symbol: str) -> None:
        attempts.append(symbol)
        raise YFRateLimitError

    monkeypatch.setattr(fetching.yf, "Ticker", throttled)

    with pytest.raises(YFRateLimitError):
        fetch_yfinance("SAP.DE")

    assert attempts == ["SAP.DE"]


def test_fetch_all_retries_rate_limited_symbols_after_a_cooldown() -> None:
    calls: dict[str, int] = {}
    sleeps: list[float] = []

    def flaky(ticker: str) -> RawSymbolData:
        calls[ticker] = calls.get(ticker, 0) + 1
        if ticker == "B" and calls[ticker] == 1:
            raise YFRateLimitError
        return empty()

    results = fetch_all(["A", "B"], flaky, workers=1, passes=3, cooldown=30.0, sleep=sleeps.append)

    assert all(isinstance(r, RawSymbolData) for r in results.values())
    assert calls == {"A": 1, "B": 2}
    assert sleeps == [30.0]


def test_fetch_all_gives_up_after_the_last_pass() -> None:
    sleeps: list[float] = []

    def always_throttled(ticker: str) -> RawSymbolData:
        raise YFRateLimitError

    results = fetch_all(
        ["A"], always_throttled, workers=1, passes=2, cooldown=5.0, sleep=sleeps.append
    )

    assert isinstance(results["A"], Exception)
    assert sleeps == [5.0]
