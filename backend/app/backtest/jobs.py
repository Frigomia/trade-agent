import asyncio
import logging
import uuid
from datetime import date
from typing import Any

from app.agents.market_data import fetch_price_history
from app.backtest.engine import BacktestMetrics, simulate
from app.db import lock_and_check_active, scoped_session
from app.models import BacktestResult
from app.redis_client import _RELEASE_IF_MINE, get_redis

logger = logging.getLogger(__name__)

JOB_TTL_SECONDS = 3600


# Marks "this user has a backtest in flight". It expires on its own in case the process dies
# before the job finishes, so a crash cannot lock the user out for long. A job is cut off after
# JOB_MAX_SECONDS and the marker outlives that, so a live job never loses its marker to expiry.
JOB_MAX_SECONDS = 600
ACTIVE_TTL_SECONDS = JOB_MAX_SECONDS + 60


class BacktestAlreadyRunning(Exception):
    """The user already has a RUNNING backtest job."""


class AccountNotActive(Exception):
    """The user was removed or disabled while the backtest ran."""


def _active_key(user_id: uuid.UUID) -> str:
    return f"backtest_active:{user_id}"


async def create_job(user_id: uuid.UUID, ticker: str, start: date, end: date) -> str:
    job_id = str(uuid.uuid4())
    redis = get_redis()
    # SET ... NX is atomic: only one concurrent request can claim the slot.
    claimed = await redis.set(_active_key(user_id), job_id, ex=ACTIVE_TTL_SECONDS, nx=True)
    if not claimed:
        raise BacktestAlreadyRunning
    await redis.hset(f"backtest_job:{job_id}", mapping={"status": "RUNNING", "owner": str(user_id)})
    await redis.expire(f"backtest_job:{job_id}", JOB_TTL_SECONDS)
    return job_id


async def get_job_status(job_id: str, user_id: uuid.UUID) -> dict[str, Any] | None:
    redis = get_redis()
    data = await redis.hgetall(f"backtest_job:{job_id}")
    if not data or data.get("owner") != str(user_id):
        return None
    result_id = data.get("backtest_result_id")
    return {
        "status": data["status"],
        "backtest_result_id": int(result_id) if result_id is not None else None,
    }


def _save_result(
    user_id: uuid.UUID, ticker: str, start: date, end: date, metrics: BacktestMetrics
) -> int:
    with scoped_session(user_id) as db:
        if not lock_and_check_active(db, user_id):
            # run_job turns this into a FAILED job; no row is written for a removed account.
            raise AccountNotActive
        result = BacktestResult(
            user_id=user_id,
            ticker=ticker,
            start_date=start,
            end_date=end,
            final_value=metrics.final_value,
            buy_and_hold_value=metrics.buy_and_hold_value,
            excess_return_pct=metrics.excess_return_pct,
            hit_rate_by_signal=metrics.hit_rate_by_signal,
            equity_curve=metrics.equity_curve,
            status="DONE",
        )
        db.add(result)
        db.commit()
        db.refresh(result)
        return result.id


async def run_job(job_id: str, user_id: uuid.UUID, ticker: str, start: date, end: date) -> None:
    redis = get_redis()
    try:
        async with asyncio.timeout(JOB_MAX_SECONDS):  # a hung fetch ends as FAILED, not forever
            closes = await fetch_price_history(ticker, start, end)
            metrics = await asyncio.to_thread(simulate, closes)
            # The session is opened, used and closed inside one worker thread.
            result_id = await asyncio.to_thread(_save_result, user_id, ticker, start, end, metrics)

        await redis.hset(
            f"backtest_job:{job_id}",
            mapping={"status": "DONE", "backtest_result_id": result_id},
        )
    except AccountNotActive:
        # Expected when an account is removed mid-run: no traceback, nothing to investigate.
        logger.info("Backtest for ticker %s dropped: %s", ticker, AccountNotActive.__name__)
        await redis.hset(f"backtest_job:{job_id}", "status", "FAILED")
    except Exception:
        logger.exception("Backtest failed for ticker %s", ticker)
        await redis.hset(f"backtest_job:{job_id}", "status", "FAILED")
    finally:
        await redis.eval(_RELEASE_IF_MINE, 1, _active_key(user_id), job_id)
