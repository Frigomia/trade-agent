"""Scheduled job steps: daily portfolio snapshots and recommendation outcome evaluation."""

import argparse
import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from app import db as app_db
from app.memory.outcomes import evaluate_due_outcomes
from app.models import AppUser, Holding, PortfolioSnapshot
from app.redis_client import get_redis
from app.snapshots import record_snapshot

logger = logging.getLogger(__name__)

MAX_OUTCOME_BATCHES = 20


@dataclass
class Summary:
    users: int = 0
    snapshots_recorded: int = 0
    snapshots_skipped: int = 0
    outcomes_evaluated: int = 0
    failures: int = 0

    def line(self) -> str:
        return (
            f"users={self.users} snapshots_recorded={self.snapshots_recorded} "
            f"snapshots_skipped={self.snapshots_skipped} "
            f"outcomes_evaluated={self.outcomes_evaluated} failures={self.failures}"
        )


def active_user_ids() -> list[uuid.UUID]:
    with app_db.SessionLocal() as db:
        rows = (
            db.query(AppUser.id)
            .filter(AppUser.status == "active")
            .order_by(AppUser.created_at, AppUser.email)
            .all()
        )
    return [row[0] for row in rows]


async def run_snapshots(summary: Summary) -> None:
    ids = active_user_ids()
    if summary.users == 0:
        summary.users = len(ids)
    # created_at columns are naive UTC
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    for user_id in ids:
        try:
            with app_db.scoped_session(user_id) as db:
                has_open = (
                    db.query(Holding.id)
                    .filter(Holding.user_id == user_id, Holding.shares > 0)
                    .first()
                    is not None
                )
                done_today = (
                    db.query(PortfolioSnapshot.id)
                    .filter(
                        PortfolioSnapshot.user_id == user_id,
                        PortfolioSnapshot.created_at >= today,
                    )
                    .first()
                    is not None
                )
                if not has_open or done_today:
                    summary.snapshots_skipped += 1
                    reason = "no open holdings" if not has_open else "already recorded today"
                    logger.info("Snapshot user %s: skipped (%s)", user_id, reason)
                    continue
                await record_snapshot(db, user_id)
                summary.snapshots_recorded += 1
                logger.info("Snapshot user %s: recorded", user_id)
        except Exception as exc:
            summary.failures += 1
            logger.warning("Snapshot failed for user %s: %s", user_id, type(exc).__name__)


async def run_outcomes(summary: Summary) -> None:
    ids = active_user_ids()
    if summary.users == 0:
        summary.users = len(ids)
    for user_id in ids:
        try:
            with app_db.scoped_session(user_id) as db:
                evaluated = remaining = 0
                for _ in range(MAX_OUTCOME_BATCHES):
                    evaluated, remaining = await evaluate_due_outcomes(db, user_id)
                    summary.outcomes_evaluated += evaluated
                    if remaining == 0:
                        break
                logger.info(
                    "Outcomes user %s: evaluated=%d remaining=%d", user_id, evaluated, remaining
                )
                if remaining > 0:
                    logger.warning(
                        "Outcomes user %s: batch cap reached, %d still due", user_id, remaining
                    )
        except Exception as exc:
            summary.failures += 1
            logger.warning("Outcome evaluation failed for user %s: %s", user_id, type(exc).__name__)


COMMANDS = ("daily", "snapshots", "outcomes")
LOCK_SECONDS = 3600


async def run_command(command: str) -> int:
    key = f"scheduled:{command}"
    redis = None
    try:
        redis = get_redis()
        acquired = await redis.set(key, "1", nx=True, ex=LOCK_SECONDS)
    except Exception as exc:
        logger.error("Scheduled %s: cannot reach Redis (%s)", command, type(exc).__name__)
        return 1
    if not acquired:
        logger.warning("Scheduled %s: already running, nothing to do", command)
        return 0
    summary = Summary()
    try:
        if command in ("daily", "snapshots"):
            await run_snapshots(summary)
        if command in ("daily", "outcomes"):
            await run_outcomes(summary)
        logger.info("Scheduled %s done: %s", command, summary.line())
    except Exception as exc:
        # class name only: exception text can carry connection strings
        logger.error("Scheduled %s failed (%s)", command, type(exc).__name__)
        return 1
    finally:
        try:
            # ponytail: unconditional delete; a run longer than LOCK_SECONDS could delete the
            # next run's lock. Add an owner token if runs ever approach an hour.
            await redis.delete(key)
        except Exception as exc:
            logger.warning("Scheduled %s: lock release failed (%s)", command, type(exc).__name__)
    return 1 if summary.failures else 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(prog="python -m app.scheduled")
    parser.add_argument("command", choices=COMMANDS)
    args = parser.parse_args(argv)
    try:
        return asyncio.run(run_command(args.command))
    except Exception as exc:
        logger.error("Scheduled %s failed (%s)", args.command, type(exc).__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
