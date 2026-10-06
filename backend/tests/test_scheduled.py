import asyncio
import logging
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, Mock, patch

import pytest

import app.redis_client as redis_client_module
from app import claude_keys, scheduled
from app.agents.jobs import create_job, run_job
from app.models import (
    AppUser,
    Holding,
    InvestmentPreferences,
    PortfolioSnapshot,
    Recommendation,
    UserApiKey,
    WatchlistItem,
)
from app.redis_client import get_redis
from app.usage import UsageLimitExceeded, _usage_key
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
        users=3,
        snapshots_recorded=2,
        snapshots_skipped=1,
        outcomes_evaluated=4,
        failures=0,
        analysis_runs=5,
        analysis_skipped=6,
        analysis_failures=7,
    ).line()
    assert line == (
        "users=3 snapshots_recorded=2 snapshots_skipped=1 outcomes_evaluated=4 failures=0 "
        "analysis_runs=5 analysis_skipped=6 analysis_failures=7"
    )


def _arun(coro):
    """Fresh Redis client per event loop (see tests/conftest.py)."""
    redis_client_module._redis = None
    try:
        return asyncio.run(coro)
    finally:
        redis_client_module._redis = None


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


MONDAY = datetime(2026, 10, 5, 5, 30, tzinfo=UTC)
SATURDAY = datetime(2026, 10, 10, 5, 30, tzinfo=UTC)


def _key_text(user_id):
    return f"sk-ant-test-key-{str(user_id)[-4:]}"  # a different key per test user


def _opted_in(db, user_id, *, key=True, role="user", status="active"):
    add_app_user(db, user_id, role=role, status=status)
    db.add(InvestmentPreferences(user_id=user_id, auto_analysis=True))
    if key:
        db.add(
            UserApiKey(
                user_id=user_id,
                ciphertext=claude_keys.encrypt_key(user_id, _key_text(user_id)),
                last4=_key_text(user_id)[-4:],
            )
        )
    db.commit()


def _state(action="BUY"):
    return {
        "action": action,
        "reasoning": ["x"],
        "ai_analysis": None,
        "suggested_position_pct": 0.05,
        "quote": {"price": 100.0},
        "fundamental_score": 5,
        "technical_signal": "NEUTRAL",
    }


def _run_analysis(now=MONDAY, graph=None):
    summary = scheduled.Summary()
    graph = graph or AsyncMock(return_value=_state())
    with patch("app.agents.jobs.run_graph_for_ticker", graph):
        _arun(scheduled.run_analysis(summary, now=now))
    return summary, graph


def _recs(db, user_id):
    return db.query(Recommendation).filter_by(user_id=user_id).all()


def _usage(user_id):
    return _arun(get_redis().get(_usage_key("analysis_run", str(user_id))))


def test_an_opted_in_user_gets_scheduled_recommendations_and_one_run_is_counted(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    summary, graph = _run_analysis()
    recs = _recs(env, USER_ID)
    assert [(r.ticker, r.source, r.status) for r in recs] == [("AAPL", "scheduled", "PENDING")]
    assert (summary.analysis_runs, summary.analysis_skipped, summary.analysis_failures) == (1, 0, 0)
    # the run was made with the user's own client, never the server key
    assert graph.await_args.args[4].api_key == _key_text(USER_ID)
    assert _usage(USER_ID) == "1"


def test_a_user_who_has_not_opted_in_is_left_alone(env):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert (summary.analysis_runs, summary.analysis_skipped) == (0, 0)


def test_weekends_do_nothing(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    summary, graph = _run_analysis(now=SATURDAY)
    graph.assert_not_awaited()
    assert summary.analysis_runs == 0


def test_only_active_users_run(env):
    _opted_in(env, USER_ID, status="invited")
    _holding(env, USER_ID, "AAPL")
    _, graph = _run_analysis()
    graph.assert_not_awaited()


def test_a_user_without_a_key_is_skipped_not_failed(env):
    _opted_in(env, USER_ID, key=False)
    _holding(env, USER_ID, "AAPL")
    summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert (summary.analysis_skipped, summary.analysis_failures) == (1, 0)


def test_an_admin_without_a_personal_key_uses_the_server_key(env):
    _opted_in(env, USER_ID, key=False, role="admin")
    _holding(env, USER_ID, "AAPL")
    summary, graph = _run_analysis()
    assert summary.analysis_runs == 1
    assert graph.await_args.args[4] is None  # client None = the server's key, admin only


def test_a_user_at_the_monthly_limit_is_skipped_and_one_below_it_runs(env):
    _opted_in(env, USER_ID)
    _opted_in(env, OTHER_USER_ID)
    for uid in (USER_ID, OTHER_USER_ID):
        _holding(env, uid, "AAPL")
        env.query(AppUser).filter_by(id=uid).update({"monthly_analysis_limit": 2})
    env.commit()

    async def seed():
        redis = get_redis()
        await redis.set(_usage_key("analysis_run", str(USER_ID)), 2)  # used all
        await redis.set(_usage_key("analysis_run", str(OTHER_USER_ID)), 1)  # one left

    _arun(seed())
    summary, _ = _run_analysis()
    assert _recs(env, USER_ID) == []
    assert len(_recs(env, OTHER_USER_ID)) == 1
    assert (summary.analysis_runs, summary.analysis_skipped) == (1, 1)


def test_a_fresh_pending_call_is_skipped_and_an_old_one_is_replaced(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    _holding(env, USER_ID, "MSFT")
    now = MONDAY.replace(tzinfo=None)
    for ticker, age in (("AAPL", 1), ("MSFT", 4)):
        env.add(
            Recommendation(
                user_id=USER_ID,
                ticker=ticker,
                asset_type="STOCK",
                action="HOLD",
                reasoning=["old"],
                created_at=now - timedelta(days=age),
            )
        )
    env.commit()
    summary, graph = _run_analysis()
    assert [c.args[1] for c in graph.await_args_list] == ["MSFT"]  # AAPL is fresh: left alone
    by_ticker = {}
    for r in _recs(env, USER_ID):
        by_ticker.setdefault(r.ticker, []).append((r.source, r.status))
    assert by_ticker["AAPL"] == [("manual", "PENDING")]
    assert sorted(by_ticker["MSFT"]) == [("manual", "SUPERSEDED"), ("scheduled", "PENDING")]
    assert summary.analysis_runs == 1


def test_running_twice_on_the_same_day_skips_everything_the_second_time(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    _run_analysis()
    summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert (summary.analysis_runs, summary.analysis_skipped) == (0, 1)
    assert _usage(USER_ID) == "1"


def test_nothing_to_analyze_counts_no_run(env):
    _opted_in(env, USER_ID)  # no holdings, no watchlist
    _opted_in(env, OTHER_USER_ID)
    _holding(env, OTHER_USER_ID, "AAPL", shares=0)  # a closed position is not analyzed
    summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert (summary.analysis_runs, summary.analysis_skipped) == (0, 2)
    assert _usage(USER_ID) is None


def test_the_watchlist_is_analyzed_too(env):
    _opted_in(env, USER_ID)
    env.add(WatchlistItem(user_id=USER_ID, ticker="NVDA", asset_type="STOCK"))
    env.commit()
    _run_analysis()
    assert [(r.ticker, r.source) for r in _recs(env, USER_ID)] == [("NVDA", "scheduled")]


def test_one_failing_user_does_not_stop_the_others_and_the_command_fails(env, caplog):
    _opted_in(env, USER_ID)
    _opted_in(env, OTHER_USER_ID)
    _holding(env, USER_ID, "AAPL")
    _holding(env, OTHER_USER_ID, "MSFT")

    async def graph(user_id, ticker, *args):
        if user_id == USER_ID:
            raise RuntimeError("boom " + _key_text(user_id))
        return _state()

    with caplog.at_level(logging.DEBUG):
        summary, _ = _run_analysis(graph=AsyncMock(side_effect=graph))
    assert len(_recs(env, OTHER_USER_ID)) == 1
    assert summary.analysis_failures == 1 and summary.analysis_runs == 2
    assert _key_text(USER_ID) not in caplog.text


def test_a_key_anthropic_rejects_during_the_run_counts_as_a_failure_and_is_flagged(env):
    _opted_in(env, USER_ID)
    _opted_in(env, OTHER_USER_ID)
    _holding(env, USER_ID, "AAPL")
    _holding(env, OTHER_USER_ID, "MSFT")

    async def graph(user_id, ticker, *args):
        if user_id == USER_ID:
            claude_keys.mark_needs_attention(user_id)  # what graph.news_agent does on a 401
        return _state()

    summary, _ = _run_analysis(graph=AsyncMock(side_effect=graph))
    env.expire_all()
    assert env.query(UserApiKey).filter_by(user_id=USER_ID).one().status == "needs_attention"
    assert summary.analysis_failures == 1
    assert len(_recs(env, OTHER_USER_ID)) == 1


def test_an_undecryptable_key_is_skipped_and_flagged_not_crashed(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    env.query(UserApiKey).update({"ciphertext": b"not a real ciphertext at all, no."})
    env.commit()
    summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert (summary.analysis_skipped, summary.analysis_failures) == (1, 0)
    env.expire_all()
    assert env.query(UserApiKey).one().status == "needs_attention"


def test_a_run_past_the_time_budget_skips_the_remaining_users(env, monkeypatch):
    _opted_in(env, USER_ID)
    _opted_in(env, OTHER_USER_ID)
    _holding(env, USER_ID, "AAPL")
    _holding(env, OTHER_USER_ID, "MSFT")
    monkeypatch.setattr(scheduled, "MAX_ANALYSIS_SECONDS", -1)
    summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert summary.analysis_skipped == 2


def test_the_analysis_command_runs_the_step_and_exits_non_zero_on_a_failed_user(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    graph = AsyncMock(side_effect=RuntimeError("boom"))
    # run_job swallows a per-ticker error into the job results; the user still counts as failed
    with (
        patch("app.agents.jobs.run_graph_for_ticker", graph),
        patch("app.scheduled.datetime") as clock,
    ):
        clock.now.return_value = MONDAY
        assert _arun(scheduled.run_command("analysis")) == 1


def test_each_user_runs_with_their_own_key(env):
    _opted_in(env, USER_ID)
    _opted_in(env, OTHER_USER_ID)
    _holding(env, USER_ID, "AAPL")
    _holding(env, OTHER_USER_ID, "MSFT")
    _, graph = _run_analysis()
    keys = {c.args[0]: c.args[4].api_key for c in graph.await_args_list}
    assert keys == {USER_ID: _key_text(USER_ID), OTHER_USER_ID: _key_text(OTHER_USER_ID)}


def test_a_user_who_races_past_the_limit_is_skipped(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    race = AsyncMock(side_effect=UsageLimitExceeded("analysis_run", 1))
    with patch("app.scheduled.check_and_increment_usage", race):
        summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert (summary.analysis_runs, summary.analysis_skipped, summary.analysis_failures) == (0, 1, 0)


def test_a_run_that_raises_after_the_increment_counts_as_a_run_and_a_failure(env):
    _opted_in(env, USER_ID)
    _opted_in(env, OTHER_USER_ID)
    _holding(env, USER_ID, "AAPL")
    _holding(env, OTHER_USER_ID, "MSFT")
    real = scheduled.run_job

    async def run_job(job_id, user_id, *args, **kwargs):
        if user_id == USER_ID:
            raise RuntimeError("redis went away")
        return await real(job_id, user_id, *args, **kwargs)

    with patch("app.scheduled.run_job", run_job):
        summary, _ = _run_analysis()
    assert (summary.analysis_runs, summary.analysis_failures) == (2, 1)
    assert _usage(USER_ID) == "1"
    assert len(_recs(env, OTHER_USER_ID)) == 1


def test_the_daily_command_runs_the_analysis_step_too(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    with (
        patch("app.agents.jobs.run_graph_for_ticker", AsyncMock(return_value=_state())),
        patch("app.scheduled.datetime") as clock,
        patch("app.snapshots.fetch_quote_and_history", _price_ok()),
        patch("app.memory.outcomes.compute_outcome", AsyncMock(return_value=0.05)),
    ):
        clock.now.return_value = MONDAY
        assert _arun(scheduled.run_command("daily")) == 0
    assert [(r.ticker, r.source) for r in _recs(env, USER_ID)] == [("AAPL", "scheduled")]


TUESDAY = datetime(2026, 10, 6, 5, 30, tzinfo=UTC)


def _marker_exists(user_id, now=MONDAY):
    return _arun(_lock_exists(scheduled._ran_marker_key(user_id, now)))


def test_a_second_analysis_while_the_step_lock_is_held_does_nothing(env, caplog):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")

    async def go():
        redis = get_redis()
        await redis.set(scheduled.ANALYSIS_LOCK_KEY, "someone-else", nx=True, ex=60)
        summary = scheduled.Summary()
        await scheduled.run_analysis(summary, now=MONDAY)
        return summary, await redis.get(scheduled.ANALYSIS_LOCK_KEY)

    with (
        caplog.at_level(logging.WARNING, logger="app.scheduled"),
        patch("app.agents.jobs.run_graph_for_ticker", AsyncMock(return_value=_state())) as graph,
    ):
        summary, holder = _arun(go())
    graph.assert_not_awaited()
    assert holder == "someone-else"  # not ours to release
    assert summary.line().endswith("analysis_runs=0 analysis_skipped=0 analysis_failures=0")
    assert "another analysis run is in progress" in caplog.text
    assert _usage(USER_ID) is None


def test_daily_and_analysis_cannot_analyze_at_the_same_time(env):
    seen = {}

    async def analyze_all(summary, now, started):
        seen["calls"] = seen.get("calls", 0) + 1
        if seen["calls"] == 1:
            # the `analysis` command starts while `daily` is in its analysis step
            seen["inner"] = await scheduled.run_command("analysis")

    with (
        patch("app.scheduled._analyze_all", analyze_all),
        patch("app.scheduled.run_snapshots", AsyncMock()),
        patch("app.scheduled.run_outcomes", AsyncMock()),
        patch("app.scheduled.datetime") as clock,
    ):
        clock.now.return_value = MONDAY
        assert _arun(scheduled.run_command("daily")) == 0
    assert seen["calls"] == 1  # the inner command found the step busy and did nothing
    assert seen["inner"] == 0


def test_the_step_lock_is_released_after_a_normal_run_and_after_an_exception(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    _run_analysis()
    assert _arun(_lock_exists(scheduled.ANALYSIS_LOCK_KEY)) is False

    with (
        patch("app.scheduled.active_user_ids", side_effect=RuntimeError("boom")),
        pytest.raises(RuntimeError),
    ):
        _arun(scheduled.run_analysis(scheduled.Summary(), now=TUESDAY))
    assert _arun(_lock_exists(scheduled.ANALYSIS_LOCK_KEY)) is False


def test_the_command_lock_is_only_released_by_its_owner(env):
    async def fake_snapshots(summary):
        # the lock expired and another run took it while this one was still going
        await get_redis().set("scheduled:snapshots", "other-run")

    with patch("app.scheduled.run_snapshots", fake_snapshots):
        assert _arun(scheduled.run_command("snapshots")) == 0
    assert _arun(get_redis().get("scheduled:snapshots")) == "other-run"


def test_a_redis_error_on_release_is_logged_and_does_not_fail_the_run(env, caplog):
    class FlakyRedis:
        def __init__(self, real):
            self.real = real

        async def set(self, *args, **kwargs):
            return await self.real.set(*args, **kwargs)

        async def eval(self, *args, **kwargs):
            raise ConnectionError("secret-host")

    async def go():
        with (
            patch("app.scheduled.get_redis", return_value=FlakyRedis(get_redis())),
            patch("app.scheduled.run_snapshots", AsyncMock()),
        ):
            return await scheduled.run_command("snapshots")

    assert _arun(go()) == 0
    assert "lock release failed (ConnectionError)" in caplog.text
    assert "secret-host" not in caplog.text


def test_a_user_whose_run_hangs_is_cut_off_and_counted_as_failed(env, monkeypatch, caplog):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    monkeypatch.setattr(scheduled, "MAX_ANALYSIS_SECONDS", 0.3)
    monkeypatch.setattr(scheduled, "ANALYSIS_GRACE_SECONDS", 0)

    async def hang(*args, **kwargs):
        await asyncio.sleep(30)

    with patch("app.scheduled.run_job", hang):
        summary, _ = _run_analysis()
    assert (summary.analysis_runs, summary.analysis_failures) == (1, 1)
    assert _usage(USER_ID) == "1"
    assert f"Analysis user {USER_ID}: run raised TimeoutError" in caplog.text
    assert _arun(_lock_exists(scheduled.ANALYSIS_LOCK_KEY)) is False


def test_the_budget_counts_from_the_start_of_the_command(env, monkeypatch):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    monkeypatch.setattr(scheduled, "MAX_ANALYSIS_SECONDS", 0.2)

    async def slow_snapshots(summary):
        await asyncio.sleep(0.4)  # the earlier steps used the whole budget

    graph = AsyncMock(return_value=_state())
    with (
        patch("app.scheduled.run_snapshots", slow_snapshots),
        patch("app.scheduled.run_outcomes", AsyncMock()),
        patch("app.agents.jobs.run_graph_for_ticker", graph),
        patch("app.scheduled.datetime") as clock,
    ):
        clock.now.return_value = MONDAY
        assert _arun(scheduled.run_command("daily")) == 0
    graph.assert_not_awaited()


def test_a_run_that_started_long_ago_is_over_budget(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    summary = scheduled.Summary()
    long_ago = time.monotonic() - scheduled.MAX_ANALYSIS_SECONDS - 1
    with patch("app.agents.jobs.run_graph_for_ticker", AsyncMock()) as graph:
        _arun(scheduled.run_analysis(summary, now=MONDAY, started=long_ago))
    graph.assert_not_awaited()
    assert summary.analysis_skipped == 1


def test_the_worst_case_command_length_fits_inside_the_lock():
    assert (
        scheduled.MAX_ANALYSIS_SECONDS + scheduled.ANALYSIS_GRACE_SECONDS < scheduled.LOCK_SECONDS
    )


def test_a_second_run_on_the_same_day_charges_nobody_even_for_a_ticker_that_errored(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    failing = AsyncMock(side_effect=RuntimeError("boom"))  # no call is ever stored for AAPL
    first, _ = _run_analysis(graph=failing)
    assert (first.analysis_runs, first.analysis_failures) == (1, 1)

    second, graph = _run_analysis()
    graph.assert_not_awaited()
    assert (second.analysis_runs, second.analysis_skipped) == (0, 1)
    assert _usage(USER_ID) == "1"


def test_a_new_day_runs_again(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    failing = AsyncMock(side_effect=RuntimeError("boom"))
    _run_analysis(now=MONDAY, graph=failing)
    summary, graph = _run_analysis(now=TUESDAY, graph=failing)
    graph.assert_awaited()
    assert summary.analysis_runs == 1
    assert _usage(USER_ID) == "2"


def test_users_skipped_for_no_key_or_the_limit_keep_no_marker(env):
    _opted_in(env, USER_ID, key=False)
    _opted_in(env, OTHER_USER_ID)
    for uid in (USER_ID, OTHER_USER_ID):
        _holding(env, uid, "AAPL")
    env.query(AppUser).filter_by(id=OTHER_USER_ID).update({"monthly_analysis_limit": 1})
    env.commit()
    _arun(get_redis().set(_usage_key("analysis_run", str(OTHER_USER_ID)), 1))
    _run_analysis()
    assert _marker_exists(USER_ID) is False
    assert _marker_exists(OTHER_USER_ID) is False


def test_the_marker_is_set_for_a_user_who_ran_and_cleared_when_the_limit_race_is_lost(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    race = AsyncMock(side_effect=UsageLimitExceeded("analysis_run", 1))
    with patch("app.scheduled.check_and_increment_usage", race):
        _run_analysis()
    assert _marker_exists(USER_ID) is False

    _run_analysis()
    assert _marker_exists(USER_ID) is True


def test_a_usage_counter_error_clears_the_marker_and_counts_a_failure(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    broken = AsyncMock(side_effect=ConnectionError("redis down"))
    with patch("app.scheduled.check_and_increment_usage", broken):
        summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert summary.analysis_failures == 1
    assert _marker_exists(USER_ID) is False


def test_the_start_of_the_order_rotates_with_the_date_and_the_budget_cuts_the_tail(
    monkeypatch, caplog
):
    ids = [uuid.UUID(int=n + 1) for n in range(3)]
    order = []

    async def analyze(user_id, now, defaults, run_seconds):
        order.append(user_id)
        monkeypatch.setattr(scheduled, "MAX_ANALYSIS_SECONDS", -1)  # the budget runs out
        return "ran"

    k = MONDAY.date().toordinal() % 3
    summary = scheduled.Summary()
    with (
        caplog.at_level(logging.WARNING, logger="app.scheduled"),
        patch("app.scheduled.active_user_ids", return_value=ids),
        patch("app.scheduled._analyze_user", analyze),
        patch("app.scheduled.load_limit_defaults"),
        patch("app.scheduled.app_db.SessionLocal"),
    ):
        _arun(scheduled._analyze_all(summary, MONDAY, time.monotonic()))
    assert order == [ids[k]]  # the first user of the day goes first
    assert (summary.analysis_runs, summary.analysis_skipped) == (1, 2)
    assert "2 users not reached, budget used up" in caplog.text
    assert caplog.text.count("not reached") == 1


def test_every_user_gets_a_turn_at_the_front_over_consecutive_days(monkeypatch):
    ids = [uuid.UUID(int=n + 1) for n in range(3)]
    firsts = []

    async def analyze(user_id, now, defaults, run_seconds):
        firsts.append(user_id)
        monkeypatch.setattr(scheduled, "MAX_ANALYSIS_SECONDS", -1)
        return "ran"

    for day in range(3):
        monkeypatch.setattr(scheduled, "MAX_ANALYSIS_SECONDS", 2400)
        with (
            patch("app.scheduled.active_user_ids", return_value=ids),
            patch("app.scheduled._analyze_user", analyze),
            patch("app.scheduled.load_limit_defaults"),
            patch("app.scheduled.app_db.SessionLocal"),
        ):
            now = MONDAY + timedelta(days=day)
            _arun(scheduled._analyze_all(scheduled.Summary(), now, time.monotonic()))
    assert set(firsts) == set(ids)


def test_a_scheduled_run_never_touches_another_users_data(env):
    _opted_in(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)  # B has not opted in
    _holding(env, USER_ID, "AAPL")
    _holding(env, OTHER_USER_ID, "MSFT")
    env.add(WatchlistItem(user_id=OTHER_USER_ID, ticker="NVDA", asset_type="STOCK"))
    env.add(
        Recommendation(
            user_id=OTHER_USER_ID,
            ticker="MSFT",
            asset_type="STOCK",
            action="HOLD",
            reasoning=["theirs"],
            created_at=MONDAY.replace(tzinfo=None),
        )
    )
    env.commit()
    _, graph = _run_analysis()
    assert [(c.args[0], c.args[1]) for c in graph.await_args_list] == [(USER_ID, "AAPL")]
    theirs = _recs(env, OTHER_USER_ID)
    assert [(r.ticker, r.status, r.source) for r in theirs] == [("MSFT", "PENDING", "manual")]
    assert _usage(OTHER_USER_ID) is None
    assert _marker_exists(OTHER_USER_ID) is False


def test_the_weekend_logs_that_there_is_nothing_to_do(env, caplog):
    with caplog.at_level(logging.INFO, logger="app.scheduled"):
        _run_analysis(now=SATURDAY)
    assert "weekend, nothing to do" in caplog.text


def test_an_unhandled_ticker_error_is_logged_by_class_name_only(caplog):
    async def boom(*args, **kwargs):
        raise RuntimeError("secret-key-material")

    async def go():
        with patch("app.agents.jobs._process_ticker", boom):
            job_id = await create_job(USER_ID, [{"ticker": "AAPL"}])
            await run_job(job_id, USER_ID, [{"ticker": "AAPL"}])

    with caplog.at_level(logging.ERROR, logger="app.agents.jobs"):
        _arun(go())
    assert "Unhandled error in _process_ticker (RuntimeError)" in caplog.text
    assert "secret-key-material" not in caplog.text
    assert "Traceback" not in caplog.text
