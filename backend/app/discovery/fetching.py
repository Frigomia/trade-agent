"""Fetching a symbol from Yahoo without hammering it.

Yahoo throttles bulk requests, so fetching is slow on purpose: few workers, and symbols it
throttles are retried one at a time after a cooldown. Used by the validation script and by the
weekly snapshot.
"""

import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import yfinance as yf

# yfinance raises a class with this name when throttled; matching on the name keeps this module
# free of an import that can change between yfinance versions.
RATE_LIMIT_ERROR = "YFRateLimitError"


@dataclass(frozen=True)
class RawSymbolData:
    info: dict[str, Any]
    history_days: int
    last_close_date: date | None
    closes: list[float] = field(default_factory=list)  # the last year, oldest first
    dates: list[str] = field(default_factory=list)  # ISO date of each close


Fetch = Callable[[str], RawSymbolData]


def fetch_all(
    tickers: list[str],
    fetch: Fetch,
    workers: int,
    passes: int = 3,
    cooldown: float = 60.0,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, RawSymbolData | Exception]:
    """Fetch every ticker; symbols Yahoo throttled are retried after a cooldown.

    Each later pass runs single-threaded, which is what Yahoo tolerates best.
    """

    def attempt(ticker: str) -> RawSymbolData | Exception:
        try:
            return fetch(ticker)
        except Exception as exc:  # kept as a value; the caller classifies it
            return exc

    results: dict[str, RawSymbolData | Exception] = {}
    pending = list(tickers)
    for pass_number in range(passes):
        if pass_number > 0:
            sleep(cooldown)
        pool_size = workers if pass_number == 0 else 1
        with ThreadPoolExecutor(max_workers=pool_size) as pool:
            for ticker, outcome in zip(pending, pool.map(attempt, pending), strict=True):
                results[ticker] = outcome
        pending = [
            t
            for t in pending
            if isinstance(results[t], Exception) and type(results[t]).__name__ == RATE_LIMIT_ERROR
        ]
        if not pending:
            break
    return results


def fetch_yfinance(ticker: str) -> RawSymbolData:
    """Blocking network call. Retries twice: Yahoo drops requests under load."""
    last_error: Exception = RuntimeError("no attempt was made")
    for attempt in range(3):
        try:
            # By default yfinance hides chart errors and returns an empty frame, which would look
            # like a successful fetch (and bypass the retries). Process-wide, set on every call.
            yf.config.debug.hide_exceptions = False
            handle = yf.Ticker(ticker)
            info = dict(handle.info or {})
            closes = handle.history(period="1y")["Close"].dropna()
            if closes.empty:  # unavailable history is a failure, so a cached one is kept
                raise ValueError(f"{ticker}: no price history returned")
            return RawSymbolData(
                info=info,
                history_days=len(closes),
                last_close_date=closes.index[-1].date() if len(closes) else None,
                closes=[float(c) for c in closes],
                dates=[stamp.date().isoformat() for stamp in closes.index],
            )
        except Exception as exc:  # recorded by the caller with the class name
            if type(exc).__name__ == RATE_LIMIT_ERROR:
                raise  # fail fast: fetch_all retries throttled symbols after a cooldown
            last_error = exc
            time.sleep(1.0 * (attempt + 1))
    raise last_error
