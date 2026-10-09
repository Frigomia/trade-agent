"""Background writers must not leave rows behind for a user who was disabled or removed."""

import asyncio
import threading
import time
import uuid
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app.agents.jobs import run_job as run_analysis_job
from app.backtest.engine import BacktestMetrics
from app.backtest.jobs import AccountNotActive, _save_result
from app.db import lock_and_check_active, open_user_session
from app.models import BacktestResult, ChatMessage, Recommendation
from app.routers.chat import _save_reply
from app.user_data import delete_user_data
from tests.auth_support import add_app_user

METRICS = BacktestMetrics(
    final_value=1.0,
    buy_and_hold_value=1.0,
    excess_return_pct=0.0,
    hit_rate_by_signal={},
    equity_curve={"strategy": [1.0], "buy_and_hold": [1.0]},
)
STATE = {
    "action": "BUY",
    "reasoning": ["test"],
    "ai_analysis": None,
    "suggested_position_pct": 0.1,
    "quote": {"price": 10.0, "closes": [10.0]},
    "fundamental_score": 50,
    "technical_signal": "NEUTRAL",
}
TICKERS = [{"ticker": "AAPL", "asset_type": "STOCK", "is_held": False}]

# "disabled" and "no row at all" (None) must both block; "active" must not.
BLOCKED = ["disabled", None]


def _make_user(session_local, status: str | None) -> uuid.UUID:
    user_id = uuid.uuid4()
    if status is not None:
        with session_local() as session:
            add_app_user(session, user_id, status=status)
    return user_id


def _count(session_local, model, user_id: uuid.UUID) -> int:
    with session_local() as session:
        return session.query(model).filter_by(user_id=user_id).count()


def _analyse(app_session_local, user_id: uuid.UUID) -> list[dict]:
    """Runs one analysis job for the user; returns the result entries from Redis."""
    from app.agents.jobs import create_job, get_job_status

    async def _run() -> list[dict]:
        job_id = await create_job(user_id, TICKERS)
        with (
            patch("app.agents.jobs.run_graph_for_ticker", AsyncMock(return_value=STATE)),
            patch("app.db.SessionLocal", app_session_local),
        ):
            await run_analysis_job(job_id, user_id, TICKERS)
        status = await get_job_status(job_id, user_id)
        assert status is not None
        return status["results"]

    return asyncio.run(_run())


@pytest.mark.parametrize("status", BLOCKED)
def test_analysis_writes_nothing_for_a_blocked_user(session_local, app_session_local, status):
    user_id = _make_user(session_local, status)
    assert _analyse(app_session_local, user_id) == [{"ticker": "AAPL", "skipped": True}]
    assert _count(session_local, Recommendation, user_id) == 0


def test_analysis_still_writes_for_an_active_user(session_local, app_session_local):
    user_id = _make_user(session_local, "active")
    results = _analyse(app_session_local, user_id)
    assert "recommendation_id" in results[0]
    assert _count(session_local, Recommendation, user_id) == 1


@pytest.mark.parametrize("status", BLOCKED)
def test_chat_reply_is_dropped_for_a_blocked_user(session_local, app_session_local, status):
    user_id = _make_user(session_local, status)
    with open_user_session(app_session_local, user_id) as db:
        _save_reply(db, user_id, "s1", "hello")
    assert _count(session_local, ChatMessage, user_id) == 0


def test_chat_reply_is_saved_for_an_active_user(session_local, app_session_local):
    user_id = _make_user(session_local, "active")
    with open_user_session(app_session_local, user_id) as db:
        _save_reply(db, user_id, "s1", "hello")
    assert _count(session_local, ChatMessage, user_id) == 1


@pytest.mark.parametrize("status", BLOCKED)
def test_backtest_save_fails_without_a_row_for_a_blocked_user(
    session_local, app_session_local, status
):
    user_id = _make_user(session_local, status)
    with patch("app.db.SessionLocal", app_session_local), pytest.raises(AccountNotActive):
        _save_result(user_id, "AAPL", date(2020, 1, 1), date(2021, 1, 1), METRICS)
    assert _count(session_local, BacktestResult, user_id) == 0


def test_backtest_save_works_for_an_active_user(session_local, app_session_local):
    user_id = _make_user(session_local, "active")
    with patch("app.db.SessionLocal", app_session_local):
        _save_result(user_id, "AAPL", date(2020, 1, 1), date(2021, 1, 1), METRICS)
    assert _count(session_local, BacktestResult, user_id) == 1


def test_delete_waits_for_a_writer_holding_the_lock_then_removes_its_row(session_local):
    user_id = _make_user(session_local, "active")
    deleted = threading.Event()

    writer = session_local()
    assert lock_and_check_active(writer, user_id)  # the writer now holds the user's lock
    writer.add(ChatMessage(user_id=user_id, session_id="s1", role="assistant", content="late"))
    writer.flush()

    def _delete() -> None:
        delete_user_data(session_local, user_id)
        deleted.set()

    thread = threading.Thread(target=_delete)
    thread.start()
    time.sleep(1)
    assert not deleted.is_set()  # blocked on the lock, the uncommitted row is not yet visible

    writer.commit()  # releases the lock
    thread.join(timeout=10)
    writer.close()

    assert deleted.is_set()
    assert _count(session_local, ChatMessage, user_id) == 0
