import asyncio
import threading
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agents.research import ResearchKeyRejected
from app.claude_keys import encrypt_key
from app.discovery import jobs
from app.discovery.runner import ScanEvaluation, SnapshotUnavailable
from app.models import AppUser, Recommendation, ScanRun, UserApiKey
from app.redis_client import get_redis
from app.usage import check_and_increment_usage, get_usage
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user
from tests.discovery_fixtures import sample_idea


def evaluation(ideas=None):
    return ScanEvaluation(
        ideas=ideas if ideas is not None else [sample_idea()],
        excluded=[],
        rejected_mentions=[],
        universe_size=600,
        eligible=20,
        shortlisted=1,
        researched=1,
        coverage_summary={},
    )


def test_singleflight_is_atomic_and_status_is_private():
    async def scenario():
        outcomes = await asyncio.gather(
            jobs.create_job(USER_ID),
            jobs.create_job(USER_ID),
            return_exceptions=True,
        )
        winners = [outcome for outcome in outcomes if isinstance(outcome, str)]
        assert len(winners) == 1
        assert sum(isinstance(outcome, jobs.DiscoveryAlreadyRunning) for outcome in outcomes) == 1
        job_id = winners[0]
        assert await jobs.get_job_status(job_id, OTHER_USER_ID) is None
        assert await jobs.get_job_status("missing", USER_ID) is None
        state = await jobs.get_job_status(job_id, USER_ID)
        assert state["status"] == "RUNNING" and state["stage"] == "screening"
        assert 0 < await get_redis().ttl(jobs._active_key(USER_ID)) <= jobs.ACTIVE_TTL_SECONDS
        assert jobs.ACTIVE_TTL_SECONDS == jobs.SCAN_TIMEOUT_SECONDS + 300
        assert 0 < await get_redis().ttl(jobs._job_key(job_id)) <= jobs.JOB_TTL_SECONDS

    asyncio.run(scenario())


def test_job_persists_results_and_releases_marker(db_session, app_session_local):
    add_app_user(db_session)

    async def scenario():
        client = MagicMock()
        job_id = await jobs.create_job(USER_ID)
        with (
            patch.object(jobs, "evaluate_scan", AsyncMock(return_value=evaluation())) as run,
            patch("app.db.SessionLocal", app_session_local),
        ):
            await jobs.run_job(job_id, USER_ID, client)
        run.assert_awaited_once()
        assert run.await_args.args[:2] == (USER_ID, client)
        state = await jobs.get_job_status(job_id, USER_ID)
        assert state["status"] == "DONE" and state["stage"] == "completed"
        assert state["scan"]["outcome"] == "ideas" and len(state["results"]) == 1
        assert await get_redis().get(jobs._active_key(USER_ID)) is None

    asyncio.run(scenario())
    assert db_session.query(ScanRun).count() == 1
    assert db_session.query(Recommendation).count() == 1


@pytest.mark.parametrize("error", [SnapshotUnavailable(), RuntimeError("api-key-secret")])
def test_failure_is_disclosed_without_exception_text_and_releases_marker(
    monkeypatch, error, caplog
):
    monkeypatch.setattr(jobs, "evaluate_scan", AsyncMock(side_effect=error))
    saved = MagicMock()
    monkeypatch.setattr(jobs, "save_scan", saved)

    async def scenario():
        job_id = await jobs.create_job(USER_ID)
        await jobs.run_job(job_id, USER_ID, MagicMock())
        state = await jobs.get_job_status(job_id, USER_ID)
        assert state["status"] == "FAILED" and state["results"] == []
        assert "api-key-secret" not in str(state)
        assert await get_redis().get(jobs._active_key(USER_ID)) is None
        assert await jobs.create_job(USER_ID) != job_id

    asyncio.run(scenario())
    assert "api-key-secret" not in caplog.text
    saved.assert_not_called()


def test_timeout_cancels_provider_work_before_persistence(monkeypatch):
    async def slow(*args):
        await asyncio.Event().wait()

    monkeypatch.setattr(jobs, "evaluate_scan", slow)
    monkeypatch.setattr(jobs, "SCAN_TIMEOUT_SECONDS", 0.01)
    saved = MagicMock()
    monkeypatch.setattr(jobs, "save_scan", saved)

    async def scenario():
        job_id = await jobs.create_job(USER_ID)
        await jobs.run_job(job_id, USER_ID, MagicMock())
        assert (await jobs.get_job_status(job_id, USER_ID))["status"] == "FAILED"
        assert await get_redis().get(jobs._active_key(USER_ID)) is None

    asyncio.run(scenario())
    saved.assert_not_called()


def test_old_job_cannot_release_a_new_jobs_marker(monkeypatch):
    monkeypatch.setattr(jobs, "evaluate_scan", AsyncMock(side_effect=RuntimeError()))

    async def scenario():
        job_id = await jobs.create_job(USER_ID)
        await get_redis().set(jobs._active_key(USER_ID), "new-job", ex=jobs.JOB_TTL_SECONDS)
        await jobs.run_job(job_id, USER_ID, MagicMock())
        assert await get_redis().get(jobs._active_key(USER_ID)) == "new-job"

    asyncio.run(scenario())


def test_disabled_account_saves_nothing(db_session, app_session_local, monkeypatch):
    add_app_user(db_session, status="disabled")
    monkeypatch.setattr(jobs, "evaluate_scan", AsyncMock(return_value=evaluation()))

    async def scenario():
        job_id = await jobs.create_job(USER_ID)
        with patch("app.db.SessionLocal", app_session_local):
            await jobs.run_job(job_id, USER_ID, MagicMock())
        assert (await jobs.get_job_status(job_id, USER_ID))["status"] == "FAILED"

    asyncio.run(scenario())
    assert db_session.query(ScanRun).count() == 0
    assert db_session.query(Recommendation).count() == 0


def test_shutdown_records_committed_scan_and_renews_marker(
    db_session,
    app_session_local,
    monkeypatch,
):
    add_app_user(db_session)
    entered, finish = threading.Event(), threading.Event()
    monkeypatch.setattr(jobs, "evaluate_scan", AsyncMock(return_value=evaluation()))
    original_save = jobs.save_scan
    monkeypatch.setattr("app.db.SessionLocal", app_session_local)

    def save(*args, **kwargs):
        entered.set()
        assert finish.wait(timeout=5)
        return original_save(*args, **kwargs)

    monkeypatch.setattr(jobs, "save_scan", save)

    async def scenario():
        job_id = await jobs.create_job(USER_ID)
        await get_redis().expire(jobs._active_key(USER_ID), 1)
        task = asyncio.create_task(jobs.run_job(job_id, USER_ID, MagicMock()))
        try:
            assert await asyncio.to_thread(entered.wait, 5)
            assert await get_redis().ttl(jobs._active_key(USER_ID)) > 1
            task.cancel()
            await asyncio.sleep(0)
            assert await get_redis().get(jobs._active_key(USER_ID)) == job_id
        finally:
            finish.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert await get_redis().get(jobs._active_key(USER_ID)) is None
        state = await jobs.get_job_status(job_id, USER_ID)
        assert state["status"] == "DONE" and state["scan"]["outcome"] == "ideas"

    asyncio.run(scenario())
    assert db_session.query(ScanRun).count() == 1


def test_missing_snapshot_refunds_usage_before_any_paid_work(monkeypatch):
    monkeypatch.setattr(jobs, "evaluate_scan", AsyncMock(side_effect=SnapshotUnavailable()))

    async def scenario():
        await check_and_increment_usage("analysis_run", str(USER_ID), 10)
        job_id = await jobs.create_job(USER_ID)
        await jobs.run_job(job_id, USER_ID, MagicMock())
        assert await get_usage("analysis_run", str(USER_ID)) == 0
        assert (await jobs.get_job_status(job_id, USER_ID))["status"] == "FAILED"

    asyncio.run(scenario())


@pytest.mark.parametrize("credential", ["saved", "replacement", "server"])
def test_rejected_key_flags_only_the_matching_saved_credential(
    client,
    db_session,
    app_session_local,
    monkeypatch,
    credential,
):
    user_client = MagicMock(api_key="sk-ant-test-key-0000")
    if credential == "replacement":
        db_session.query(UserApiKey).one().ciphertext = encrypt_key(USER_ID, "sk-ant-new-key-1111")
        db_session.commit()
    failure = ExceptionGroup("candidate work", [ResearchKeyRejected("private-token")])
    monkeypatch.setattr(jobs, "evaluate_scan", AsyncMock(side_effect=failure))
    monkeypatch.setattr("app.db.SessionLocal", app_session_local)

    async def scenario():
        job_id = await jobs.create_job(USER_ID)
        await jobs.run_job(job_id, USER_ID, user_client, uses_saved_key=credential != "server")
        state = await jobs.get_job_status(job_id, USER_ID)
        assert state["status"] == "FAILED" and state["error"] == "Your Claude key needs attention."
        assert await get_redis().get(jobs._active_key(USER_ID)) is None

    # Use the request portal because this fixture already created a loop-bound Redis client.
    client.portal.call(scenario)
    db_session.expire_all()
    expected = "needs_attention" if credential == "saved" else "ok"
    assert db_session.query(UserApiKey).one().status == expected
    assert db_session.get(AppUser, USER_ID).claude_key_state == expected
    assert db_session.query(ScanRun).count() == 0


def test_lost_marker_prevents_database_write_and_old_progress_is_failed(monkeypatch):
    saved = MagicMock()
    monkeypatch.setattr(jobs, "save_scan", saved)
    monkeypatch.setattr(jobs, "evaluate_scan", AsyncMock(return_value=evaluation()))

    async def scenario():
        job_id = await jobs.create_job(USER_ID)
        await get_redis().delete(jobs._active_key(USER_ID))
        assert (await jobs.get_job_status(job_id, USER_ID))["status"] == "FAILED"
        await jobs.run_job(job_id, USER_ID, MagicMock())
        assert (await jobs.get_job_status(job_id, USER_ID))["status"] == "FAILED"

    asyncio.run(scenario())
    saved.assert_not_called()
