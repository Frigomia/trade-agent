"""The stored record of one symbol, and what can be said about a set of them without the network.

Fetching and caching come next; this is the data shape and the pure rules on it: turning Yahoo's
numbers into the units the peer and risk steps expect, counting what is present, and judging
freshness in each exchange's own sessions.
"""

import json
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Any

from app.discovery.peers import finite_number
from app.discovery.validate_universe import CORE_FIELDS, STALE_DAYS
from app.schemas_discovery import Coverage

# Taken as they are from Yahoo.
_PLAIN = (
    "returnOnEquity",
    "returnOnAssets",
    "profitMargins",
    "operatingMargins",
    "revenueGrowth",
    "freeCashflow",
    "ebitda",
    "trailingPE",
    "enterpriseToEbitda",
    "priceToSalesTrailing12Months",
    "priceToBook",
    "payoutRatio",
    "marketCap",
)
# Yahoo reports these as percent-like numbers (45 meaning 45%); the peer step wants fractions.
_PERCENT_LIKE = ("debtToEquity", "dividendYield")
METRIC_KEYS = (*_PLAIN, *_PERCENT_LIKE, "fcfMargin", "pegRatio")

SESSIONS_FRESH = 3  # a close among an exchange's latest three sessions is fresh
RECENT_SESSIONS = 10  # each symbol's last bars used to learn the exchange's sessions
MIN_SYMBOLS = 5  # fewer symbols on an exchange cannot tell its sessions apart
MAX_EXCHANGE_GAP_DAYS = 14  # an exchange silent for longer than any holiday is stale as a whole


@dataclass(frozen=True)
class SymbolSnapshot:
    ticker: str
    asset_type: str
    name: str
    exchange: str | None
    sector: str | None
    industry: str | None
    currency: str | None
    price: float | None
    market_cap: float | None
    avg_volume: float | None
    metrics: dict[str, float | None]
    closes: list[float]
    dates: list[str]  # ISO dates, one per close; the dated series correlations are built from

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, text: str) -> "SymbolSnapshot":
        return cls(**json.loads(text))


def normalize_metrics(info: dict[str, Any]) -> dict[str, float | None]:
    """Yahoo's `info` as the metrics the peer step reads. A missing or non-finite value is None."""
    number = {key: finite_number(info.get(key)) for key in (*_PLAIN, *_PERCENT_LIKE, "pegRatio")}
    metrics = {key: number[key] for key in _PLAIN}
    for key in _PERCENT_LIKE:
        metrics[key] = None if number[key] is None else number[key] / 100  # type: ignore[operator]
    revenue, fcf = finite_number(info.get("totalRevenue")), number["freeCashflow"]
    metrics["fcfMargin"] = fcf / revenue if fcf is not None and revenue and revenue > 0 else None
    # `trailingAnnualDividendYield` is never read: it is wrong by 100x for pence, cent and agora
    # quotes (normalization audit).
    peg = finite_number(info.get("trailingPegRatio"))
    metrics["pegRatio"] = number["pegRatio"] if number["pegRatio"] is not None else peg
    return metrics


def coverage_of(metrics: dict[str, float | None]) -> Coverage:
    missing = [field for field in CORE_FIELDS if metrics.get(field) is None]
    return Coverage(
        core_metrics_present=len(CORE_FIELDS) - len(missing),
        core_metrics_total=len(CORE_FIELDS),
        missing=missing,
    )


def find_stale(snapshots: Sequence[SymbolSnapshot], today: date) -> dict[str, str]:
    """Tickers whose last close is out of date, with the reason.

    Judged against the sessions of the symbol's own exchange, learned from the bars the snapshot
    already holds, so a holiday shared by the whole exchange makes nobody stale. An exchange with
    too few symbols falls back to calendar days.
    """
    by_exchange: dict[str | None, list[SymbolSnapshot]] = defaultdict(list)
    for snapshot in snapshots:
        by_exchange[snapshot.exchange].append(snapshot)

    stale: dict[str, str] = {}
    for exchange, group in by_exchange.items():
        label = exchange or "unknown exchange"
        sessions = _sessions(group) if len(group) >= MIN_SYMBOLS else []
        exchange_silent = bool(sessions) and (today - date.fromisoformat(sessions[-1])) > timedelta(
            days=MAX_EXCHANGE_GAP_DAYS
        )
        cutoff = sessions[-SESSIONS_FRESH] if len(sessions) >= SESSIONS_FRESH else None
        for s in group:
            last = s.dates[-1] if s.dates else None
            if last is None:
                stale[s.ticker] = "no price history"
            elif exchange_silent:
                stale[s.ticker] = f"{label} has no bar since {sessions[-1]}"
            elif sessions:
                if last < (cutoff or sessions[0]):
                    stale[s.ticker] = f"last close {last} is behind the latest {label} sessions"
            elif (today - date.fromisoformat(last)).days > STALE_DAYS:
                stale[s.ticker] = (
                    f"last close {last} is over {STALE_DAYS} calendar days old "
                    f"({label} has too few symbols to tell its sessions)"
                )
    return stale


def _sessions(group: list[SymbolSnapshot]) -> list[str]:
    """Dates on which at least half of the symbols that have bars traded, oldest first."""
    with_bars = [s for s in group if s.dates]
    seen = Counter(d for s in with_bars for d in set(s.dates[-RECENT_SESSIONS:]))
    return sorted(d for d, count in seen.items() if count * 2 >= len(with_bars))
