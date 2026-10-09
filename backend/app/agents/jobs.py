import asyncio
import json
import logging
import uuid
from typing import Any

from anthropic import Anthropic
from sqlalchemy.orm import Session

from app.agents.graph import AnalysisState, run_graph_for_ticker
from app.db import lock_and_check_active, scoped_session
from app.models import Holding, Recommendation, WatchlistItem
from app.redis_client import get_redis

logger = logging.getLogger(__name__)

JOB_TTL_SECONDS = 3600
MAX_CONCURRENT_TICKERS = 3
# A manual run has no time limit, so the marker is refreshed after every ticker (see
# _process_ticker); this is how long a dead process can block the user.
ACTIVE_TTL_SECONDS = JOB_TTL_SECONDS
MAX_RUN_TICKERS = 50  # each ticker is its own graph run (a Claude web search plus an embedding)

# Deletes the marker only if it still holds this job's id (a newer job may own it by now).
# Lua runs atomically inside Redis, so the compare and the delete cannot be interleaved.
_RELEASE_IF_MINE = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""


class AnalysisAlreadyRunning(Exception):
    """The user already has a RUNNING analysis job."""


def _active_key(user_id: uuid.UUID) -> str:
    return f"analysis_active:{user_id}"


def default_ticker_infos(
    db: Session,
    user_id: uuid.UUID,
    *,
    open_only: bool = False,
    exclude: frozenset[str] | set[str] = frozenset(),
) -> list[dict[str, Any]]:
    """Every holding followed by the watchlist, capped at MAX_RUN_TICKERS. `open_only` leaves out
    holdings with no shares left (the scheduled run analyzes what the person still owns).
    `exclude` tickers are dropped before the cap, so they never use up a slot."""
    holdings = db.query(Holding).filter_by(user_id=user_id)
    if open_only:
        holdings = holdings.filter(Holding.shares > 0)
    infos = [
        {"ticker": h.ticker, "asset_type": h.asset_type, "is_held": True} for h in holdings
    ] + [
        {"ticker": w.ticker, "asset_type": w.asset_type, "is_held": False}
        for w in db.query(WatchlistItem).filter_by(user_id=user_id)
    ]
    return [i for i in infos if i["ticker"] not in exclude][:MAX_RUN_TICKERS]


async def create_job(user_id: uuid.UUID, tickers: list[dict[str, Any]]) -> str:
    job_id = str(uuid.uuid4())
    redis = get_redis()
    # SET ... NX is atomic: only one concurrent request can claim the slot.
    if not await redis.set(_active_key(user_id), job_id, ex=ACTIVE_TTL_SECONDS, nx=True):
        raise AnalysisAlreadyRunning
    try:
        await redis.hset(
            f"job:{job_id}",
            mapping={"status": "RUNNING", "total": len(tickers), "done": 0, "owner": str(user_id)},
        )
        await redis.expire(f"job:{job_id}", JOB_TTL_SECONDS)
        await redis.expire(f"job:{job_id}:results", JOB_TTL_SECONDS)
    except Exception:
        await redis.eval(_RELEASE_IF_MINE, 1, _active_key(user_id), job_id)
        raise
    return job_id


async def get_job_status(job_id: str, user_id: uuid.UUID) -> dict[str, Any] | None:
    redis = get_redis()
    data = await redis.hgetall(f"job:{job_id}")
    # Someone else's job looks exactly like an unknown one, so job ids cannot be probed.
    if not data or data.get("owner") != str(user_id):
        return None
    raw_results = await redis.lrange(f"job:{job_id}:results", 0, -1)
    return {
        "status": data["status"],
        "total": int(data["total"]),
        "done": int(data["done"]),
        "results": [json.loads(r) for r in raw_results],
    }


def _save_recommendation(
    user_id: uuid.UUID, ticker_info: dict[str, Any], state: AnalysisState, source: str
) -> dict[str, Any]:
    """Writes one recommendation; the session lives and dies inside one worker thread."""
    with scoped_session(user_id) as db:
        if not lock_and_check_active(db, user_id):
            # The account was removed or disabled while the analysis ran: write nothing.
            return {"ticker": ticker_info["ticker"], "skipped": True}
        # A new run replaces this ticker's earlier unreviewed recommendations, so
        # Today never piles up stale duplicates. Marked, not deleted: history stays.
        db.query(Recommendation).filter_by(
            user_id=user_id, ticker=ticker_info["ticker"], status="PENDING"
        ).update({"status": "SUPERSEDED"})
        rec = Recommendation(
            user_id=user_id,
            ticker=ticker_info["ticker"],
            asset_type=ticker_info["asset_type"],
            action=state["action"],
            reasoning=state["reasoning"],
            ai_analysis=state["ai_analysis"],
            suggested_position_pct=state["suggested_position_pct"],
            price_at_recommendation=state["quote"]["price"],
            fundamental_score=state["fundamental_score"],
            technical_signal=state["technical_signal"],
            source=source,
        )
        db.add(rec)
        db.commit()
        db.refresh(rec)
        return {"ticker": ticker_info["ticker"], "recommendation_id": rec.id}


async def _process_ticker(
    job_id: str,
    user_id: uuid.UUID,
    ticker_info: dict[str, Any],
    semaphore: asyncio.Semaphore,
    client: Anthropic | None = None,
    source: str = "manual",
) -> None:
    redis = get_redis()
    async with semaphore:
        try:
            state = await run_graph_for_ticker(
                user_id,
                ticker_info["ticker"],
                ticker_info["asset_type"],
                ticker_info["is_held"],
                client,
            )
            if state["action"] is None:
                entry: dict[str, Any] = {"ticker": ticker_info["ticker"], "skipped": True}
            else:
                # Sync DB work (it can wait on the user's advisory lock): off the event loop.
                entry = await asyncio.to_thread(
                    _save_recommendation, user_id, ticker_info, state, source
                )
        except Exception as exc:
            # Class name only, no traceback: a traceback carries the exception message, which can
            # include key material. Manual runs therefore log no traceback either.
            logger.error(
                "Analysis failed for ticker %s (%s)", ticker_info["ticker"], type(exc).__name__
            )
            entry = {"ticker": ticker_info["ticker"], "error": "analysis failed"}
        await redis.rpush(f"job:{job_id}:results", json.dumps(entry))
        await redis.expire(f"job:{job_id}:results", JOB_TTL_SECONDS)
        await redis.hincrby(f"job:{job_id}", "done", 1)
        # Keep the marker alive while the run goes on. EXPIRE on a missing key does nothing.
        await redis.expire(_active_key(user_id), ACTIVE_TTL_SECONDS)


async def run_job(
    job_id: str,
    user_id: uuid.UUID,
    tickers: list[dict[str, Any]],
    # client=None means "the server's own Claude key (admin only)". Any caller acting for a regular
    # user (for example a scheduled analysis command) must pass that user's client.
    client: Anthropic | None = None,
    source: str = "manual",
) -> None:
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_TICKERS)
    try:
        results = await asyncio.gather(
            *(_process_ticker(job_id, user_id, t, semaphore, client, source) for t in tickers),
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, Exception):
                # Class name only: a traceback carries the message, which can include key material.
                logger.error("Unhandled error in _process_ticker (%s)", type(result).__name__)
    finally:
        redis = get_redis()
        try:
            await redis.hset(f"job:{job_id}", "status", "DONE")
        finally:
            # Runs even if the hset raised, so the user is never locked out until the TTL.
            try:
                await redis.eval(_RELEASE_IF_MINE, 1, _active_key(user_id), job_id)
            except Exception as exc:
                # The marker expires on its own after ACTIVE_TTL_SECONDS.
                logger.warning("Analysis: marker release failed (%s)", type(exc).__name__)
