"""Fetch the universe from Yahoo and keep each symbol in Redis (plan Phase 4).

One key per symbol, written as soon as its batch is fetched, so a run that dies resumes with only
what is missing, and a symbol is not fetched again while its key lives. Symbols that failed are
not stored and are tried again on the next run.
"""

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

from app.discovery.fetching import Fetch, RawSymbolData, fetch_all, fetch_yfinance
from app.discovery.snapshot import SymbolSnapshot, to_snapshot
from app.redis_client import get_redis

logger = logging.getLogger(__name__)

SNAPSHOT_TTL_SECONDS = 8 * 24 * 3600  # a weekly refresh, plus a day of slack
BATCH_SIZE = 50  # what a dying run can lose
WORKERS = 2  # Yahoo throttles beyond two or three
RESUME_WINDOW_SECONDS = 24 * 3600  # a run that died is resumed within a day; after that, refetch


@dataclass(frozen=True)
class RefreshReport:
    cached: int  # already stored, not fetched
    fetched: int
    failed: dict[str, str]  # ticker -> exception class name


def _key(ticker: str) -> str:
    return f"discovery:symbol:{ticker}"


def _readable(value: str | bytes) -> bool:
    try:
        SymbolSnapshot.from_json(value)
    except (ValueError, TypeError):
        return False
    return True


async def refresh_snapshot(
    tickers: list[str],
    *,
    fetch: Fetch = fetch_yfinance,
    workers: int = WORKERS,
    batch_size: int = BATCH_SIZE,
    sleep: Callable[[float], None] = time.sleep,
) -> RefreshReport:
    redis = get_redis()
    unique = list(dict.fromkeys(tickers))
    keys = [_key(t) for t in unique]
    stored = await redis.mget(keys) if unique else []
    async with redis.pipeline() as pipe:
        for key in keys:
            pipe.ttl(key)
        left = await pipe.execute() if unique else []
    # Present, readable and written in this run: a resume. An older entry (the TTL outlives the
    # weekly period) or one that no longer reads is fetched again.
    min_left = SNAPSHOT_TTL_SECONDS - RESUME_WINDOW_SECONDS
    missing = [
        t
        for t, value, ttl in zip(unique, stored, left, strict=True)
        if value is None or ttl < min_left or not _readable(value)
    ]

    failed: dict[str, str] = {}
    for start in range(0, len(missing), batch_size):
        batch = missing[start : start + batch_size]
        results = await asyncio.to_thread(fetch_all, batch, fetch, workers, sleep=sleep)
        for ticker, outcome in results.items():
            try:
                if not isinstance(outcome, RawSymbolData):
                    raise outcome
                snapshot = to_snapshot(ticker, outcome)
                await redis.set(_key(ticker), snapshot.to_json(), ex=SNAPSHOT_TTL_SECONDS)
            except Exception as exc:  # one bad record must not lose the rest of the batch
                failed[ticker] = type(exc).__name__
    return RefreshReport(len(unique) - len(missing), len(missing) - len(failed), failed)


async def load_snapshot(tickers: list[str]) -> list[SymbolSnapshot]:
    """The stored symbols, in the order asked. Missing and unreadable entries are left out."""
    unique = list(dict.fromkeys(tickers))
    if not unique:
        return []
    found: list[SymbolSnapshot] = []
    unreadable = 0
    for value in await get_redis().mget([_key(t) for t in unique]):
        if value is None:
            continue
        try:
            found.append(SymbolSnapshot.from_json(value))
        except (ValueError, TypeError):  # not JSON, or not the shape of a snapshot
            unreadable += 1
    if unreadable:
        logger.warning("Snapshot: %d stored entries could not be read and were skipped", unreadable)
    return found
