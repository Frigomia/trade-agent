import asyncio
import json
import logging
import uuid
from typing import Any

from app.agents.graph import run_graph_for_ticker
from app.config import settings
from app.db import SessionLocal
from app.models import Recommendation
from app.redis_client import get_redis

logger = logging.getLogger(__name__)

JOB_TTL_SECONDS = 3600
MAX_CONCURRENT_TICKERS = 3


async def create_job(tickers: list[dict[str, Any]]) -> str:
    job_id = str(uuid.uuid4())
    redis = get_redis()
    await redis.hset(
        f"job:{job_id}",
        mapping={"status": "RUNNING", "total": len(tickers), "done": 0},
    )
    await redis.expire(f"job:{job_id}", JOB_TTL_SECONDS)
    await redis.expire(f"job:{job_id}:results", JOB_TTL_SECONDS)
    return job_id


async def get_job_status(job_id: str) -> dict[str, Any] | None:
    redis = get_redis()
    data = await redis.hgetall(f"job:{job_id}")
    if not data:
        return None
    raw_results = await redis.lrange(f"job:{job_id}:results", 0, -1)
    return {
        "status": data["status"],
        "total": int(data["total"]),
        "done": int(data["done"]),
        "results": [json.loads(r) for r in raw_results],
    }


async def _process_ticker(
    job_id: str, ticker_info: dict[str, Any], semaphore: asyncio.Semaphore
) -> None:
    redis = get_redis()
    async with semaphore:
        try:
            state = await run_graph_for_ticker(
                ticker_info["ticker"], ticker_info["asset_type"], ticker_info["is_held"]
            )
            if state["action"] is None:
                entry: dict[str, Any] = {"ticker": ticker_info["ticker"], "skipped": True}
            else:
                db = SessionLocal()
                try:
                    rec = Recommendation(
                        user_id=settings.default_user_id,
                        ticker=ticker_info["ticker"],
                        asset_type=ticker_info["asset_type"],
                        action=state["action"],
                        reasoning=state["reasoning"],
                        ai_analysis=state["ai_analysis"],
                        suggested_position_pct=state["suggested_position_pct"],
                    )
                    db.add(rec)
                    db.commit()
                    db.refresh(rec)
                    entry = {"ticker": ticker_info["ticker"], "recommendation_id": rec.id}
                finally:
                    db.close()
        except Exception:
            logger.exception("Analysis failed for ticker %s", ticker_info["ticker"])
            entry = {"ticker": ticker_info["ticker"], "error": "analysis failed"}
        await redis.rpush(f"job:{job_id}:results", json.dumps(entry))
        await redis.hincrby(f"job:{job_id}", "done", 1)


async def run_job(job_id: str, tickers: list[dict[str, Any]]) -> None:
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_TICKERS)
    await asyncio.gather(*(_process_ticker(job_id, t, semaphore) for t in tickers))
    redis = get_redis()
    await redis.hset(f"job:{job_id}", "status", "DONE")
