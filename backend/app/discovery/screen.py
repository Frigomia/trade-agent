"""The per-user shortlist from the weekly snapshot (plan Phase 4).

Fundamentals only: candidates are ranked by the mean of their quality and valuation scores against
peers. Price history feeds the risk profile and nothing else, and `risk_level` only breaks ties
(plan 4.4); it never excludes. Every snapshot symbol is a peer, whether or not it is eligible.
"""

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from statistics import mean
from typing import Literal

from app.discovery.eligibility import is_eligible
from app.discovery.peers import PeerRecord, compare_to_peers, metric_group, named_peers
from app.discovery.risk import build_risk_profile
from app.discovery.scoring import dimension_score
from app.discovery.snapshot import Freshness, SymbolSnapshot, coverage_of
from app.schemas_discovery import CandidateMetrics, Exclusion, Origin

SHORTLIST_SIZE = 8  # proposed default
RISK_ORDER = {"low": 0, "medium": 1, "high": 2, "unknown": 3}
PRICE_DATE_UNCERTAIN_PREFIX = "price date uncertain:"
PEER_DATA_NOTE = (
    "Peer fundamentals may use different fiscal periods and accounting standards; "
    "no adjustments are made."
)


def peer_record(snap: SymbolSnapshot) -> PeerRecord:
    return PeerRecord(
        snap.ticker,
        snap.asset_type,
        snap.sector,
        snap.industry,
        snap.metrics,
        snap.name,
        snap.country,
        snap.currency,
        snap.market_cap,
    )


@dataclass(frozen=True)
class Shortlist:
    candidates: list[CandidateMetrics]  # best first
    excluded: list[Exclusion]  # failed a safeguard, with the reason


def build_candidate(
    snap: SymbolSnapshot,
    record: PeerRecord,
    records: Sequence[PeerRecord],
    rates: Mapping[str, Decimal],
    uncertain: str | None = None,
    origin: Origin = "universe",
    origin_note: str | None = None,
) -> tuple[CandidateMetrics, list[int | None]]:
    """The candidate for one eligible symbol, and its quality and valuation scores (None: unscored).

    Peers are `records`; the symbol itself is skipped by `compare_to_peers`, so an entrant that is
    not in `records` is compared against them without joining them.
    """
    # ponytail: recomputed per call (about 1 s for 600 symbols); cache per snapshot if needed
    peers = compare_to_peers(record, records)
    dimensions: tuple[Literal["quality", "valuation"], ...] = ("quality", "valuation")
    scores = [dimension_score(peers, record.group, d) for d in dimensions]
    notes = [PEER_DATA_NOTE]
    notes.extend(
        f"{name} not scored: no valid peer comparison"
        for name, score in zip(dimensions, scores, strict=True)
        if score is None
    )
    if uncertain:
        notes.insert(0, f"{PRICE_DATE_UNCERTAIN_PREFIX} {uncertain}")
    risk = build_risk_profile(
        group=record.group,
        market_cap=snap.market_cap,
        currency=snap.currency or "",
        rates=dict(rates),
        avg_volume=snap.avg_volume,
        price=snap.price,
        closes=snap.closes,
        metrics=snap.metrics,
    )
    candidate = CandidateMetrics(
        ticker=snap.ticker,
        name=snap.name,
        asset_type=snap.asset_type,  # type: ignore[arg-type]  # checked by is_eligible
        exchange=snap.exchange,
        country=snap.country,
        sector=snap.sector,
        industry=snap.industry,
        currency=snap.currency,
        price=snap.price,
        price_as_of=datetime.fromisoformat(snap.dates[-1]).replace(tzinfo=UTC)
        if snap.dates
        else None,
        fundamentals=snap.metrics,
        coverage=coverage_of(snap.metrics),
        peers=peers,
        named_peers=named_peers(record, records, peers, rates),
        risk=risk,
        origin=origin,
        origin_note=origin_note,
        data_notes=notes,
    )
    return candidate, scores


def shortlist_for_user(
    snapshots: Sequence[SymbolSnapshot],
    freshness: Freshness,
    rates: Mapping[str, Decimal],
    holdings: Collection[str] = (),
    avoid_sectors: Collection[str] = (),
    size: int = SHORTLIST_SIZE,
    *,
    mentions_admitted: Sequence[CandidateMetrics] = (),
) -> Shortlist:
    """Held tickers and avoided sectors are the user's choice and are simply left out.

    A candidate with no valid peer comparison has no score: it is listed as excluded for
    insufficient data, never scored as 0.
    `uncertain` freshness stays eligible: the price is shown, not distrusted.
    `mentions_admitted` have already passed admission against this snapshot. They compete for
    the same places, without joining the peer distribution or receiving an origin bonus.
    """
    held = {t.casefold() for t in holdings}
    avoided = {s.casefold() for s in avoid_sectors}
    records = [peer_record(s) for s in snapshots]
    excluded: list[Exclusion] = []
    candidates: list[CandidateMetrics] = []
    for snap, record in zip(snapshots, records, strict=True):
        if snap.ticker.casefold() in held or (snap.sector or "").casefold() in avoided:
            continue
        ok, why = is_eligible(snap, freshness.stale.get(snap.ticker))
        if why is not None:
            excluded.append(why)
        if not ok:
            continue
        candidate, _ = build_candidate(
            snap, record, records, rates, freshness.uncertain.get(snap.ticker)
        )
        candidates.append(candidate)
    universe = {snap.ticker.casefold() for snap in snapshots}
    candidates.extend(c for c in mentions_admitted if c.ticker.casefold() not in universe)
    ranked: list[tuple[float, int, str, CandidateMetrics]] = []
    seen: set[str] = set()
    for candidate in candidates:
        ticker = candidate.ticker.casefold()
        if ticker in seen or ticker in held or (candidate.sector or "").casefold() in avoided:
            continue
        seen.add(ticker)
        group = metric_group(candidate.sector, candidate.industry, candidate.asset_type)
        scores = [dimension_score(candidate.peers, group, d) for d in ("quality", "valuation")]
        have = [s for s in scores if s is not None]
        if not have:  # eligible, but nothing to rank it on: say so rather than lose it
            excluded.append(
                Exclusion(
                    ticker=candidate.ticker,
                    name=candidate.name,
                    reason="insufficient_data",
                    explanation="no valid peer comparison, so it cannot be scored or ranked",
                    evidence=[],
                )
            )
            continue
        ranked.append(
            (-mean(have), RISK_ORDER[candidate.risk.risk_level], candidate.ticker, candidate)
        )
    ranked.sort(key=lambda row: row[:3])
    return Shortlist([row[3] for row in ranked[: max(size, 0)]], excluded)
