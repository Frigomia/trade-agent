import asyncio
import json
import logging
import uuid
from typing import Any

from anthropic import Anthropic

from app.agents.graph import run_graph_for_ticker
from app.db import scoped_session
from app.models import Recommendation
from app.redis_client import get_redis

logger = logging.getLogger(__name__)

JOB_TTL_SECONDS = 3600
MAX_CONCURRENT_TICKERS = 3


async def create_job(user_id: uuid.UUID, tickers: list[dict[str, Any]]) -> str:
    job_id = str(uuid.uuid4())
    redis = get_redis()
    await redis.hset(
        f"job:{job_id}",
        mapping={"status": "RUNNING", "total": len(tickers), "done": 0, "owner": str(user_id)},
    )
    await redis.expire(f"job:{job_id}", JOB_TTL_SECONDS)
    await redis.expire(f"job:{job_id}:results", JOB_TTL_SECONDS)
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


async def _process_ticker(
    job_id: str,
    user_id: uuid.UUID,
    ticker_info: dict[str, Any],
    semaphore: asyncio.Semaphore,
    client: Anthropic | None = None,
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
                with scoped_session(user_id) as db:
                    # A new run replaces this ticker's earlier unreviewed recommendations, so Today
                    # never piles up stale duplicates. Marked, not deleted: the history stays.
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
                    )
                    db.add(rec)
                    db.commit()
                    db.refresh(rec)
                    entry = {"ticker": ticker_info["ticker"], "recommendation_id": rec.id}
        except Exception:
            logger.exception("Analysis failed for ticker %s", ticker_info["ticker"])
            entry = {"ticker": ticker_info["ticker"], "error": "analysis failed"}
        await redis.rpush(f"job:{job_id}:results", json.dumps(entry))
        await redis.expire(f"job:{job_id}:results", JOB_TTL_SECONDS)
        await redis.hincrby(f"job:{job_id}", "done", 1)


async def run_job(
    job_id: str,
    user_id: uuid.UUID,
    tickers: list[dict[str, Any]],
    # client=None means "the server's own Claude key (admin only)". Any caller acting for a regular
    # user (for example a scheduled analysis command) must pass that user's client.
    client: Anthropic | None = None,
) -> None:
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_TICKERS)
    try:
        results = await asyncio.gather(
            *(_process_ticker(job_id, user_id, t, semaphore, client) for t in tickers),
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, Exception):
                logger.exception("Unhandled error in _process_ticker", exc_info=result)
    finally:
        redis = get_redis()
        await redis.hset(f"job:{job_id}", "status", "DONE")
