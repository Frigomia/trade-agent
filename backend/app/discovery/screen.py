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

from app.discovery.eligibility import is_eligible
from app.discovery.peers import PeerRecord, compare_to_peers
from app.discovery.risk import build_risk_profile
from app.discovery.scoring import dimension_score
from app.discovery.snapshot import Freshness, SymbolSnapshot, coverage_of
from app.schemas_discovery import CandidateMetrics, Exclusion

SHORTLIST_SIZE = 8  # proposed default
RISK_ORDER = {"low": 0, "medium": 1, "high": 2, "unknown": 3}


@dataclass(frozen=True)
class Shortlist:
    candidates: list[CandidateMetrics]  # best first
    excluded: list[Exclusion]  # failed a safeguard, with the reason


def shortlist_for_user(
    snapshots: Sequence[SymbolSnapshot],
    freshness: Freshness,
    rates: Mapping[str, Decimal],
    holdings: Collection[str] = (),
    avoid_sectors: Collection[str] = (),
    size: int = SHORTLIST_SIZE,
) -> Shortlist:
    """Held tickers and avoided sectors are the user's choice and are simply left out.

    A candidate with no valid peer comparison has no score: it is listed as excluded for
    insufficient data, never scored as 0.
    `uncertain` freshness stays eligible: the price is shown, not distrusted.
    """
    held = {t.casefold() for t in holdings}
    avoided = {s.casefold() for s in avoid_sectors}
    records = [
        PeerRecord(s.ticker, s.asset_type, s.sector, s.industry, s.metrics) for s in snapshots
    ]
    excluded: list[Exclusion] = []
    ranked: list[tuple[float, int, str, CandidateMetrics]] = []
    for snap, record in zip(snapshots, records, strict=True):
        if snap.ticker.casefold() in held or (snap.sector or "").casefold() in avoided:
            continue
        ok, why = is_eligible(snap, freshness.stale.get(snap.ticker))
        if why is not None:
            excluded.append(why)
        if not ok:
            continue
        # ponytail: recomputed per call (about 1 s for 600 symbols); cache per snapshot if needed
        peers = compare_to_peers(record, records)
        scores = [dimension_score(peers, record.group, d) for d in ("quality", "valuation")]
        have = [s for s in scores if s is not None]
        if not have:  # eligible, but nothing to rank it on: say so rather than lose it
            excluded.append(
                Exclusion(
                    ticker=snap.ticker,
                    name=snap.name,
                    reason="insufficient_data",
                    explanation="no valid peer comparison, so it cannot be scored or ranked",
                    evidence=[],
                )
            )
            continue
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
            country=None,  # not in the snapshot; the universe row has it
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
            risk=risk,
            origin="universe",
            origin_note=None,
        )
        ranked.append((-mean(have), RISK_ORDER[risk.risk_level], snap.ticker, candidate))
    ranked.sort(key=lambda row: row[:3])
    return Shortlist([row[3] for row in ranked[: max(size, 0)]], excluded)
