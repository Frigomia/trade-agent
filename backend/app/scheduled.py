"""Scheduled job steps: daily portfolio snapshots and recommendation outcome evaluation."""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from app import db as app_db
from app.memory.outcomes import evaluate_due_outcomes
from app.models import AppUser, Holding, PortfolioSnapshot
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
                    continue
                await record_snapshot(db, user_id)
                summary.snapshots_recorded += 1
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
                for _ in range(MAX_OUTCOME_BATCHES):
                    evaluated, remaining = await evaluate_due_outcomes(db, user_id)
                    summary.outcomes_evaluated += evaluated
                    if remaining == 0:
                        break
        except Exception as exc:
            summary.failures += 1
            logger.warning("Outcome evaluation failed for user %s: %s", user_id, type(exc).__name__)
