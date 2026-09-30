import asyncio
import logging
import uuid
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, Mock, patch

import pytest

import app.redis_client as redis_client_module
from app import scheduled
from app.models import Holding, PortfolioSnapshot, Recommendation
from app.redis_client import get_redis
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user

THIRD_USER_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
FOURTH_USER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")


def _utc_now():
    return datetime.now(UTC).replace(tzinfo=None)


def _holding(db, user_id, ticker="AAPL", shares=10):
    db.add(
        Holding(
            user_id=user_id,
            ticker=ticker,
            name=ticker,
            asset_type="STOCK",
            shares=shares,
            cost_basis=100.0,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    db.commit()


def _due_rec(db, user_id, days_old=25):
    db.add(
        Recommendation(
            user_id=user_id,
            ticker="AAPL",
            asset_type="STOCK",
            action="BUY",
            reasoning=["x"],
            price_at_recommendation=100.0,
            created_at=_utc_now() - timedelta(days=days_old),
        )
    )
    db.commit()


def _snapshots(db, user_id):
    return db.query(PortfolioSnapshot).filter_by(user_id=user_id).all()


@pytest.fixture()
def env(session_local, app_session_local):
    """Owner session for setup; the job itself runs through the restricted runtime role."""
    with patch("app.db.SessionLocal", app_session_local), session_local() as owner:
        yield owner


def _price_ok():
    return AsyncMock(return_value={"price": 200.0, "closes": []})


def _run_snapshots(quote=None):
    quote = quote or _price_ok()
    summary = scheduled.Summary()
    with patch("app.snapshots.fetch_quote_and_history", quote):
        asyncio.run(scheduled.run_snapshots(summary))
    return summary


def _run_outcomes(compute=None):
    summary = scheduled.Summary()
    with patch("app.memory.outcomes.compute_outcome", compute or AsyncMock(return_value=0.05)):
        asyncio.run(scheduled.run_outcomes(summary))
    return summary


def test_active_user_ids_excludes_invited_and_disabled(env):
    add_app_user(env, USER_ID, status="active")
    add_app_user(env, OTHER_USER_ID, status="invited")
    add_app_user(env, THIRD_USER_ID, status="disabled")

    assert scheduled.active_user_ids() == [USER_ID]


def test_snapshots_are_recorded_only_for_active_users_with_open_holdings(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID, status="invited")
    add_app_user(env, THIRD_USER_ID, status="disabled")
    add_app_user(env, FOURTH_USER_ID)  # active, but only a fully sold holding
    for uid in (USER_ID, OTHER_USER_ID, THIRD_USER_ID):
        _holding(env, uid)
    _holding(env, FOURTH_USER_ID, "OLD", shares=0)

    summary = _run_snapshots()

    assert len(_snapshots(env, USER_ID)) == 1
    assert float(_snapshots(env, USER_ID)[0].total_market_value) == 2000.0
    assert _snapshots(env, OTHER_USER_ID) == []
    assert _snapshots(env, THIRD_USER_ID) == []
    assert _snapshots(env, FOURTH_USER_ID) == []
    assert summary.snapshots_recorded == 1
    assert summary.snapshots_skipped == 1  # the active user with nothing open
    assert summary.failures == 0


def test_a_snapshot_from_today_is_not_duplicated_but_yesterdays_does_not_block(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    _holding(env, USER_ID)
    _holding(env, OTHER_USER_ID)
    env.add(
        PortfolioSnapshot(
            user_id=USER_ID, total_market_value=1, total_cost_basis=1, created_at=_utc_now()
        )
    )
    env.add(
        PortfolioSnapshot(
            user_id=OTHER_USER_ID,
            total_market_value=1,
            total_cost_basis=1,
            created_at=_utc_now() - timedelta(days=1),
        )
    )
    env.commit()

    summary = _run_snapshots()

    assert len(_snapshots(env, USER_ID)) == 1  # already recorded today
    assert len(_snapshots(env, OTHER_USER_ID)) == 2  # yesterday's does not count
    assert summary.snapshots_recorded == 1
    assert summary.snapshots_skipped == 1


def test_one_users_missing_price_does_not_stop_the_next_user(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    _holding(env, USER_ID, "DELISTED")
    _holding(env, OTHER_USER_ID, "AAPL")

    async def quote(ticker):
        return {"price": None if ticker == "DELISTED" else 200.0, "closes": []}

    summary = _run_snapshots(AsyncMock(side_effect=quote))

    assert _snapshots(env, USER_ID) == []  # never a partial total
    assert len(_snapshots(env, OTHER_USER_ID)) == 1
    assert summary.failures == 1
    assert summary.snapshots_recorded == 1


def test_a_quote_exception_is_counted_not_raised(env):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID)

    summary = _run_snapshots(AsyncMock(side_effect=RuntimeError("yfinance down")))

    assert summary.failures == 1
    assert _snapshots(env, USER_ID) == []


def test_outcomes_are_evaluated_only_for_active_users(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    add_app_user(env, THIRD_USER_ID, status="invited")
    for uid in (USER_ID, OTHER_USER_ID, THIRD_USER_ID):
        _due_rec(env, uid)

    summary = _run_outcomes()

    evaluated = {
        r.user_id: r.outcome_evaluated_at is not None for r in env.query(Recommendation).all()
    }
    assert evaluated == {USER_ID: True, OTHER_USER_ID: True, THIRD_USER_ID: False}
    assert summary.outcomes_evaluated == 2
    assert summary.failures == 0


def test_outcomes_drain_a_backlog_over_several_batches(env):
    add_app_user(env, USER_ID)
    for _ in range(51):
        _due_rec(env, USER_ID)

    summary = _run_outcomes()

    assert summary.outcomes_evaluated == 51
    assert (
        env.query(Recommendation).filter(Recommendation.outcome_evaluated_at.is_(None)).count() == 0
    )


def test_outcomes_drain_stops_at_the_batch_cap(env):
    add_app_user(env, USER_ID)
    for _ in range(51):
        _due_rec(env, USER_ID)

    with patch.object(scheduled, "MAX_OUTCOME_BATCHES", 1):
        summary = _run_outcomes()

    assert summary.outcomes_evaluated == 50
    assert (
        env.query(Recommendation).filter(Recommendation.outcome_evaluated_at.is_(None)).count() == 1
    )


def test_an_outcome_failure_for_one_user_does_not_stop_the_next(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    _due_rec(env, USER_ID)
    _due_rec(env, OTHER_USER_ID)
    evaluate = AsyncMock(side_effect=[RuntimeError("boom"), (1, 0)])

    summary = scheduled.Summary()
    with patch("app.scheduled.evaluate_due_outcomes", evaluate):
        asyncio.run(scheduled.run_outcomes(summary))

    assert summary.failures == 1
    assert summary.outcomes_evaluated == 1


def test_summary_line_lists_every_counter():
    line = scheduled.Summary(
        users=3, snapshots_recorded=2, snapshots_skipped=1, outcomes_evaluated=4, failures=0
    ).line()
    assert line == (
        "users=3 snapshots_recorded=2 snapshots_skipped=1 outcomes_evaluated=4 failures=0"
    )


def _arun(coro):
    """Fresh Redis client per event loop (see tests/conftest.py)."""
    redis_client_module._redis = None
    return asyncio.run(coro)


def _run_command(command, quote=None, compute=None):
    quote = quote or _price_ok()
    with (
        patch("app.snapshots.fetch_quote_and_history", quote),
        patch("app.memory.outcomes.compute_outcome", compute or AsyncMock(return_value=0.05)),
    ):
        return _arun(scheduled.run_command(command))


async def _lock_exists(key):
    return bool(await get_redis().exists(key))


def test_daily_runs_both_steps_exits_0_and_releases_the_lock(env):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID)
    _due_rec(env, USER_ID)

    code = _run_command("daily")

    assert code == 0
    assert len(_snapshots(env, USER_ID)) == 1
    assert env.query(Recommendation).one().outcome_evaluated_at is not None
    assert _arun(_lock_exists("scheduled:daily")) is False


def test_snapshots_and_outcomes_commands_each_run_only_their_own_step(env):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID)
    _due_rec(env, USER_ID)

    assert _run_command("snapshots") == 0
    assert len(_snapshots(env, USER_ID)) == 1
    assert env.query(Recommendation).one().outcome_evaluated_at is None

    assert _run_command("outcomes") == 0
    assert env.query(Recommendation).one().outcome_evaluated_at is not None


def test_the_exit_code_is_1_when_any_user_failed_but_the_others_still_ran(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    _holding(env, USER_ID, "DELISTED")
    _holding(env, OTHER_USER_ID, "AAPL")

    async def quote(ticker):
        return {"price": None if ticker == "DELISTED" else 200.0, "closes": []}

    code = _run_command("daily", quote=AsyncMock(side_effect=quote))

    assert code == 1
    assert len(_snapshots(env, OTHER_USER_ID)) == 1


def test_nothing_to_do_is_exit_0(env):
    assert _run_command("daily") == 0  # no users at all


def test_a_held_lock_makes_the_run_exit_0_without_work_and_keeps_the_lock(env):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID)

    async def go():
        redis = get_redis()
        await redis.set("scheduled:daily", "1", nx=True, ex=60)
        with patch("app.snapshots.fetch_quote_and_history", _price_ok()):
            code = await scheduled.run_command("daily")
        still_held = await redis.exists("scheduled:daily")
        await redis.delete("scheduled:daily")
        return code, still_held

    code, still_held = _arun(go())

    assert code == 0
    assert still_held == 1  # the other run's lock is not ours to release
    assert _snapshots(env, USER_ID) == []


def test_a_different_command_is_not_blocked_by_the_daily_lock(env):
    add_app_user(env, USER_ID)
    _due_rec(env, USER_ID)

    async def go():
        redis = get_redis()
        await redis.set("scheduled:daily", "1", nx=True, ex=60)
        with patch("app.memory.outcomes.compute_outcome", AsyncMock(return_value=0.05)):
            code = await scheduled.run_command("outcomes")
        await redis.delete("scheduled:daily")
        return code

    assert _arun(go()) == 0
    assert env.query(Recommendation).one().outcome_evaluated_at is not None


def test_an_unreachable_redis_exits_1_and_does_no_work(env, caplog):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID)

    class BrokenRedis:
        async def set(self, *args, **kwargs):
            raise ConnectionError("redis down")

    with patch("app.scheduled.get_redis", return_value=BrokenRedis()):
        code = _run_command("daily")

    assert code == 1
    assert _snapshots(env, USER_ID) == []
    assert "ConnectionError" in caplog.text
    assert "redis down" not in caplog.text


def test_a_malformed_redis_url_is_logged_by_class_and_exits_1(env, caplog):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID)

    with patch("app.scheduled.get_redis", side_effect=ValueError("secret-password")):
        code = _run_command("daily")

    assert code == 1
    assert _snapshots(env, USER_ID) == []
    assert "ValueError" in caplog.text
    assert "secret-password" not in caplog.text


def test_an_unexpected_error_exits_1_logs_the_class_only_and_releases_the_lock(env, caplog):
    with patch("app.scheduled.active_user_ids", side_effect=RuntimeError("secret-password")):
        code = _run_command("daily")

    assert code == 1
    assert _arun(_lock_exists("scheduled:daily")) is False
    assert "RuntimeError" in caplog.text
    assert "secret-password" not in caplog.text


def test_main_logs_the_class_only_and_returns_1_when_the_run_raises(caplog):
    with patch("app.scheduled.run_command", AsyncMock(side_effect=OSError("secret-password"))):
        assert scheduled.main(["daily"]) == 1
    assert "OSError" in caplog.text
    assert "secret-password" not in caplog.text


def test_outcomes_still_run_after_a_snapshot_failure(env):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID, "DELISTED")
    _due_rec(env, USER_ID)

    code = _run_command("daily", quote=AsyncMock(return_value={"price": None, "closes": []}))

    assert code == 1
    assert env.query(Recommendation).one().outcome_evaluated_at is not None


def test_daily_runs_snapshots_before_outcomes():
    parent = Mock()
    parent.attach_mock(AsyncMock(), "snapshots")
    parent.attach_mock(AsyncMock(), "outcomes")
    with (
        patch("app.scheduled.run_snapshots", parent.snapshots),
        patch("app.scheduled.run_outcomes", parent.outcomes),
    ):
        assert _arun(scheduled.run_command("daily")) == 0

    names = [c[0] for c in parent.mock_calls]
    assert names == ["snapshots", "outcomes"]


def test_the_lock_has_a_ttl_while_the_run_is_in_progress():
    seen = {}

    async def fake_snapshots(summary):
        seen["ttl"] = await get_redis().ttl("scheduled:snapshots")

    with patch("app.scheduled.run_snapshots", fake_snapshots):
        assert _arun(scheduled.run_command("snapshots")) == 0

    assert 0 < seen["ttl"] <= scheduled.LOCK_SECONDS


def test_summary_users_is_the_active_user_count_after_daily(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    add_app_user(env, THIRD_USER_ID, status="invited")
    summaries = []
    real = scheduled.Summary

    def spy():
        summaries.append(real())
        return summaries[-1]

    with patch("app.scheduled.Summary", spy):
        _run_command("daily")

    assert summaries[0].users == 2


def test_a_batch_evaluating_zero_with_remaining_keeps_looping(env):
    add_app_user(env, USER_ID)
    evaluate = AsyncMock(side_effect=[(0, 5), (0, 3), (2, 0)])
    summary = scheduled.Summary()
    with patch("app.scheduled.evaluate_due_outcomes", evaluate):
        asyncio.run(scheduled.run_outcomes(summary))

    assert summary.outcomes_evaluated == 2
    assert evaluate.await_count == 3


def test_snapshot_logs_one_line_per_user(env, caplog):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    _holding(env, USER_ID)

    with caplog.at_level(logging.INFO, logger="app.scheduled"):
        _run_snapshots()

    assert f"Snapshot user {USER_ID}: recorded" in caplog.text
    assert f"Snapshot user {OTHER_USER_ID}: skipped (no open holdings)" in caplog.text


def test_outcomes_log_a_line_per_user_and_warn_at_the_batch_cap(env, caplog):
    add_app_user(env, USER_ID)
    for _ in range(51):
        _due_rec(env, USER_ID)

    with (
        caplog.at_level(logging.INFO, logger="app.scheduled"),
        patch.object(scheduled, "MAX_OUTCOME_BATCHES", 1),
    ):
        _run_outcomes()

    assert f"Outcomes user {USER_ID}: evaluated=50 remaining=1" in caplog.text
    assert f"Outcomes user {USER_ID}: batch cap reached, 1 still due" in caplog.text


def test_outcomes_log_the_per_user_total_across_batches(env, caplog):
    add_app_user(env, USER_ID)
    for _ in range(51):
        _due_rec(env, USER_ID)

    with caplog.at_level(logging.INFO, logger="app.scheduled"):
        _run_outcomes()

    assert f"Outcomes user {USER_ID}: evaluated=51 remaining=0" in caplog.text


def test_main_dispatches_the_command_and_returns_its_exit_code():
    with patch("app.scheduled.run_command", AsyncMock(return_value=0)) as run:
        assert scheduled.main(["snapshots"]) == 0
    run.assert_awaited_once_with("snapshots")

    with patch("app.scheduled.run_command", AsyncMock(return_value=1)):
        assert scheduled.main(["daily"]) == 1


def test_main_rejects_an_unknown_command_with_exit_2():
    with pytest.raises(SystemExit) as caught:
        scheduled.main(["nope"])
    assert caught.value.code == 2
