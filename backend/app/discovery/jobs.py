"""Owner-scoped discovery jobs with one expiring run marker per user."""

import asyncio
import json
import logging
from typing import Any
from uuid import UUID, uuid4

from anthropic import Anthropic

from app.agents.jobs import JOB_TTL_SECONDS
from app.discovery.persistence import save_scan
from app.discovery.runner import SCAN_TIMEOUT_SECONDS, SnapshotUnavailable, evaluate_scan
from app.redis_client import _RELEASE_IF_MINE, get_redis
from app.schemas import ScanRunOut

logger = logging.getLogger(__name__)


class DiscoveryAlreadyRunning(Exception):
    """The caller already owns a running discovery scan."""


def _active_key(user_id: UUID) -> str:
    return f"discovery_active:{user_id}"


def _job_key(job_id: str) -> str:
    return f"discovery:job:{job_id}"


async def create_job(user_id: UUID) -> str:
    redis = get_redis()
    job_id = str(uuid4())
    # Claim after the metadata exists; a refused request leaves only an expiring unused hash.
    async with redis.pipeline(transaction=True) as pipe:
        pipe.hset(
            _job_key(job_id),
            mapping={
                "owner": str(user_id),
                "status": "RUNNING",
                "stage": "screening",
                "total": 0,
                "done": 0,
            },
        )
        pipe.expire(_job_key(job_id), JOB_TTL_SECONDS)
        await pipe.execute()
    if not await redis.set(_active_key(user_id), job_id, nx=True, ex=JOB_TTL_SECONDS):
        raise DiscoveryAlreadyRunning
    return job_id


async def get_job_status(job_id: str, user_id: UUID) -> dict[str, Any] | None:
    data = await get_redis().hgetall(_job_key(job_id))
    if not data or data.get("owner") != str(user_id):
        return None
    return {
        "status": data["status"],
        "stage": data["stage"],
        "total": int(data["total"]),
        "done": int(data["done"]),
        "results": json.loads(data.get("results", "[]")),
        "scan": json.loads(data.get("scan", "null")),
        "error": data.get("error"),
    }


async def run_job(job_id: str, user_id: UUID, client: Anthropic) -> None:
    redis = get_redis()
    key = _job_key(job_id)

    async def progress(stage: str, total: int, done: int) -> None:
        await redis.hset(key, mapping={"stage": stage, "total": total, "done": done})

    async def failed(error: str) -> None:
        try:
            await redis.hset(key, mapping={"status": "FAILED", "stage": "failed", "error": error})
        except Exception as exc:
            logger.warning("Discovery failure status unavailable (%s)", type(exc).__name__)

    try:
        async with asyncio.timeout(SCAN_TIMEOUT_SECONDS):
            result = await evaluate_scan(user_id, client, progress)
        await progress("writing", result.shortlisted, result.shortlisted)
        # Keep the marker until the database thread finishes, even if shutdown cancels this task.
        write = asyncio.create_task(
            asyncio.to_thread(
                save_scan,
                user_id,
                result.ideas,
                universe_size=result.universe_size,
                eligible=result.eligible,
                shortlisted=result.shortlisted,
                researched=result.researched,
                excluded=result.excluded,
                rejected_mentions=result.rejected_mentions,
                coverage_summary=result.coverage_summary,
            )
        )
        try:
            scan = await asyncio.shield(write)
        except asyncio.CancelledError:
            await write
            raise
        if scan is None:
            await failed("Account is no longer active.")
        else:
            await redis.hset(
                key,
                mapping={
                    "status": "DONE",
                    "stage": "completed",
                    "results": json.dumps([idea.model_dump(mode="json") for idea in result.ideas]),
                    "scan": ScanRunOut.model_validate(scan).model_dump_json(),
                },
            )
    except asyncio.CancelledError:
        await failed("Scan interrupted.")
        raise
    except Exception as exc:
        logger.warning("Discovery scan failed (%s)", type(exc).__name__)
        error = (
            "Discovery snapshot unavailable. Refresh the universe snapshot before trying again."
            if isinstance(exc, SnapshotUnavailable)
            else "Discovery scan failed. Please try again."
        )
        await failed(error)
    finally:
        try:
            await redis.expire(key, JOB_TTL_SECONDS)
        except Exception as exc:
            logger.warning("Discovery job expiry unavailable (%s)", type(exc).__name__)
        finally:
            try:
                await redis.eval(_RELEASE_IF_MINE, 1, _active_key(user_id), job_id)
            except Exception as exc:
                logger.warning("Discovery marker release failed (%s)", type(exc).__name__)
