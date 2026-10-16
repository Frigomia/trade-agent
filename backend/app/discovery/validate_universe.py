"""Validation of the discovery universe file against live `yfinance` data.

Run from `backend/`: `uv run python -m app.discovery.validate_universe --report <path>`.

The checks are pure functions; the network (`yfinance`) is injected, so everything except
`fetch_yfinance` and `main` is testable offline. The command exits non-zero when too few symbols
pass, and writes a coverage report so the data limitations are documented (plan gate G1).
"""

import argparse
import math
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import yfinance as yf

from app.discovery.risk import MIN_HISTORY_DAYS, market_cap_to_eur, size_bucket_for
from app.discovery.universe import UNIVERSE_PATH, UniverseRow, load_universe, region_of
from app.fx import SUPPORTED, rate_from_price, rate_symbol

# Core fundamentals used for the coverage report (plan section 4.3). A field counts as present
# when it is a finite number: zero is a real value, None and NaN are gaps.
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

# Proposed defaults, confirmed in Phase 0. A stock below MIN_CORE_METRICS cannot be analysed
# meaningfully; a shorter history cannot give a volatility or a correlation.
MIN_CORE_METRICS = 3
# A last close older than this many calendar days is an unreliable price (plan section 4.1).
# INTERIM: a calendar-day proxy, not exchange-session aware (holidays differ by exchange). It is a
# validation aid for this script and must not become the production freshness rule: Phase 4 has to
# measure freshness in trading sessions of each security's own exchange. Tracked in
# docs/superpowers/specs/universe-candidate-audit.md.
STALE_DAYS = 5

# Region targets from the plan (targets, not quotas).
REGION_TARGETS = {
    "north_america": 180,
    "europe": 180,
    "asia_pacific": 150,
    "other_emerging": 60,
    "global_etf": 30,
}

# Corporate-form and filler words that carry no identity ("Toyota Motor Corp" is "Toyota Motor").
_NAME_NOISE = frozenset(
    "ab ag asa bv co company corp corporation group holding holdings inc incorporated limited "  # noqa: SIM905
    "ltd nv oyj plc sa se spa the".split()
)

# Yahoo throttles bulk fetching. yfinance raises a class with this name; matching on the name
# keeps this module free of an import that can change between yfinance versions.
RATE_LIMIT_ERROR = "YFRateLimitError"

# yfinance quoteType -> the universe file's asset_type
_QUOTE_TYPES = {"EQUITY": "STOCK", "ETF": "ETF"}


@dataclass(frozen=True)
class FieldCoverage:
    present: int
    total: int
    missing: tuple[str, ...]


@dataclass(frozen=True)
class RawSymbolData:
    info: dict[str, Any]
    history_days: int
    last_close_date: date | None


@dataclass(frozen=True)
class SymbolResult:
    row: UniverseRow
    failure: str | None  # unresolved | rate_limited | history_too_short | stale_price | ...
    detail: str | None  # exception class name for an unresolved symbol, never the message
    mismatches: tuple[str, ...]  # name | country | currency | sector | asset_type
    actual_name: str | None
    coverage: FieldCoverage
    market_cap_eur: float | None
    size_bucket: str

    @property
    def ok(self) -> bool:
        return self.failure is None


Fetch = Callable[[str], RawSymbolData]
PriceFn = Callable[[str], float | None]


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def core_coverage(info: dict[str, Any]) -> FieldCoverage:
    missing = tuple(field for field in CORE_FIELDS if not _is_number(info.get(field)))
    return FieldCoverage(
        present=len(CORE_FIELDS) - len(missing), total=len(CORE_FIELDS), missing=missing
    )


def _name_tokens(name: str) -> frozenset[str]:
    # NFKD splits "é" into "e" plus an accent mark, which the ASCII filter then drops.
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    words = re.findall(r"[a-z0-9]+", ascii_name.lower())
    return frozenset(word for word in words if word not in _NAME_NOISE)


def names_match(expected: str, actual: str) -> bool:
    """True when two company names plausibly refer to the same company.

    A validation aid, not an identity authority: the file is reviewed by a person, this only
    flags rows worth a second look.
    """
    left, right = _name_tokens(expected), _name_tokens(actual)
    if not left or not right:
        return False
    return left <= right or right <= left


def find_duplicate_listings(listings: list[tuple[str, str]]) -> list[tuple[str, ...]]:
    """Groups of tickers whose company names are identical after normalisation."""
    by_name: dict[frozenset[str], list[str]] = defaultdict(list)
    for ticker, name in listings:
        tokens = _name_tokens(name)
        if tokens:
            by_name[tokens].append(ticker)
    return sorted(tuple(sorted(tickers)) for tickers in by_name.values() if len(tickers) > 1)


def eur_rate_from(currency: str, price_of: PriceFn) -> Decimal | None:
    """EUR per 1 unit of `currency`; the price lookup is injected so the script needs no Redis."""
    symbol = rate_symbol(currency)
    return rate_from_price(currency, price_of(symbol) if symbol else None)


def build_rates(
    currencies: list[str], price_of: PriceFn
) -> tuple[dict[str, Decimal], dict[str, str]]:
    """EUR rates per currency, and why a currency has none.

    One failing lookup must not abort the run: the symbol results are already fetched and the
    report is the deliverable. A currency without a rate leaves its market caps unconverted.
    """
    rates: dict[str, Decimal] = {}
    failures: dict[str, str] = {}
    for currency in sorted(currencies):
        try:
            rate = eur_rate_from(currency, price_of)
        except Exception as exc:  # the price lookup is a network call; keep the class only
            failures[currency] = type(exc).__name__
            continue
        if rate is None:
            failures[currency] = "no rate available"
        else:
            rates[currency] = rate
    return rates, failures


def _failed(row: UniverseRow, failure: str, detail: str | None = None) -> SymbolResult:
    return SymbolResult(
        row=row,
        failure=failure,
        detail=detail,
        mismatches=(),
        actual_name=None,
        coverage=core_coverage({}),
        market_cap_eur=None,
        size_bucket="unknown",
    )


def _region_differs(file_country: str, live_country: Any) -> bool:
    """True only when both countries map to a known region and the regions differ.

    The file stores the listing country; Yahoo reports the domicile, which can be an offshore
    jurisdiction (Jersey, Bermuda) that is not a region we classify. Those are not mismatches.
    """
    if not isinstance(live_country, str) or not live_country:
        return False
    file_region = region_of(file_country, "STOCK")
    live_region = region_of(live_country, "STOCK")
    return "unknown" not in (file_region, live_region) and file_region != live_region


def check_symbol(
    row: UniverseRow, fetched: RawSymbolData | Exception, rates: dict[str, Decimal], today: date
) -> SymbolResult:
    if isinstance(fetched, Exception):  # the network layer can raise anything; keep the class only
        reason = "rate_limited" if type(fetched).__name__ == RATE_LIMIT_ERROR else "unresolved"
        return _failed(row, reason, detail=type(fetched).__name__)

    raw = fetched
    info = raw.info
    name = info.get("longName") or info.get("shortName")
    quote_type = info.get("quoteType")
    if not name or not quote_type:
        return _failed(row, "unresolved")

    currency = str(info.get("currency") or "")
    coverage = core_coverage(info)
    market_cap_eur = market_cap_to_eur(info.get("marketCap"), currency, rates)

    mismatches: list[str] = []
    if not names_match(row.name, str(name)):
        mismatches.append("name")
    if _QUOTE_TYPES.get(str(quote_type)) != row.asset_type:
        mismatches.append("asset_type")
    if row.asset_type == "STOCK" and _region_differs(row.country, info.get("country")):
        mismatches.append("country")
    if currency and currency != row.currency:
        mismatches.append("currency")
    if row.asset_type == "STOCK" and info.get("sector") and info["sector"] != row.sector:
        mismatches.append("sector")

    failure: str | None = None
    if raw.history_days < MIN_HISTORY_DAYS:
        failure = "history_too_short"
    elif raw.last_close_date is None or (today - raw.last_close_date).days > STALE_DAYS:
        failure = "stale_price"
    elif currency not in SUPPORTED:
        failure = "currency_unsupported"
    elif row.asset_type == "STOCK" and coverage.present < MIN_CORE_METRICS:
        failure = "insufficient_data"

    return SymbolResult(
        row=row,
        failure=failure,
        detail=None,
        mismatches=tuple(mismatches),
        actual_name=str(name),
        coverage=coverage,
        market_cap_eur=market_cap_eur,
        size_bucket=size_bucket_for(market_cap_eur),
    )


def meets_thresholds(results: list[SymbolResult], min_ok_ratio: float) -> bool:
    # Throttled symbols were never checked, so they are neither a pass nor a failure.
    checked = [r for r in results if r.failure != "rate_limited"]
    if not checked:
        return False
    return sum(1 for r in checked if r.ok) / len(checked) >= min_ok_ratio


def _counts_table(title: str, counter: Counter[str]) -> str:
    lines = [f"### {title}", "", "| Value | Count |", "|---|---:|"]
    for key in sorted(counter, key=lambda k: (-counter[k], k)):
        lines.append(f"| {key} | {counter[key]} |")
    return "\n".join(lines) + "\n"


def _region_table(results: list[SymbolResult]) -> str:
    """Checked, passing and not-checked per region, so a region with many failures stays visible."""

    def regions(keep: Callable[[SymbolResult], bool]) -> Counter[str]:
        return Counter(region_of(r.row.country, r.row.asset_type) for r in results if keep(r))

    checked = regions(lambda r: r.failure != "rate_limited")
    passing = regions(lambda r: r.ok)
    not_checked = regions(lambda r: r.failure == "rate_limited")
    lines = ["### By region", ""]
    lines += ["| Region | Target | Checked | Passing | Not checked |", "|---|---:|---:|---:|---:|"]
    for region in sorted({*REGION_TARGETS, *checked, *not_checked}):
        target = REGION_TARGETS.get(region, "")
        lines.append(
            f"| {region} | {target} | {checked[region]} | {passing[region]} "
            f"| {not_checked[region]} |"
        )
    return "\n".join(lines) + "\n"


def build_report(
    results: list[SymbolResult],
    duplicates: list[tuple[str, ...]],
    rate_failures: dict[str, str] | None = None,
) -> str:
    ok = [r for r in results if r.ok]
    sectors = Counter(r.row.sector or "ETF / n.a." for r in ok)
    sizes = Counter(r.size_bucket for r in ok)
    countries = Counter(r.row.country for r in ok)
    unchecked = [r for r in results if r.failure == "rate_limited"]
    failures = Counter(r.failure or "" for r in results if not r.ok and r not in unchecked)

    out = [
        "# Universe coverage report",
        "",
        f"Symbols: {len(results)}. Passing: {len(ok)}. "
        f"Failing: {len(results) - len(ok) - len(unchecked)}. Not checked: {len(unchecked)}.",
        "",
        "Counts below are for passing symbols. Targets are targets, not quotas.",
        "",
        f"Freshness: a last close more than {STALE_DAYS} calendar days old fails. This is an "
        "interim calendar-day proxy, not an exchange-session-aware check.",
        "",
        _region_table(results),
        _counts_table("By sector", sectors),
        _counts_table("By size bucket (EUR market cap, label only)", sizes),
        _counts_table("By country", countries),
    ]
    if failures:
        out.append(_counts_table("Failures by reason", failures))

    stocks = [r for r in results if r.row.asset_type == "STOCK" and r.actual_name]
    out += ["### Fundamentals coverage by region (stocks, % with a finite value)", ""]
    regions_present = sorted({region_of(r.row.country, "STOCK") for r in stocks})
    out += ["| Field | " + " | ".join(regions_present) + " |"]
    out += ["|---|" + "---:|" * len(regions_present)]
    for field in CORE_FIELDS:
        cells = []
        for region in regions_present:
            group = [r for r in stocks if region_of(r.row.country, "STOCK") == region]
            have = sum(1 for r in group if field not in r.coverage.missing)
            cells.append(f"{100 * have / len(group):.0f}%" if group else "n/a")
        out.append(f"| {field} | " + " | ".join(cells) + " |")
    out.append("")

    if rate_failures:
        out += ["### Market cap conversion unavailable", ""]
        out += ["Market caps in these currencies are unconverted and labelled unknown.", ""]
        out += ["| Currency | Reason |", "|---|---|"]
        out += [f"| {currency} | {reason} |" for currency, reason in sorted(rate_failures.items())]
        out.append("")

    if unchecked:
        out += [
            "### Not checked (Yahoo rate limited the run)",
            "",
            "These symbols are neither passing nor failing. Re-run the script to check them.",
            "",
        ]
        out += [f"- {r.row.ticker}" for r in unchecked]
        out.append("")

    failing = [r for r in results if not r.ok and r not in unchecked]
    if failing:
        out += ["### Failing symbols", ""]
        out += ["| Ticker | Name | Reason | Detail |", "|---|---|---|---|"]
        for r in failing:
            out.append(f"| {r.row.ticker} | {r.row.name} | {r.failure} | {r.detail or ''} |")
        out.append("")

    drift = [r for r in results if r.ok and r.mismatches]
    if drift:
        out += ["### Rows that differ from the live data", ""]
        out += ["| Ticker | Differs in |", "|---|---|"]
        for r in drift:
            out.append(f"| {r.row.ticker} | {', '.join(r.mismatches)} |")
        out.append("")

    if duplicates:
        out += ["### Possible duplicate listings", ""]
        out += [f"- {', '.join(group)}" for group in duplicates]
        out.append("")
    return "\n".join(out)


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
        except Exception as exc:  # kept as a value; check_symbol classifies it later
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
            handle = yf.Ticker(ticker)
            info = dict(handle.info or {})
            closes = handle.history(period="1y")["Close"].dropna()
            last = closes.index[-1].date() if len(closes) else None
            return RawSymbolData(info=info, history_days=len(closes), last_close_date=last)
        except Exception as exc:  # recorded by the caller as "unresolved" with the class name
            if type(exc).__name__ == RATE_LIMIT_ERROR:
                raise  # fail fast: fetch_all retries throttled symbols after a cooldown
            last_error = exc
            time.sleep(1.0 * (attempt + 1))
    raise last_error


def _latest_close(symbol: str) -> float | None:
    closes = yf.Ticker(symbol).history(period="5d")["Close"].dropna()
    return float(closes.iloc[-1]) if len(closes) else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate the discovery universe file.")
    parser.add_argument("--universe", type=Path, default=UNIVERSE_PATH)
    parser.add_argument("--report", type=Path, default=None, help="write the markdown report here")
    parser.add_argument("--min-ok-ratio", type=float, default=0.9)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int, default=None, help="check only the first N rows")
    args = parser.parse_args(argv)

    rows = load_universe(args.universe)[: args.limit]
    fetched = fetch_all([r.ticker for r in rows], fetch_yfinance, workers=args.workers)

    currencies = {
        str(raw.info.get("currency"))
        for raw in fetched.values()
        if isinstance(raw, RawSymbolData) and raw.info.get("currency")
    }
    rates, rate_failures = build_rates(sorted(currencies), _latest_close)

    today = date.today()
    results = [check_symbol(row, fetched[row.ticker], rates, today) for row in rows]
    duplicates = find_duplicate_listings(
        [(r.row.ticker, r.actual_name) for r in results if r.ok and r.actual_name]
    )
    report = build_report(results, duplicates, rate_failures)
    if args.report:
        args.report.write_text(report, encoding="utf-8")
    else:
        sys.stdout.write(report + "\n")

    ok_count = sum(1 for r in results if r.ok)
    unchecked = sum(1 for r in results if r.failure == "rate_limited")
    sys.stdout.write(
        f"{ok_count}/{len(results)} symbols passed, {unchecked} not checked "
        f"(need {args.min_ok_ratio:.0%} of those checked).\n"
    )
    if not meets_thresholds(results, args.min_ok_ratio):
        return 1
    return 2 if unchecked or rate_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
