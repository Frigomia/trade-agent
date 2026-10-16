"""The stored record of one symbol, and what can be said about a set of them without the network.

Fetching and caching come next; this is the data shape and the pure rules on it: turning Yahoo's
numbers into the units the peer and risk steps expect, counting what is present, and judging
freshness in each exchange's own sessions.
"""

import json
from collections import defaultdict
from collections.abc import Collection, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Any

from app.discovery.peers import finite_number
from app.discovery.validate_universe import CORE_FIELDS
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

SESSIONS_FRESH = 3  # a close within the latest three weekdays is current; missing fewer is fine
MIN_SYMBOLS = 5  # fewer usable histories on an exchange cannot tell its sessions apart
CALENDAR_FALLBACK_DAYS = 5  # for an exchange with too few symbols to compare
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


@dataclass(frozen=True)
class Freshness:
    stale: dict[str, str]  # ticker -> why its price is out of date
    uncertain: dict[str, str]  # ticker -> why it cannot be told: shown, not excluded


def check_freshness(
    snapshots: Sequence[SymbolSnapshot],
    today: date,
    closed_days: Mapping[str | None, Collection[date]] | None = None,
) -> Freshness:
    """Judge each last close against what is known about its own exchange.

    A close within the latest three weekdays is current. An older one is fresh only when the days
    in between are weekends or `closed_days` for its exchange (independently verified closures,
    supplied by the caller). Otherwise:
    - peers on the same exchange are current: it is behind them, and stale once it has missed
      three of the sessions those peers traded;
    - nobody on the exchange is current: a holiday, a provider outage and an outdated cache look
      the same, so it is uncertain, or stale once the whole exchange has been silent for over two
      weeks;
    - too few usable histories to compare: calendar days decide.
    Records without bars are stale and never count as histories.
    """
    closed = closed_days or {}
    by_exchange: dict[str | None, list[SymbolSnapshot]] = defaultdict(list)
    for snapshot in snapshots:
        by_exchange[snapshot.exchange].append(snapshot)

    cutoff = _cutoff(today)
    stale: dict[str, str] = {}
    uncertain: dict[str, str] = {}
    for exchange, group in by_exchange.items():
        label = exchange or "unknown exchange"
        usable = [s for s in group if s.dates]
        stale.update({s.ticker: "no price history" for s in group if not s.dates})
        latest = max((s.dates[-1] for s in usable), default="")
        enough = len(usable) >= MIN_SYMBOLS
        for s in usable:
            last = date.fromisoformat(s.dates[-1])
            if last >= cutoff or _closure_explains(last, cutoff, closed.get(exchange, ())):
                continue
            if enough and date.fromisoformat(latest) >= cutoff:
                missed = len({d for p in usable for d in p.dates if s.dates[-1] < d <= latest})
                if missed >= SESSIONS_FRESH:
                    stale[s.ticker] = (
                        f"last close {last} is behind the {label} exchange, which traded "
                        f"{missed} sessions since"
                    )
            elif enough and (today - date.fromisoformat(latest)).days <= MAX_EXCHANGE_GAP_DAYS:
                uncertain[s.ticker] = (
                    f"no {label} symbol has a bar since {latest}: a holiday cannot be told from a "
                    f"data outage without a verified closure"
                )
            elif enough:
                stale[s.ticker] = f"{label} has no bar since {latest}"
            elif (today - last).days > CALENDAR_FALLBACK_DAYS:
                stale[s.ticker] = (
                    f"last close {last} is over {CALENDAR_FALLBACK_DAYS} calendar days old "
                    f"({label} has too few symbols to compare)"
                )
    return Freshness(stale, uncertain)


def _cutoff(today: date) -> date:
    """The oldest date still counted as current: the third most recent weekday up to today."""
    day, found = today, 0
    while True:
        if day.weekday() < 5:
            found += 1
            if found == SESSIONS_FRESH:
                return day
        day -= timedelta(days=1)


def _closure_explains(last: date, cutoff: date, closed: Collection[date]) -> bool:
    """True when every weekday after `last` up to the cutoff is a verified closure."""
    gap = (last + timedelta(days=n) for n in range(1, (cutoff - last).days + 1))
    return all(day.weekday() >= 5 or day in closed for day in gap)
