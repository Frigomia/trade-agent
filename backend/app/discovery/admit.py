"""Let a company found by research enter the pipeline, safely (plan Phase 5, D2 and D6).

A mention is a name an LLM pulled out of a web page: untrusted text. It is never used as a ticker.
Its name is only a search query, the symbol comes from the search results, and the company then
passes the same safeguards as a universe symbol. Ambiguous names are rejected rather than guessed.
Two bounds keep a page full of names from costing anything: at most `limit` are admitted, and at
most `MAX_EXAMINED` are even looked up. The origin carries no scoring weight; it is only recorded.
"""

import asyncio
import logging
import re
import unicodedata
from collections.abc import Awaitable, Callable, Collection, Mapping, Sequence
from datetime import date
from decimal import Decimal
from difflib import SequenceMatcher

from app.agents.market_data import search_symbols
from app.discovery.eligibility import is_eligible
from app.discovery.fetching import Fetch, fetch_yfinance
from app.discovery.peers import PeerRecord
from app.discovery.screen import build_candidate
from app.discovery.snapshot import SymbolSnapshot, check_freshness, to_snapshot
from app.schemas_discovery import CandidateMetrics, Mention, RejectedMention

logger = logging.getLogger(__name__)

MAX_DYNAMIC = 10  # approved: dynamic entrants admitted per scan
MAX_EXAMINED = 30  # mentions looked up at all, valid or not
MIN_NAME_MATCH = 0.9  # similarity of two company names, after dropping legal suffixes
NOTE_CHARS = 300
MIN_HINT_CHARS = 3  # a shorter exchange hint would match almost any listing
QUERY_CHARS = 100

Resolve = Callable[[str], Awaitable[list[dict[str, str]]]]

_LEGAL = {"inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited"}
_LEGAL |= {"plc", "ag", "sa", "nv", "se", "spa", "ab", "oyj", "llc", "lp"}
_REASON_FOR = {  # eligibility exclusion -> why the mention is rejected
    "unreliable_price": "no_price",
    "ambiguous_identity": "unresolved",
    "currency_unsupported": "currency_unsupported",
    "insufficient_data": "insufficient_data",
}


def _normal(name: str) -> str:
    text = name.casefold().replace(".", "").replace("&", " and ")
    words = re.sub(r"[^a-z0-9]+", " ", text).split()
    while words and words[-1] in _LEGAL:
        words.pop()
    return " ".join(words)


def _key(ticker: str) -> str:
    """A ticker as one comparable string: BRK.B and BRK-B are the same share class."""
    return ticker.casefold().replace(".", "-")


def _clean(text: str) -> str:
    """One plain line: whitespace collapsed, control and invisible characters dropped, capped."""
    line = " ".join(text.split())
    return "".join(c for c in line if unicodedata.category(c)[0] != "C")[:NOTE_CHARS]


def _same_company(a: str, b: str) -> bool:
    a, b = _normal(a), _normal(b)
    return bool(a and b) and SequenceMatcher(None, a, b).ratio() >= MIN_NAME_MATCH


def _on_exchange(listed: str, hint: str) -> bool:
    listed, hint = listed.casefold(), hint.strip().casefold()
    return bool(listed) and len(hint) >= MIN_HINT_CHARS and (hint in listed or listed in hint)


def _pick(mention: Mention, hits: list[dict[str, str]]) -> dict[str, str] | str:
    """The one search result this mention means, or "unresolved" / "ambiguous"."""
    unique = {hit["symbol"].casefold(): hit for hit in hits}.values()
    matches = [h for h in unique if _same_company(mention.name[:QUERY_CHARS], h["name"])]
    if mention.exchange_hint:
        matches = [h for h in matches if _on_exchange(h["exchange"], mention.exchange_hint)]
    if mention.ticker_hint:
        matches = [h for h in matches if h["symbol"].casefold() == mention.ticker_hint.casefold()]
    return matches[0] if len(matches) == 1 else ("unresolved" if not matches else "ambiguous")


def _record(snap: SymbolSnapshot) -> PeerRecord:
    return PeerRecord(snap.ticker, snap.asset_type, snap.sector, snap.industry, snap.metrics)


async def admit_mentions(
    mentions: Sequence[Mention],
    known: Collection[str],
    universe: Sequence[SymbolSnapshot],
    rates: Mapping[str, Decimal],
    today: date,
    limit: int = MAX_DYNAMIC,
    *,
    resolve: Resolve = search_symbols,
    fetch: Fetch = fetch_yfinance,
) -> tuple[list[CandidateMetrics], list[RejectedMention]]:
    """`known` are tickers to treat as duplicates (holdings); universe symbols always are.

    The entrant is compared with the `universe` snapshot and does not join it.
    """
    taken = {_key(t) for t in known} | {_key(s.ticker) for s in universe}
    records = [_record(s) for s in universe]
    admitted: list[CandidateMetrics] = []
    rejected: list[RejectedMention] = []
    for examined, mention in enumerate(mentions):
        if len(admitted) >= limit or examined >= MAX_EXAMINED:
            rejected.append(RejectedMention(mention=mention, reason="cap_reached"))
            continue
        outcome = await _admit_one(mention, taken, universe, records, rates, today, resolve, fetch)
        if isinstance(outcome, CandidateMetrics):
            taken.add(_key(outcome.ticker))
            admitted.append(outcome)
        else:
            rejected.append(RejectedMention(mention=mention, reason=outcome))  # type: ignore[arg-type]
    return admitted, rejected


async def _admit_one(
    mention: Mention,
    taken: set[str],
    universe: Sequence[SymbolSnapshot],
    records: Sequence[PeerRecord],
    rates: Mapping[str, Decimal],
    today: date,
    resolve: Resolve,
    fetch: Fetch,
) -> CandidateMetrics | str:
    try:
        hits = await resolve(mention.name[:QUERY_CHARS]) if mention.name.strip() else []
    except Exception as exc:  # a failed lookup must not stop the others; class name only
        logger.warning("Admission: search failed (%s)", type(exc).__name__)
        return "unresolved"
    pick = _pick(mention, hits)
    if isinstance(pick, str):
        return pick
    symbol = pick["symbol"]
    if _key(symbol) in taken:
        return "duplicate"
    try:
        raw = await asyncio.to_thread(fetch, symbol)
    except Exception as exc:
        logger.warning("Admission: fetch failed (%s)", type(exc).__name__)
        return "no_price"
    if raw.info.get("quoteType") not in ("EQUITY", "ETF"):
        return "unresolved"
    try:
        snap = to_snapshot(symbol, raw)
        if not _same_company(
            pick["name"], snap.name
        ):  # the data must be the company that was found
            return "unresolved"
        freshness = check_freshness([*universe, snap], today)
        _, why = is_eligible(snap, freshness.stale.get(symbol))
        if why is not None:
            return _REASON_FOR.get(why.reason, "insufficient_data")
        candidate, scores = build_candidate(
            snap,
            _record(snap),
            records,
            rates,
            freshness.uncertain.get(symbol),
            mention.origin,
            _clean(mention.reason) or None,
        )
    except Exception as exc:  # one bad entrant must not lose the others; class name only
        logger.warning("Admission: could not build a candidate (%s)", type(exc).__name__)
        return "insufficient_data"
    if all(score is None for score in scores):  # as in the shortlist: nothing to rank it on
        return "insufficient_data"
    return candidate
