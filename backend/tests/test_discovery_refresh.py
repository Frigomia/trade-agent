import asyncio
from collections.abc import Coroutine
from datetime import date
from typing import Any
from unittest.mock import patch

import pytest

import app.redis_client as redis_client_module
from app.discovery.fetching import RawSymbolData
from app.discovery.refresh import (
    SNAPSHOT_TTL_SECONDS,
    RefreshReport,
    load_snapshot,
    refresh_snapshot,
)
from app.discovery.snapshot import to_snapshot
from app.redis_client import get_redis


def run(coro: Coroutine[Any, Any, Any]) -> Any:
    try:
        return asyncio.run(coro)
    finally:
        redis_client_module._redis = None  # the cached client is bound to the loop that just closed


class YFRateLimitError(Exception):
    """Same class name yfinance uses."""


class Stop(BaseException):
    """An interruption that is not an ordinary error (a killed job)."""


class Fetcher:
    def __init__(
        self, fail: set[str] = frozenset(), throttle_once: set[str] = frozenset(), stop_at: str = ""
    ):
        self.calls: list[str] = []
        self.fail, self.throttle_once, self.stop_at = set(fail), set(throttle_once), stop_at

    def __call__(self, ticker: str) -> RawSymbolData:
        self.calls.append(ticker)
        if ticker == self.stop_at:
            raise Stop
        if ticker in self.fail:
            raise ValueError("no data")
        if ticker in self.throttle_once:
            self.throttle_once.discard(ticker)
            raise YFRateLimitError
        info = {"longName": ticker, "quoteType": "EQUITY", "exchange": "GER"}
        return RawSymbolData(info, 2, date(2026, 10, 15), [1.0, 2.0], ["2026-10-14", "2026-10-15"])


def refresh(tickers: list[str], fetch: Fetcher, **kw) -> RefreshReport:  # type: ignore[no-untyped-def]
    return run(refresh_snapshot(tickers, fetch=fetch, workers=1, sleep=lambda s: None, **kw))


def load(tickers: list[str]):  # type: ignore[no-untyped-def]
    return run(load_snapshot(tickers))


def test_every_fetched_symbol_is_stored_and_can_be_loaded() -> None:
    report = refresh(["A", "B"], Fetcher())

    assert (report.cached, report.fetched, report.failed) == (0, 2, {})
    assert [s.ticker for s in load(["A", "B"])] == ["A", "B"]
    assert load(["A"])[0].dates == ["2026-10-14", "2026-10-15"]


def test_a_cached_symbol_is_not_fetched_again() -> None:
    fetcher = Fetcher()
    refresh(["A", "B"], fetcher)

    report = refresh(["A", "B"], fetcher)

    assert (report.cached, report.fetched) == (2, 0)
    assert fetcher.calls == ["A", "B"]


def test_a_second_run_resumes_with_only_what_is_missing() -> None:
    fetcher = Fetcher()
    refresh(["A", "B"], fetcher)

    report = refresh(["A", "B", "C", "D"], fetcher)

    assert (report.cached, report.fetched) == (2, 2)
    assert fetcher.calls == ["A", "B", "C", "D"]


def test_a_failing_symbol_is_reported_by_class_and_not_stored() -> None:
    report = refresh(["A", "B", "C"], Fetcher(fail={"B"}))

    assert (report.fetched, report.failed) == (2, {"B": "ValueError"})
    assert [s.ticker for s in load(["A", "B", "C"])] == ["A", "C"]
    assert run(get_redis().exists("discovery:symbol:B")) == 0  # nothing stored, so it is retried


def test_a_throttled_symbol_is_retried_after_the_cooldown() -> None:
    fetcher = Fetcher(throttle_once={"B"})

    report = refresh(["A", "B"], fetcher)

    assert (report.fetched, report.failed) == (2, {})
    assert fetcher.calls == ["A", "B", "B"]


def test_each_batch_is_stored_before_the_next_starts() -> None:
    fetcher = Fetcher(stop_at="E")  # the job dies in the third batch

    with pytest.raises(Stop):
        refresh(["A", "B", "C", "D", "E", "F"], fetcher, batch_size=2)

    assert [s.ticker for s in load(["A", "B", "C", "D", "E", "F"])] == ["A", "B", "C", "D"]


def test_a_stored_symbol_expires() -> None:
    refresh(["A"], Fetcher())

    ttl = run(get_redis().ttl("discovery:symbol:A"))

    assert 0 < ttl <= SNAPSHOT_TTL_SECONDS


def test_load_skips_missing_and_corrupt_entries_and_keeps_the_order() -> None:
    refresh(["B", "A"], Fetcher())
    run(get_redis().set("discovery:symbol:BAD", "not json"))
    run(get_redis().set("discovery:symbol:WRONG", '{"ticker": "WRONG"}'))

    loaded = load(["A", "BAD", "NEVER", "WRONG", "B"])

    assert [s.ticker for s in loaded] == ["A", "B"]


def test_an_empty_universe_is_not_an_error() -> None:
    assert refresh([], Fetcher()) == RefreshReport(cached=0, fetched=0, failed={})
    assert load([]) == []


def test_a_symbol_stored_in_an_earlier_run_is_fetched_again() -> None:
    fetcher = Fetcher()
    refresh(["A"], fetcher)
    run(get_redis().expire("discovery:symbol:A", SNAPSHOT_TTL_SECONDS - 2 * 24 * 3600))

    report = refresh(["A"], fetcher)

    assert (report.cached, report.fetched) == (0, 1)


def test_an_unreadable_stored_entry_is_fetched_again() -> None:
    run(get_redis().set("discovery:symbol:A", '{"ticker": "A"}', ex=SNAPSHOT_TTL_SECONDS))

    report = refresh(["A"], Fetcher())

    assert (report.cached, report.fetched) == (0, 1)
    assert [s.ticker for s in load(["A"])] == ["A"]


def test_a_symbol_that_cannot_be_stored_fails_alone() -> None:
    real = to_snapshot

    def broken(ticker: str, raw: RawSymbolData):  # type: ignore[no-untyped-def]
        if ticker == "B":
            raise ValueError("bad record")
        return real(ticker, raw)

    with patch("app.discovery.refresh.to_snapshot", broken):
        report = refresh(["A", "B", "C"], Fetcher())

    assert (report.fetched, report.failed) == (2, {"B": "ValueError"})
    assert [s.ticker for s in load(["A", "B", "C"])] == ["A", "C"]
