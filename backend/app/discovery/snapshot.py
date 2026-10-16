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

from app.discovery.fetching import RawSymbolData
from app.discovery.peers import finite_number
from app.schemas_discovery import Coverage

# Core fundamentals counted for coverage (plan section 4.3). A field counts as present when it is
# a finite number: zero is a real value, None and NaN are gaps.
CORE_FIELDS = (
    "returnOnEquity",
    "profitMargins",
    "operatingMargins",
    "revenueGrowth",
    "debtToEquity",
    "freeCashflow",
    "trailingPE",
    "priceToBook",
    "enterpriseToEbitda",
    "marketCap",
)

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


# The days of the week an exchange trades (Monday is 0). Monday to Friday unless listed. Only
# exchanges whose week is documented are listed; pass `trading_weekdays` for others, for example
# Egypt, Kuwait and Qatar, which are not listed until verified.
MON_FRI = (0, 1, 2, 3, 4)
TRADING_WEEKDAYS: Mapping[str | None, tuple[int, ...]] = {
    # Saudi Exchange: Sunday to Thursday
    # https://fi.saudiexchange.sa/wps/portal/international/general-information?locale=en
    "SAU": (6, 0, 1, 2, 3),
}


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
    def from_json(cls, text: str | bytes) -> "SymbolSnapshot":
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
    trading_weekdays: Mapping[str | None, Collection[int]] | None = None,
) -> Freshness:
    """Judge each last close against what is known about its own exchange.

    `closed_days` are independently verified closures per exchange and `trading_weekdays` the
    days of the week it trades (Monday to Friday unless listed); both are supplied by the caller.
    For each symbol with bars:
    1. A close within the latest three trading days is current.
    2. Behind its peers: with at least five usable histories on the exchange, a symbol that missed
       three or more of the sessions its peers actually traded since its last close is stale. This
       holds whether or not the peers are current themselves, and no closure can erase it.
    3. Every trading day since its last close, up to the current window, is a verified closure:
       fresh.
    4. Peers are current and it missed fewer than three sessions: fresh.
    5. Nobody on the exchange is current: a holiday, a provider outage and an outdated cache look
       the same, so it is uncertain, or stale once the exchange has been silent over two weeks.
    6. Too few usable histories to compare: calendar days decide.
    Records without bars are stale and never count as histories.
    """
    closed = closed_days or {}
    weeks: dict[str | None, Collection[int]] = {**TRADING_WEEKDAYS, **(trading_weekdays or {})}
    by_exchange: dict[str | None, list[SymbolSnapshot]] = defaultdict(list)
    for snapshot in snapshots:
        by_exchange[snapshot.exchange].append(snapshot)

    stale: dict[str, str] = {}
    uncertain: dict[str, str] = {}
    for exchange, group in by_exchange.items():
        label = exchange or "unknown exchange"
        week = weeks.get(exchange) or MON_FRI  # an empty week would never reach a cutoff
        cutoff = _cutoff(today, week)
        usable = [s for s in group if s.dates]
        stale.update({s.ticker: "no price history" for s in group if not s.dates})
        latest = max((s.dates[-1] for s in usable), default="")
        enough = len(usable) >= MIN_SYMBOLS
        for s in usable:
            last = date.fromisoformat(s.dates[-1])
            if last >= cutoff:
                continue
            missed = len({d for p in usable for d in p.dates if s.dates[-1] < d <= latest})
            if enough and missed >= SESSIONS_FRESH:
                stale[s.ticker] = (
                    f"last close {last} is behind the {label} exchange, which traded "
                    f"{missed} sessions since"
                )
            elif _closure_explains(last, cutoff, closed.get(exchange, ()), week):
                continue
            elif enough and date.fromisoformat(latest) >= cutoff:
                continue  # its peers are current and it missed fewer than three sessions
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


def _cutoff(today: date, week: Collection[int]) -> date:
    """The oldest date still counted as current: the third most recent trading day up to today."""
    day, found = today, 0
    while True:
        if day.weekday() in week:
            found += 1
            if found == SESSIONS_FRESH:
                return day
        day -= timedelta(days=1)


def _closure_explains(
    last: date, cutoff: date, closed: Collection[date], week: Collection[int]
) -> bool:
    """True when every trading day after `last` up to the cutoff is a verified closure."""
    gap = (last + timedelta(days=n) for n in range(1, (cutoff - last).days + 1))
    return all(day.weekday() not in week or day in closed for day in gap)


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def to_snapshot(ticker: str, raw: RawSymbolData) -> SymbolSnapshot:
    info = raw.info
    return SymbolSnapshot(
        ticker=ticker,
        asset_type="ETF" if info.get("quoteType") == "ETF" else "STOCK",
        name=_text(info.get("longName")) or _text(info.get("shortName")) or ticker,
        exchange=_text(info.get("exchange")),
        sector=_text(info.get("sector")),
        industry=_text(info.get("industry")),
        currency=_text(info.get("currency")),
        price=raw.closes[-1] if raw.closes else None,
        market_cap=finite_number(info.get("marketCap")),
        avg_volume=finite_number(info.get("averageVolume")),
        metrics=normalize_metrics(info),
        closes=raw.closes,
        dates=raw.dates,
    )
