"""Prepare only the explicitly saved ticker; never rank or research the universe."""

import asyncio
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from app.discovery.eligibility import is_eligible
from app.discovery.fetching import fetch_yfinance
from app.discovery.refresh import SNAPSHOT_TTL_SECONDS, load_snapshot
from app.discovery.runner import _rates, _user_inputs
from app.discovery.screen import build_candidate, peer_record
from app.discovery.snapshot import check_freshness, to_snapshot
from app.discovery.universe import load_universe
from app.redis_client import get_redis
from app.schemas_discovery import CandidateMetrics


class CompanyDataUnavailable(Exception):
    """Provider data could not be read; retry is free and no research has started."""


@dataclass(frozen=True)
class PreparedCompany:
    candidate: CandidateMetrics | None
    fingerprint: str
    reason: str


async def prepare_company(user_id: UUID, ticker: str) -> PreparedCompany:
    universe = await asyncio.to_thread(load_universe)
    peers = await load_snapshot([row.ticker for row in universe])
    snapshots = await load_snapshot([ticker])
    today = datetime.now(UTC).date()
    snap = snapshots[0] if snapshots else None
    if snap is None or ticker in check_freshness([*peers, snap], today).stale:
        try:
            raw = await asyncio.to_thread(fetch_yfinance, ticker)
            if raw.info.get("quoteType") not in ("EQUITY", "ETF"):
                fingerprint = hashlib.sha256(
                    json.dumps(raw.info, sort_keys=True, default=str).encode()
                ).hexdigest()
                return PreparedCompany(
                    None, fingerprint, "This instrument is not a verified stock or ETF."
                )
            # Yahoo country is issuer domicile; never invent a verified listing country.
            snap = to_snapshot(ticker, raw)
        except Exception as exc:
            raise CompanyDataUnavailable from exc
        await get_redis().set(f"discovery:symbol:{ticker}", snap.to_json(), ex=SNAPSHOT_TTL_SECONDS)
    holdings, avoided = await asyncio.to_thread(_user_inputs, user_id)
    inputs = {
        "snapshot": snap.to_json(),
        "peers": [p.to_json() for p in peers],
        "held": sorted(h.ticker for h in holdings),
        "avoided": sorted(avoided),
    }
    fingerprint = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
    freshness = check_freshness([*peers, snap], today)
    _, exclusion = is_eligible(snap, freshness.stale.get(ticker))
    reason = exclusion.explanation if exclusion else ""
    if ticker.casefold() in {h.ticker.casefold() for h in holdings}:
        reason = "You already hold this company. Use portfolio analysis for held positions."
    if (snap.sector or "").casefold() in {s.casefold() for s in avoided}:
        reason = "This sector is excluded by your preferences."
    if reason:
        return PreparedCompany(None, fingerprint, reason)
    rates = await _rates()
    candidate, scores = await asyncio.to_thread(
        build_candidate,
        snap,
        peer_record(snap),
        [peer_record(p) for p in peers],
        rates,
        freshness.uncertain.get(ticker),
        origin="watchlist",
        origin_note="Explicit single-company research requested from Discover.",
    )
    if all(score is None for score in scores):
        return PreparedCompany(None, fingerprint, "No valid peer comparison is available.")
    return PreparedCompany(candidate, fingerprint, "")
