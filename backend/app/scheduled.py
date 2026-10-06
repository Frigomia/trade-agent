"""Scheduled job steps: daily portfolio snapshots, recommendation outcome evaluation and the
opt-in weekday automatic analysis."""

import argparse
import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from app import claude_keys
from app import db as app_db
from app.agents.jobs import create_job, default_ticker_infos, get_job_status, run_job
from app.auto_analysis import fresh_pending_tickers, pause_state
from app.config import settings
from app.memory.outcomes import evaluate_due_outcomes
from app.models import AppUser, Holding, InvestmentPreferences, PortfolioSnapshot, UserApiKey
from app.redis_client import get_redis
from app.snapshots import record_snapshot
from app.usage import LimitDefaults, check_and_increment_usage, effective_limit, load_limit_defaults

logger = logging.getLogger(__name__)

MAX_OUTCOME_BATCHES = 20


@dataclass
class Summary:
    users: int = 0
    snapshots_recorded: int = 0
    snapshots_skipped: int = 0
    outcomes_evaluated: int = 0
    failures: int = 0
    analysis_runs: int = 0
    analysis_skipped: int = 0
    analysis_failures: int = 0

    def line(self) -> str:
        return (
            f"users={self.users} snapshots_recorded={self.snapshots_recorded} "
            f"snapshots_skipped={self.snapshots_skipped} "
            f"outcomes_evaluated={self.outcomes_evaluated} failures={self.failures} "
            f"analysis_runs={self.analysis_runs} analysis_skipped={self.analysis_skipped} "
            f"analysis_failures={self.analysis_failures}"
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
                total = remaining = 0
                for _ in range(MAX_OUTCOME_BATCHES):
                    evaluated, remaining = await evaluate_due_outcomes(db, user_id)
                    total += evaluated
                    summary.outcomes_evaluated += evaluated
                    if remaining == 0:
                        break
                logger.info(
                    "Outcomes user %s: evaluated=%d remaining=%d", user_id, total, remaining
                )
                if remaining > 0:
                    logger.warning(
                        "Outcomes user %s: batch cap reached, %d still due", user_id, remaining
                    )
        except Exception as exc:
            summary.failures += 1
            logger.warning("Outcome evaluation failed for user %s: %s", user_id, type(exc).__name__)


# One user's run can take minutes (up to 50 tickers, 3 at a time). A global budget keeps the whole
# command inside its lock and its machine: users not reached are skipped and logged.
MAX_ANALYSIS_SECONDS = 2400


async def _analyze_user(user_id: uuid.UUID, now: datetime, defaults: LimitDefaults) -> str:
    """One user's automatic run: "off" | "skipped" | "ran" | "failed". The key's client exists only
    inside this call."""
    with app_db.scoped_session(user_id) as db:
        prefs = db.query(InvestmentPreferences).filter_by(user_id=user_id).one_or_none()
        if prefs is None or not prefs.auto_analysis:
            return "off"
        user = db.get(AppUser, user_id)
        if user is None or user.status != "active":
            return "off"
        if await pause_state(db, user, defaults, now.date()) is not None:
            return "skipped"
        fresh = fresh_pending_tickers(db, user_id, now.replace(tzinfo=None))
        infos = [
            t for t in default_ticker_infos(db, user_id, open_only=True) if t["ticker"] not in fresh
        ]
        if not infos:
            return "skipped"
        try:
            # Always the user's own client; None only for an admin with no key of their own.
            client = claude_keys.resolve_client(db, user_id, user.role)
        except claude_keys.ClaudeKeyRequired:
            return "skipped"  # includes a key that could not be decrypted (flagged inside)
        limit = effective_limit(user, "analysis_run", defaults)
    # The session is closed: the run below must not hold a database connection for minutes.
    await check_and_increment_usage("analysis_run", str(user_id), limit)
    job_id = await create_job(user_id, infos)
    await run_job(job_id, user_id, infos, client=client, source="scheduled")
    status = await get_job_status(job_id, user_id)
    errored = status is not None and any("error" in r for r in status["results"])
    with app_db.scoped_session(user_id) as db:
        key = db.query(UserApiKey).filter_by(user_id=user_id).one_or_none()
        rejected = key is not None and key.status != "ok"
    return "failed" if errored or rejected else "ran"


async def run_analysis(summary: Summary, now: datetime | None = None) -> None:
    """Opt-in weekday analysis (Monday to Friday, UTC). A user's failure is counted and logged by
    id and class name; the others still run."""
    now = now or datetime.now(UTC)
    if now.weekday() >= 5:
        logger.info("Analysis: weekend, nothing to do")
        return
    ids = active_user_ids()
    if summary.users == 0:
        summary.users = len(ids)
    with app_db.SessionLocal() as db:
        defaults = load_limit_defaults(db, settings)
    started = time.monotonic()
    for user_id in ids:
        if time.monotonic() - started > MAX_ANALYSIS_SECONDS:
            summary.analysis_skipped += 1
            logger.warning("Analysis user %s: skipped (time budget used up)", user_id)
            continue
        try:
            outcome = await _analyze_user(user_id, now, defaults)
        except Exception as exc:
            summary.analysis_failures += 1
            logger.warning("Analysis failed for user %s: %s", user_id, type(exc).__name__)
            continue
        if outcome == "ran":
            summary.analysis_runs += 1
        elif outcome == "skipped":
            summary.analysis_skipped += 1
        elif outcome == "failed":
            summary.analysis_runs += 1  # the run was counted against the monthly limit
            summary.analysis_failures += 1
            logger.warning("Analysis user %s: finished with errors", user_id)
        logger.info("Analysis user %s: %s", user_id, outcome)


COMMANDS = ("daily", "snapshots", "outcomes", "analysis")
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
        if command in ("daily", "analysis"):
            await run_analysis(summary)
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
    return 1 if summary.failures or summary.analysis_failures else 0


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
