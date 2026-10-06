"""Rules shared by the weekday analysis job and the Preferences screen: whether a person's
automatic analysis is paused, and which tickers are still fresh enough to skip."""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from sqlalchemy.orm import Session

from app import claude_keys
from app.models import AppUser, Recommendation
from app.usage import LimitDefaults, effective_limit, get_usage

# A pending call this young is left alone; an older one is analyzed again and superseded.
STALE_AFTER = timedelta(days=3)


@dataclass(frozen=True)
class Pause:
    reason: Literal["no_key", "limit"]
    limit: int | None = None
    resumes_on: date | None = None


def fresh_pending_tickers(db: Session, user_id: uuid.UUID, now: datetime) -> set[str]:
    """Tickers that already have a PENDING recommendation younger than STALE_AFTER (`now` is naive
    UTC, like the created_at column)."""
    rows = (
        db.query(Recommendation.ticker)
        .filter(
            Recommendation.user_id == user_id,
            Recommendation.status == "PENDING",
            Recommendation.created_at > now - STALE_AFTER,
        )
        .distinct()
        .all()
    )
    return {row[0] for row in rows}


def next_month_start(today: date) -> date:
    """First day of the month after `today`: when this month's run counter starts over."""
    return date(today.year + 1, 1, 1) if today.month == 12 else date(today.year, today.month + 1, 1)


async def pause_state(
    db: Session, user: AppUser, defaults: LimitDefaults, today: date
) -> Pause | None:
    """Why this user's automatic analysis cannot run right now, or None when it can."""
    if not claude_keys.has_usable_key(db, user.id, user.role):
        return Pause("no_key")
    limit = effective_limit(user, "analysis_run", defaults)
    if await get_usage("analysis_run", str(user.id)) >= limit:
        return Pause("limit", limit=limit, resumes_on=next_month_start(today))
    return None
