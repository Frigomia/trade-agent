import asyncio
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import scheduled
from app.agents.research import search_budget_available
from app.config import settings
from app.discovery import jobs
from app.models import AppUser, InvestmentPreferences, Recommendation, ScanRun, UserApiKey
from app.redis_client import get_redis
from app.usage import UsageLimitExceeded, _usage_key, check_and_increment_usage, load_limit_defaults
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user
from tests.test_discovery_jobs import evaluation
from tests.test_scheduled import MONDAY, SATURDAY, _arun, _key_text, _usage
from tests.test_scheduled import _opted_in as _analysis_opted_in


def _opted_in(db, user_id, **kwargs):
    _analysis_opted_in(db, user_id, **kwargs)
    prefs = db.query(InvestmentPreferences).filter_by(user_id=user_id).one()
    prefs.auto_discovery = True
    prefs.auto_analysis = False  # discovery consent is independent of portfolio analysis
    db.commit()


@pytest.fixture
def env(session_local, app_session_local, monkeypatch):
    monkeypatch.setattr("app.db.SessionLocal", app_session_local)
    monkeypatch.setattr(scheduled.research, "search_budget_available", AsyncMock(return_value=True))
    monkeypatch.setattr(jobs, "evaluate_scan", AsyncMock(return_value=evaluation()))
    with session_local() as owner:
        yield owner


def run(now=MONDAY):
    summary = scheduled.Summary()
    _arun(scheduled.run_discovery(summary, now=now))
    return summary


def marker(user_id=USER_ID, now=MONDAY):
    return f"discovery:ran:{user_id}:{now.strftime('%Y-%m-%d')}"


def test_opted_in_empty_portfolio_gets_discovery_with_own_key(env):
    _opted_in(env, USER_ID)
    with patch.object(scheduled, "_get_client", side_effect=AssertionError("No server key")):
        summary = run()
    assert (summary.discovery_runs, summary.discovery_failures) == (1, 0)
    assert env.query(ScanRun).one().user_id == USER_ID
    assert env.query(Recommendation).one().source == "discovery"
    assert jobs.evaluate_scan.await_args.args[1].api_key == _key_text(USER_ID)
    assert _usage(USER_ID) == "1"


@pytest.mark.parametrize(
    "mode", ["off", "no_preferences", "no_key", "attention", "invited", "disabled", "weekend"]
)
def test_noneligible_users_are_never_charged(env, mode):
    if mode == "off":
        _analysis_opted_in(env, USER_ID)  # preferences and a usable key, but no discovery consent
    elif mode == "no_preferences":
        add_app_user(env, USER_ID)
    else:
        _opted_in(
            env,
            USER_ID,
            key=mode != "no_key",
            status=mode if mode in {"invited", "disabled"} else "active",
        )
        if mode == "attention":
            env.query(UserApiKey).one().status = "needs_attention"
            env.commit()
    summary = run(SATURDAY if mode == "weekend" else MONDAY)
    assert summary.discovery_runs == 0 and summary.discovery_failures == 0
    jobs.evaluate_scan.assert_not_awaited()
    assert _usage(USER_ID) is None
    assert _arun(get_redis().exists(marker())) == 0


def test_last_monthly_unit_stays_available_and_quota_race_is_rejected(env):
    _opted_in(env, USER_ID)
    env.get(AppUser, USER_ID).monthly_analysis_limit = 20
    env.commit()
    _arun(get_redis().set(_usage_key("analysis_run", str(USER_ID)), 18))

    async def racing_usage(kind, user_id, limit):
        assert limit == 19
        await check_and_increment_usage(kind, user_id, 20)  # a manual run takes unit 19
        await check_and_increment_usage(kind, user_id, limit)

    with patch.object(scheduled, "check_and_increment_usage", racing_usage):
        assert run().discovery_skipped == 1
    assert _usage(USER_ID) == "19"
    assert _arun(get_redis().exists(marker())) == 0
    jobs.evaluate_scan.assert_not_awaited()
    assert run().discovery_skipped == 1  # preflight also preserves the final unit
    assert _arun(get_redis().exists(marker())) == 0
    _arun(check_and_increment_usage("analysis_run", str(USER_ID), 20))
    assert _usage(USER_ID) == "20"  # holdings/manual analysis can still use it


@pytest.mark.parametrize("used, expected", [(160, 1), (161, 0), (199, 0)])
def test_full_scan_search_headroom_is_required_before_charging(env, monkeypatch, used, expected):
    _opted_in(env, USER_ID)
    monkeypatch.setattr(settings, "tavily_api_key", "test-tavily-key")
    monkeypatch.setattr(settings, "tavily_daily_search_limit", 200)
    monkeypatch.setattr(scheduled.research, "search_budget_available", search_budget_available)
    _arun(get_redis().set(scheduled.research._search_budget_key(), used))
    summary = run()
    assert summary.discovery_runs == expected
    assert jobs.evaluate_scan.await_count == expected
    assert _usage(USER_ID) == ("1" if expected else None)
    assert _arun(get_redis().exists(marker())) == expected
    assert _arun(get_redis().get(scheduled.research._search_budget_key())) == str(used)


def test_admin_fallback_is_explicit_and_not_a_saved_key(env):
    _opted_in(env, USER_ID, key=False, role="admin")
    server = MagicMock()
    with (
        patch.object(scheduled, "_get_client", return_value=server),
        patch.object(jobs, "run_job", AsyncMock()) as job,
        patch.object(jobs, "get_job_status", AsyncMock(return_value={"status": "DONE"})),
    ):
        assert run().discovery_runs == 1
    assert job.await_args.args[2] is server
    assert job.await_args.kwargs == {"uses_saved_key": False}


def test_admin_without_any_configured_client_is_skipped(env):
    _opted_in(env, USER_ID, key=False, role="admin")
    with patch.object(scheduled, "_get_client", return_value=None):
        assert run().discovery_skipped == 1
    assert _usage(USER_ID) is None


def test_monthly_limit_and_owner_budget_skip_without_day_claim_or_charge(env, monkeypatch):
    _opted_in(env, USER_ID)
    env.get(AppUser, USER_ID).monthly_analysis_limit = 0
    env.commit()
    assert run().discovery_skipped == 1
    assert _usage(USER_ID) is None
    env.get(AppUser, USER_ID).monthly_analysis_limit = 10
    env.commit()
    monkeypatch.setattr(
        scheduled.research, "search_budget_available", AsyncMock(return_value=False)
    )
    assert run().discovery_skipped == 1
    assert _usage(USER_ID) is None
    assert _arun(get_redis().exists(marker())) == 0
    jobs.evaluate_scan.assert_not_awaited()


def test_failed_automatic_attempt_is_not_charged_again_same_day(env):
    _opted_in(env, USER_ID)
    jobs.evaluate_scan.side_effect = RuntimeError("provider failed")
    assert run().discovery_failures == 1
    assert run().discovery_skipped == 1
    assert _usage(USER_ID) == "1"
    assert jobs.evaluate_scan.await_count == 1
    assert _arun(get_redis().ttl(marker())) > 0


@pytest.mark.parametrize("day_offset", [0, 1])
def test_only_completed_manual_scan_from_today_prevents_automatic_respend(env, day_offset):
    _opted_in(env, USER_ID)
    env.add(
        ScanRun(
            user_id=USER_ID,
            created_at=(MONDAY + timedelta(days=day_offset)).replace(tzinfo=None),
            status="completed",
            universe_size=600,
            eligible=0,
            shortlisted=0,
            researched=0,
            outcome="none",
            summary="Quiet",
            excluded=[],
            rejected_mentions=[],
            coverage_summary={},
        )
    )
    env.commit()
    summary = run()
    if day_offset == 0:
        assert summary.discovery_skipped == 1 and _usage(USER_ID) is None
        jobs.evaluate_scan.assert_not_awaited()
    else:
        assert summary.discovery_runs == 1 and _usage(USER_ID) == "1"


def test_manual_job_overlap_refunds_and_clears_only_automatic_marker(env):
    _opted_in(env, USER_ID)
    manual = _arun(jobs.create_job(USER_ID))
    assert run().discovery_skipped == 1
    assert _usage(USER_ID) == "0"
    assert _arun(get_redis().get(jobs._active_key(USER_ID))) == manual
    assert _arun(get_redis().exists(marker())) == 0
    jobs.evaluate_scan.assert_not_awaited()


def test_rejected_job_startup_refunds_and_logs_class_only(env, caplog):
    _opted_in(env, USER_ID)
    with patch.object(jobs, "create_job", AsyncMock(side_effect=OSError("private-token"))):
        assert run().discovery_failures == 1
    assert _usage(USER_ID) == "0"
    assert _arun(get_redis().exists(marker())) == 0
    assert "private-token" not in caplog.text


def test_quota_race_clears_day_marker_before_job_creation(env):
    _opted_in(env, USER_ID)
    with patch.object(
        scheduled,
        "check_and_increment_usage",
        AsyncMock(
            side_effect=UsageLimitExceeded("analysis_run", 1),
        ),
    ):
        assert run().discovery_skipped == 1
    assert _arun(get_redis().exists(marker())) == 0
    jobs.evaluate_scan.assert_not_awaited()


def test_counter_failure_retains_marker_to_avoid_ambiguous_double_charge(env):
    _opted_in(env, USER_ID)
    with patch.object(scheduled, "check_and_increment_usage", AsyncMock(side_effect=OSError())):
        assert run().discovery_failures == 1
    assert _arun(get_redis().exists(marker())) == 1
    jobs.evaluate_scan.assert_not_awaited()


def test_one_failed_user_does_not_stop_others_or_share_their_data(env):
    _opted_in(env, USER_ID)
    _opted_in(env, OTHER_USER_ID)

    async def evaluate(user_id, client, progress):
        if user_id == USER_ID:
            raise RuntimeError("provider failure")
        return evaluation()

    jobs.evaluate_scan.side_effect = evaluate
    summary = run()
    assert (summary.discovery_runs, summary.discovery_failures) == (2, 1)
    assert [rec.user_id for rec in env.query(Recommendation)] == [OTHER_USER_ID]
    assert _usage(USER_ID) == _usage(OTHER_USER_ID) == "1"


def test_removed_account_mid_scan_saves_nothing(env):
    _opted_in(env, USER_ID)

    async def evaluate(*args):
        env.get(AppUser, USER_ID).status = "disabled"
        env.commit()
        return evaluation()

    jobs.evaluate_scan.side_effect = evaluate
    assert run().discovery_skipped == 1
    assert env.query(ScanRun).count() == env.query(Recommendation).count() == 0


def test_time_budget_skips_unreached_users_and_rotates_order(env, monkeypatch):
    _opted_in(env, USER_ID)
    _opted_in(env, OTHER_USER_ID)
    seen = []

    async def user(user_id, now, defaults, seconds):
        seen.append(user_id)
        return "ran"

    monkeypatch.setattr(scheduled, "_discover_user", user)
    monkeypatch.setattr(scheduled, "active_user_ids", lambda: [USER_ID, OTHER_USER_ID])
    for now in (MONDAY, MONDAY + timedelta(days=1)):
        clock = iter([100.0, 100.0 + scheduled.MAX_DISCOVERY_SECONDS + 1])
        with patch.object(scheduled, "time", SimpleNamespace(monotonic=clock.__next__)):
            summary = scheduled.Summary()
            _arun(scheduled.run_discovery(summary, now=now, started=100.0))
        assert (summary.discovery_runs, summary.discovery_skipped) == (1, 1)
    assert seen[0] != seen[1]


def test_cutoff_cancels_provider_work_and_releases_active_marker(env):
    _opted_in(env, USER_ID)

    async def slow(*args):
        await asyncio.Event().wait()

    jobs.evaluate_scan.side_effect = slow
    defaults = load_limit_defaults(env, settings)
    assert _arun(scheduled._discover_user(USER_ID, MONDAY, defaults, 0.02)) == "failed"
    assert _arun(get_redis().get(jobs._active_key(USER_ID))) is None
    assert _arun(get_redis().exists(marker())) == 1
    assert env.query(ScanRun).count() == 0


@pytest.mark.parametrize("result", [[], None])
def test_mentions_command_uses_existing_owner_batch_and_reports_unavailable(
    env, monkeypatch, result
):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-owner-key")
    monkeypatch.setattr(settings, "tavily_api_key", "test-tavily-key")
    discover = AsyncMock(return_value=result)
    monkeypatch.setattr(scheduled.research, "discover_mentions", discover)
    assert _arun(scheduled.run_command("discovery_mentions")) == (1 if result is None else 0)
    discover.assert_awaited_once_with()
    jobs.evaluate_scan.assert_not_awaited()


def test_mentions_unconfigured_is_a_noop_without_paid_calls(env, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    discover = AsyncMock()
    monkeypatch.setattr(scheduled.research, "discover_mentions", discover)
    assert _arun(scheduled.run_command("discovery_mentions")) == 0
    discover.assert_not_awaited()


def test_discovery_command_dispatches_only_scans_and_releases_global_lock(env):
    with (
        patch.object(scheduled, "run_discovery", AsyncMock()) as discovery,
        patch.object(scheduled, "run_analysis", AsyncMock()) as analysis,
        patch.object(scheduled, "run_notify", AsyncMock()) as notify,
    ):
        assert _arun(scheduled.run_command("discovery")) == 0
    discovery.assert_awaited_once()
    analysis.assert_not_awaited()
    notify.assert_not_awaited()
    assert _arun(get_redis().get("scheduled:discovery")) is None


def test_held_discovery_command_lock_does_no_work(env):
    _arun(get_redis().set("scheduled:discovery", "someone-else", ex=3600))
    with patch.object(scheduled, "run_discovery", AsyncMock()) as discovery:
        assert _arun(scheduled.run_command("discovery")) == 0
    discovery.assert_not_awaited()


def test_discovery_failure_changes_command_exit_code(env):
    async def failed(summary, **kwargs):
        summary.discovery_failures += 1

    with patch.object(scheduled, "run_discovery", failed):
        assert _arun(scheduled.run_command("discovery")) == 1
