"""Scheduled job steps: daily portfolio snapshots, recommendation outcome evaluation and the
opt-in weekday automatic analysis."""

import argparse
import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from redis.asyncio import Redis

from app import claude_keys, telegram
from app import db as app_db
from app.agents.jobs import (
    AnalysisAlreadyRunning,
    create_job,
    default_ticker_infos,
    get_job_status,
    run_job,
)
from app.auto_analysis import fresh_pending_tickers, pause_state
from app.config import settings
from app.memory.outcomes import evaluate_due_outcomes
from app.models import AppUser, Holding, InvestmentPreferences, PortfolioSnapshot
from app.notify import notify_user
from app.redis_client import get_redis
from app.snapshots import record_snapshot
from app.usage import (
    LimitDefaults,
    UsageLimitExceeded,
    check_and_increment_usage,
    effective_limit,
    load_limit_defaults,
    refund_usage,
)

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
    notify_sent: int = 0
    notify_skipped: int = 0
    notify_failures: int = 0

    def line(self) -> str:
        return (
            f"users={self.users} snapshots_recorded={self.snapshots_recorded} "
            f"snapshots_skipped={self.snapshots_skipped} "
            f"outcomes_evaluated={self.outcomes_evaluated} failures={self.failures} "
            f"analysis_runs={self.analysis_runs} analysis_skipped={self.analysis_skipped} "
            f"analysis_failures={self.analysis_failures} notify_sent={self.notify_sent} "
            f"notify_skipped={self.notify_skipped} notify_failures={self.notify_failures}"
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
                if await record_snapshot(db, user_id) is None:
                    summary.snapshots_skipped += 1
                    logger.info("Snapshot user %s: skipped (account not active)", user_id)
                    continue
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


# One user's run can take minutes (up to 50 tickers, 3 at a time). The budget is measured from the
# start of the whole command (snapshots and outcomes included) and keeps it inside its lock and its
# machine: users not reached are skipped and logged. A user who starts just inside the budget is
# still cut off at the end of it plus a grace period, so one stuck run cannot hold the command.
MAX_ANALYSIS_SECONDS = 2400
ANALYSIS_GRACE_SECONDS = 300
# The analysis step ends at most MAX_ANALYSIS_SECONDS + ANALYSIS_GRACE_SECONDS = 2700 s after the
# command started (snapshots and outcomes are inside the budget). The notify step runs after it and
# starts no new user later than NOTIFY_CUTOFF_SECONDS = LOCK_SECONDS - 300 = 3300 s after the start;
# one user's message takes seconds, so the command ends well under LOCK_SECONDS = 3600.
LOCK_SECONDS = 3600
NOTIFY_CUTOFF_SECONDS = LOCK_SECONDS - 300
# One person's message (quote lookups plus the send) may not take longer than this, so one stuck
# person cannot hold the others. A cut-off before the send leaves no marker; during the send the
# marker stays (the message may have gone out, so it is not retried today).
NOTIFY_USER_SECONDS = 120
ANALYSIS_LOCK_KEY = "scheduled:analysis-step"
# A same-day marker outlives the UTC day (25 h) so a late retry cannot slip past it.
RAN_MARKER_SECONDS = 90000

# Delete the lock only while it still holds our token, so a run that outlived its lock never
# removes the next run's lock. Check and delete happen in one step inside Redis.
_RELEASE_IF_OWNER = (
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0"
)


async def _release_lock(redis: Redis, key: str, token: str, label: str) -> None:
    try:
        await redis.eval(_RELEASE_IF_OWNER, 1, key, token)
    except Exception as exc:
        # The lock expires on its own after LOCK_SECONDS.
        logger.warning("%s: lock release failed (%s)", label, type(exc).__name__)


def _ran_marker_key(user_id: uuid.UUID, now: datetime) -> str:
    return f"auto_analysis:ran:{user_id}:{now.strftime('%Y-%m-%d')}"


async def _forget_marker(key: str) -> None:
    try:
        await get_redis().delete(key)
    except Exception as exc:
        # Not charged, but blocked until the marker expires: say so.
        logger.warning("Analysis: could not clear the same-day marker (%s)", type(exc).__name__)


async def _analyze_user(
    user_id: uuid.UUID, now: datetime, defaults: LimitDefaults, run_seconds: float
) -> str:
    """One user's automatic run: "off" | "skipped" | "ran" | "failed". The key's client exists only
    inside this call. `run_seconds` is how long the run itself may take before it is cut off."""
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
        infos = default_ticker_infos(db, user_id, open_only=True, exclude=fresh)
        if not infos:
            return "skipped"
        try:
            # Always the user's own client; None only for an admin with no key of their own.
            client = claude_keys.resolve_client(db, user_id, user.role)
        except claude_keys.ClaudeKeyRequired:
            return "skipped"  # includes a key that could not be decrypted (flagged inside)
        limit = effective_limit(user, "analysis_run", defaults)
        role = user.role  # read while the session is open
    # The session is closed: the run below must not hold a database connection for minutes.
    # One run per user per UTC day: a second command run the same day (for example "Re-run jobs"
    # after a red run) must not be charged again. Set only now, so a skipped user keeps no marker.
    marker = _ran_marker_key(user_id, now)
    if not await get_redis().set(marker, "1", nx=True, ex=RAN_MARKER_SECONDS):
        return "skipped"
    try:
        await check_and_increment_usage("analysis_run", str(user_id), limit)
    except Exception as exc:
        await _forget_marker(marker)  # nothing was charged, so the user may still run today
        if isinstance(exc, UsageLimitExceeded):
            return "skipped"  # raced past the limit after pause_state; usage already took it back
        raise  # the counter could not be read or written
    try:
        try:
            job_id = await create_job(user_id, infos)
        except AnalysisAlreadyRunning:
            # The person has a manual run going: not a failure. Undo the charge and the marker.
            # Refund first: if it raises, the marker stays and nobody is charged twice.
            await refund_usage("analysis_run", str(user_id))
            await _forget_marker(marker)
            return "skipped"
        async with asyncio.timeout(run_seconds):
            await run_job(job_id, user_id, infos, client=client, source="scheduled")
        status = await get_job_status(job_id, user_id)
    except Exception as exc:
        # The run was already counted against the limit: report it as a failed run. This includes
        # TimeoutError from the cut-off above; the marker stays, so it is not retried today.
        logger.warning("Analysis user %s: run raised %s", user_id, type(exc).__name__)
        return "failed"
    errored = status is not None and any("error" in r for r in status["results"])
    with app_db.scoped_session(user_id) as db:
        current = db.get(AppUser, user_id)
        if current is None or current.status != "active":
            return "skipped"  # removed or disabled during the run: not a failure
        rejected = not claude_keys.has_usable_key(db, user_id, role)  # flagged during the run
    return "failed" if errored or rejected else "ran"


async def run_analysis(
    summary: Summary, now: datetime | None = None, started: float | None = None
) -> bool:
    """Opt-in weekday analysis (Monday to Friday, UTC). A user's failure is counted and logged by
    id and class name; the others still run. `started` is the command's start on the monotonic
    clock (the time budget counts from there); it defaults to now.

    Takes its own lock, shared by `daily` and `analysis`, so two commands never analyze (and charge
    people's keys) at the same time. Returns False only when another run holds that lock (this one
    did not do its pass); True otherwise, a weekend included."""
    now = now or datetime.now(UTC)
    started = time.monotonic() if started is None else started
    if now.weekday() >= 5:
        logger.info("Analysis: weekend, nothing to do")
        return True
    redis = get_redis()
    token = uuid.uuid4().hex
    if not await redis.set(ANALYSIS_LOCK_KEY, token, nx=True, ex=LOCK_SECONDS):
        logger.warning("Analysis: another analysis run is in progress, nothing to do")
        return False
    try:
        await _analyze_all(summary, now, started)
    finally:
        await _release_lock(redis, ANALYSIS_LOCK_KEY, token, "Analysis")
    return True


async def _analyze_all(summary: Summary, now: datetime, started: float) -> None:
    ids = active_user_ids()
    if summary.users == 0:
        summary.users = len(ids)
    if ids:
        # Start somewhere different each day, so the same people are not always last when the
        # budget runs out.
        k = now.date().toordinal() % len(ids)
        ids = ids[k:] + ids[:k]
    with app_db.SessionLocal() as db:
        defaults = load_limit_defaults(db, settings)
    not_reached = 0
    for user_id in ids:
        remaining = MAX_ANALYSIS_SECONDS - (time.monotonic() - started)
        if remaining <= 0:
            summary.analysis_skipped += 1
            not_reached += 1
            logger.warning("Analysis user %s: skipped (time budget used up)", user_id)
            continue
        try:
            outcome = await _analyze_user(
                user_id, now, defaults, remaining + ANALYSIS_GRACE_SECONDS
            )
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
    if not_reached:
        logger.warning("Analysis: %d users not reached, budget used up", not_reached)


async def run_notify(
    summary: Summary, now: datetime | None = None, started: float | None = None
) -> None:
    """Weekday Telegram messages. Never raises and never changes the exit code: a Telegram problem
    is counted and logged by user id and class name only. `started` is the command's start on the
    monotonic clock; no new user is started after NOTIFY_CUTOFF_SECONDS from it."""
    now = now or datetime.now(UTC)
    if now.weekday() >= 5:
        logger.info("Notify: weekend, nothing to do")
        return
    bot = telegram.get_bot()
    if bot is None:
        logger.info("Notify: Telegram is not set up, nothing to do")
        return
    started = time.monotonic() if started is None else started
    not_reached = 0
    for user_id in active_user_ids():
        if time.monotonic() - started > NOTIFY_CUTOFF_SECONDS:
            summary.notify_skipped += 1
            not_reached += 1
            continue
        try:
            async with asyncio.timeout(NOTIFY_USER_SECONDS):
                outcome = await notify_user(user_id, now, bot)
        except Exception as exc:
            summary.notify_failures += 1
            logger.warning("Notify failed for user %s: %s", user_id, type(exc).__name__)
            continue
        if outcome == "sent":
            summary.notify_sent += 1
        elif outcome == "failed":
            summary.notify_failures += 1
        else:  # skipped, or blocked (the link is now marked and not retried)
            summary.notify_skipped += 1
        logger.info("Notify user %s: %s", user_id, outcome)
    if not_reached:
        logger.warning("Notify: %d users not reached, time budget used up", not_reached)


COMMANDS = ("daily", "snapshots", "outcomes", "analysis", "notify")


async def run_command(command: str) -> int:
    key = f"scheduled:{command}"
    token = uuid.uuid4().hex
    redis = None
    try:
        redis = get_redis()
        acquired = await redis.set(key, token, nx=True, ex=LOCK_SECONDS)
    except Exception as exc:
        logger.error("Scheduled %s: cannot reach Redis (%s)", command, type(exc).__name__)
        return 1
    if not acquired:
        logger.warning("Scheduled %s: already running, nothing to do", command)
        return 0
    started = time.monotonic()
    summary = Summary()
    try:
        if command in ("daily", "snapshots"):
            await run_snapshots(summary)
        if command in ("daily", "outcomes"):
            await run_outcomes(summary)
        analysis_ran = True
        if command in ("daily", "analysis"):
            analysis_ran = await run_analysis(summary, started=started)
        if command == "daily" and not analysis_ran:
            logger.warning(
                "Notify: the analysis is still running elsewhere, skipping so the digest is "
                "not incomplete"
            )
        elif command in ("daily", "notify"):
            await run_notify(summary, started=started)
        logger.info("Scheduled %s done: %s", command, summary.line())
    except Exception as exc:
        # class name only: exception text can carry connection strings
        logger.error("Scheduled %s failed (%s)", command, type(exc).__name__)
        return 1
    finally:
        await _release_lock(redis, key, token, f"Scheduled {command}")
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
