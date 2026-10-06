import asyncio
import uuid
from datetime import UTC, date, datetime

from sqlalchemy.orm import Session

import app.redis_client as redis_client_module
from app import auto_analysis, claude_keys
from app.models import Recommendation, UserApiKey
from app.redis_client import get_redis
from app.usage import LimitDefaults
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user

DEFAULTS = LimitDefaults(analysis_runs=3, chat_messages=10)


def _run(coro):  # type: ignore[no-untyped-def]
    # Each asyncio.run() is its own event loop, and the cached Redis client is bound to one loop.
    try:
        return asyncio.run(coro)
    finally:
        redis_client_module._redis = None


def _rec(
    db: Session,
    ticker: str,
    status: str = "PENDING",
    created_at: datetime | None = None,
    user_id: uuid.UUID = USER_ID,
) -> None:
    db.add(
        Recommendation(
            user_id=user_id,
            ticker=ticker,
            asset_type="STOCK",
            action="BUY",
            reasoning=["x"],
            status=status,
            created_at=created_at or datetime(2026, 10, 8, 9, 0),
        )
    )
    db.commit()


def _key(db: Session, status: str = "ok") -> None:
    db.add(
        UserApiKey(
            user_id=USER_ID,
            ciphertext=claude_keys.encrypt_key(USER_ID, "sk-ant-test-key-0000"),
            last4="0000",
            status=status,
        )
    )
    db.commit()


def test_freshness_is_by_calendar_day_not_by_hours(db_session: Session) -> None:
    add_app_user(db_session, OTHER_USER_ID)
    now = datetime(2026, 10, 8, 5, 30)  # a Thursday
    _rec(db_session, "SAME", created_at=datetime(2026, 10, 8, 5, 0))  # today
    _rec(db_session, "EDGE", created_at=datetime(2026, 10, 6, 0, 0))  # 2 calendar days old: fresh
    _rec(db_session, "STALE", created_at=datetime(2026, 10, 5, 23, 59))  # 3 calendar days: stale
    _rec(db_session, "LATE", created_at=datetime(2026, 10, 6, 23, 59))  # Tuesday evening: fresh
    _rec(db_session, "DONE", status="APPROVED", created_at=datetime(2026, 10, 8, 1, 0))
    _rec(db_session, "OLDER", status="SUPERSEDED", created_at=datetime(2026, 10, 8, 1, 0))
    _rec(db_session, "NO", status="REJECTED", created_at=datetime(2026, 10, 8, 1, 0))
    _rec(db_session, "THEIRS", created_at=datetime(2026, 10, 8, 1, 0), user_id=OTHER_USER_ID)
    fresh = auto_analysis.fresh_pending_tickers(db_session, USER_ID, now)
    assert fresh == {"SAME", "EDGE", "LATE"}


def test_a_monday_call_is_fresh_through_wednesday_and_stale_on_thursday(
    db_session: Session,
) -> None:
    _rec(db_session, "AAPL", created_at=datetime(2026, 10, 5, 23, 0))  # Monday night
    for day, expected in ((5, True), (6, True), (7, True), (8, False)):
        now = datetime(2026, 10, day, 5, 30)
        fresh = auto_analysis.fresh_pending_tickers(db_session, USER_ID, now)
        assert (fresh == {"AAPL"}) is expected, day


def test_next_month_start_rolls_over_the_year() -> None:
    assert auto_analysis.next_month_start(date(2026, 10, 6)) == date(2026, 11, 1)
    assert auto_analysis.next_month_start(date(2026, 12, 31)) == date(2027, 1, 1)


def test_has_usable_key(db_session: Session) -> None:
    add_app_user(db_session, USER_ID, role="user")
    assert claude_keys.has_usable_key(db_session, USER_ID, "user") is False
    assert claude_keys.has_usable_key(db_session, USER_ID, "admin") is True  # server key
    _key(db_session)
    assert claude_keys.has_usable_key(db_session, USER_ID, "user") is True


def test_a_flagged_key_is_not_usable_even_for_an_admin(db_session: Session) -> None:
    add_app_user(db_session, USER_ID, role="admin")
    _key(db_session, status="needs_attention")
    assert claude_keys.has_usable_key(db_session, USER_ID, "admin") is False


def test_pause_state_no_key_then_limit_then_none(db_session: Session) -> None:
    user = add_app_user(db_session, USER_ID, role="user")
    today = date(2026, 10, 6)

    pause = _run(auto_analysis.pause_state(db_session, user, DEFAULTS, today))
    assert pause == auto_analysis.Pause("no_key")

    _key(db_session)
    assert _run(auto_analysis.pause_state(db_session, user, DEFAULTS, today)) is None

    month = datetime.now(UTC).strftime("%Y-%m")
    key = f"usage:analysis_run:{USER_ID}:{month}"
    _run(get_redis().set(key, 2))  # limit is 3: still room
    assert _run(auto_analysis.pause_state(db_session, user, DEFAULTS, today)) is None

    _run(get_redis().set(key, 3))  # used all 3
    pause = _run(auto_analysis.pause_state(db_session, user, DEFAULTS, today))
    assert pause == auto_analysis.Pause("limit", limit=3, resumes_on=date(2026, 11, 1))
