"""Assemble a bounded manual scan; provider work finishes before the atomic database write."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from anthropic import Anthropic
from pydantic import TypeAdapter

from app import fx
from app.agents.discovery_graph import run_discovery_graph
from app.agents.market_data import fetch_dated_closes
from app.analysis.discovery_score import rank_ideas
from app.analysis.portfolio import PositionInput, clean_history, log_returns, marginal_effect
from app.db import scoped_session
from app.discovery.admit import admit_mentions
from app.discovery.refresh import load_snapshot
from app.discovery.screen import SHORTLIST_SIZE, shortlist_for_user
from app.discovery.snapshot import check_freshness
from app.discovery.universe import load_universe
from app.models import Holding, InvestmentPreferences
from app.portfolio_analytics import load_fit_context
from app.redis_client import get_redis
from app.schemas_discovery import Exclusion, IdeaOut, Mention, RejectedMention

logger = logging.getLogger(__name__)
MAX_CONCURRENT_CANDIDATES = 3
SCAN_TIMEOUT_SECONDS = 900
_MENTIONS: TypeAdapter[list[Mention] | None] = TypeAdapter(list[Mention] | None)
Progress = Callable[[str, int, int], Awaitable[None]]


class SnapshotUnavailable(Exception):
    """A scan cannot start without a readable cached universe snapshot."""


class CandidateEvaluationUnavailable(Exception):
    """Every shortlisted evaluation failed; this is not a completed no-opportunity scan."""


@dataclass(frozen=True)
class ScanEvaluation:
    ideas: list[IdeaOut]
    excluded: list[Exclusion]
    rejected_mentions: list[RejectedMention]
    universe_size: int
    eligible: int
    shortlisted: int
    researched: int
    coverage_summary: dict[str, object]


def _user_inputs(user_id: UUID) -> tuple[list[PositionInput], list[str]]:
    with scoped_session(user_id) as db:
        holdings = [
            PositionInput(row.ticker, row.name, float(row.shares), row.asset_type, row.sector)
            for row in db.query(Holding).filter(Holding.user_id == user_id, Holding.shares > 0)
        ]
        preferences = db.query(InvestmentPreferences).filter_by(user_id=user_id).one_or_none()
        return holdings, list(preferences.sector_avoid_list) if preferences else []


async def _cached_mentions() -> list[Mention] | None:
    # Manual scans consume the daily batch; only the owner scheduler may fund a new global batch.
    day = datetime.now(UTC).date().isoformat()
    raw = await get_redis().get(f"discovery:mentions:v2:{day}")
    if raw is None:
        return None
    try:
        return _MENTIONS.validate_json(raw)
    except ValueError:
        logger.warning("Discovery: cached mentions unreadable")
        return None


async def _rates() -> dict[str, Decimal]:
    semaphore = asyncio.Semaphore(fx.LOOKUP_CONCURRENCY)

    async def one(currency: str) -> tuple[str, Decimal | None]:
        async with semaphore:
            return currency, await fx.eur_rate(currency)

    return {
        currency: rate
        for currency, rate in await asyncio.gather(*(one(c) for c in sorted(fx.SUPPORTED)))
        if rate is not None
    }


async def evaluate_scan(user_id: UUID, client: Anthropic, progress: Progress) -> ScanEvaluation:
    """No scheduling, global paid theme searches or database writes; at most eight graph calls."""
    await progress("screening", 0, 0)
    universe = await asyncio.to_thread(load_universe)
    snapshots = await load_snapshot([row.ticker for row in universe])
    if not snapshots:
        raise SnapshotUnavailable
    holdings, avoided = await asyncio.to_thread(_user_inputs, user_id)
    rates = await _rates()
    today = datetime.now(UTC).date()
    freshness = await asyncio.to_thread(check_freshness, snapshots, today)
    await progress("admitting", 0, 0)
    mentions = await _cached_mentions()
    admitted, rejected = await admit_mentions(
        mentions or [], [h.ticker for h in holdings], snapshots, rates, today
    )
    # Rank once, retaining the eligible count before applying the shared shortlist limit.
    shortlist = await asyncio.to_thread(
        shortlist_for_user,
        snapshots,
        freshness,
        rates,
        [h.ticker for h in holdings],
        avoided,
        len(snapshots) + len(admitted),
        mentions_admitted=admitted,
    )
    candidates = shortlist.candidates[:SHORTLIST_SIZE]
    excluded = list(shortlist.excluded)
    ideas: list[IdeaOut] = []
    failures: list[str] = []
    done = 0
    if candidates:
        exposure, histories = await load_fit_context(holdings)
        portfolio_returns = {ticker: log_returns(history) for ticker, history in histories.items()}
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_CANDIDATES)

        async def evaluate(index: int) -> None:
            nonlocal done
            candidate = candidates[index]
            async with semaphore:
                try:
                    history: dict[str, float] = {}
                    if len(exposure.positions) >= 2:
                        try:
                            history = await fetch_dated_closes(candidate.ticker)
                        except Exception as exc:
                            logger.warning(
                                "Discovery fit history unavailable (%s)", type(exc).__name__
                            )
                    fit = marginal_effect(
                        exposure,
                        log_returns(clean_history(history, today)),
                        candidate.sector,
                        ticker=candidate.ticker,
                        portfolio_returns=portfolio_returns,
                    )
                    output = await run_discovery_graph(candidate, client, fit=fit)
                    if isinstance(output, Exclusion):
                        excluded.append(output)
                    else:
                        ideas.append(output)
                except Exception as exc:
                    logger.warning("Discovery candidate failed (%s)", type(exc).__name__)
                    failures.append(candidate.ticker)
                done += 1
                await progress("researching", len(candidates), done)

        await progress("researching", len(candidates), 0)
        await asyncio.gather(*(evaluate(i) for i in range(len(candidates))))
        if len(failures) == len(candidates):
            raise CandidateEvaluationUnavailable
    await progress("evaluating", len(candidates), done)
    loaded = {snapshot.ticker for snapshot in snapshots}
    return ScanEvaluation(
        ideas=rank_ideas(ideas),
        excluded=sorted(excluded, key=lambda item: item.ticker),
        rejected_mentions=rejected,
        universe_size=len(universe),
        eligible=len(shortlist.candidates),
        shortlisted=len(candidates),
        researched=done - len(failures),
        coverage_summary={
            "snapshot_symbols": len(snapshots),
            "missing_snapshot_symbols": [
                row.ticker for row in universe if row.ticker not in loaded
            ],
            "stale_symbols": sorted(freshness.stale),
            "uncertain_price_symbols": sorted(freshness.uncertain),
            "mentions_available": mentions is not None,
            "candidate_failures": sorted(failures),
        },
    )
