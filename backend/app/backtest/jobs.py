import asyncio
import logging
import uuid
from datetime import date
from typing import Any

from app.agents.market_data import fetch_price_history
from app.backtest.engine import simulate
from app.config import settings
from app.db import SessionLocal
from app.models import BacktestResult
from app.redis_client import get_redis

logger = logging.getLogger(__name__)

JOB_TTL_SECONDS = 3600


async def create_job(ticker: str, start: date, end: date) -> str:
    job_id = str(uuid.uuid4())
    redis = get_redis()
    await redis.hset(f"backtest_job:{job_id}", mapping={"status": "RUNNING"})
    await redis.expire(f"backtest_job:{job_id}", JOB_TTL_SECONDS)
    return job_id


async def get_job_status(job_id: str) -> dict[str, Any] | None:
    redis = get_redis()
    data = await redis.hgetall(f"backtest_job:{job_id}")
    if not data:
        return None
    result_id = data.get("backtest_result_id")
    return {
        "status": data["status"],
        "backtest_result_id": int(result_id) if result_id is not None else None,
    }


async def run_job(job_id: str, ticker: str, start: date, end: date) -> None:
    redis = get_redis()
    try:
        closes = await fetch_price_history(ticker, start, end)
        metrics = await asyncio.to_thread(simulate, closes)

        db = SessionLocal()
        try:
            result = BacktestResult(
                user_id=settings.default_user_id,
                ticker=ticker,
                start_date=start,
                end_date=end,
                final_value=metrics.final_value,
                buy_and_hold_value=metrics.buy_and_hold_value,
                excess_return_pct=metrics.excess_return_pct,
                hit_rate_by_signal=metrics.hit_rate_by_signal,
                status="DONE",
            )
            db.add(result)
            db.commit()
            db.refresh(result)
        finally:
            db.close()

        await redis.hset(
            f"backtest_job:{job_id}",
            mapping={"status": "DONE", "backtest_result_id": result.id},
        )
    except Exception:
        logger.exception("Backtest failed for ticker %s", ticker)
        await redis.hset(f"backtest_job:{job_id}", "status", "FAILED")
