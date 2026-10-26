import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agents import jobs as holdings_jobs
from app.discovery import company_jobs, jobs
from app.discovery.company import PreparedCompany
from app.models import CompanyAnalysis, Recommendation, ScanRun, WatchlistItem
from app.redis_client import get_redis
from app.usage import UsageLimitExceeded, get_usage, refund_company_usage, reserve_company_usage
from tests.auth_support import OTHER_USER_ID, USER_ID
from tests.discovery_fixtures import sample_candidate, sample_exposure, sample_idea
from tests.test_discover import idea, seed


@pytest.fixture
def setup_company(monkeypatch, db_session, app_session_local, client):
    seed(db_session, "SAP.DE", name="SAP", currency="EUR")
    monkeypatch.setattr("app.db.SessionLocal", app_session_local)
    candidate = sample_candidate().model_copy(update={"ticker": "SAP.DE"})
    prepared = PreparedCompany(candidate, "a" * 64, "")
    monkeypatch.setattr(company_jobs, "prepare_company", AsyncMock(return_value=prepared))
    monkeypatch.setattr(company_jobs, "_user_inputs", lambda uid: ([], []))
    monkeypatch.setattr(
        company_jobs, "load_fit_context", AsyncMock(return_value=(sample_exposure(), {}))
    )
    result = sample_idea().model_copy(update={"ticker": "SAP.DE"})
    monkeypatch.setattr(company_jobs, "evaluate_candidate", AsyncMock(return_value=result))
    tasks = []
    monkeypatch.setattr(company_jobs, "_track", tasks.append)
    return prepared, tasks


def test_completed_research_costs_once_and_persists_without_changing_scan_or_other_ideas(
    setup_company, db_session
):
    _, tasks = setup_company
    other_id = idea(db_session, "OTHER")

    async def scenario():
        out = await company_jobs.start_company(USER_ID, "SAP.DE", MagicMock(), 100, True)
        await asyncio.gather(*tasks)
        assert await get_usage("analysis_run", str(USER_ID)) == 1
        await get_redis().delete(jobs._job_key(out.job_id))
        state = await company_jobs.company_state(USER_ID, "SAP.DE")
        assert state.status == "report" and state.researched and state.charge_state == "charged"
        again = await company_jobs.start_company(USER_ID, "SAP.DE", MagicMock(), 100, True)
        assert again.job_id == out.job_id
        assert await get_usage("analysis_run", str(USER_ID)) == 1
        assert await company_jobs.company_state(OTHER_USER_ID, "SAP.DE") is None

    asyncio.run(scenario())
    assert db_session.query(ScanRun).count() == 0
    db_session.expire_all()
    assert db_session.get(Recommendation, other_id).status == "PENDING"
    assert db_session.query(CompanyAnalysis).count() == 1


def test_researched_non_opportunity_is_durable_without_a_fake_buy(
    setup_company, monkeypatch, db_session
):
    _, tasks = setup_company
    result = sample_idea().model_copy(update={"ticker": "SAP.DE", "confidence": "low"})
    monkeypatch.setattr(company_jobs, "evaluate_candidate", AsyncMock(return_value=result))

    async def scenario():
        await company_jobs.start_company(USER_ID, "SAP.DE", MagicMock(), 100, True)
        await asyncio.gather(*tasks)
        state = await company_jobs.company_state(USER_ID, "SAP.DE")
        assert state.status == "no_opportunity" and state.researched
        assert state.report_id is None and not state.can_analyze
        assert await get_usage("analysis_run", str(USER_ID)) == 1

    asyncio.run(scenario())
    assert db_session.query(Recommendation).count() == 0


def test_unchanged_eligibility_refusal_does_not_charge_or_repeat_research(
    setup_company, monkeypatch, db_session
):
    monkeypatch.setattr(
        company_jobs,
        "prepare_company",
        AsyncMock(return_value=PreparedCompany(None, "b" * 64, "Missing fundamentals.")),
    )

    async def scenario():
        first = await company_jobs.start_company(USER_ID, "SAP.DE", MagicMock(), 100, True)
        again = await company_jobs.start_company(USER_ID, "SAP.DE", MagicMock(), 100, True)
        assert first.status == "ineligible" and not first.researched
        assert first.job_id == again.job_id
        assert await get_usage("analysis_run", str(USER_ID)) == 0

    asyncio.run(scenario())
    company_jobs.evaluate_candidate.assert_not_awaited()
    assert db_session.query(CompanyAnalysis).count() == 1


@pytest.mark.parametrize(
    "failure", [RuntimeError("secret"), TimeoutError(), asyncio.CancelledError()]
)
def test_failed_research_refunds_exactly_once_and_does_not_leak_errors(
    setup_company, monkeypatch, failure
):
    _, tasks = setup_company
    monkeypatch.setattr(company_jobs, "evaluate_candidate", AsyncMock(side_effect=failure))

    async def scenario():
        await company_jobs.start_company(USER_ID, "SAP.DE", MagicMock(), 100, True)
        await asyncio.gather(*tasks, return_exceptions=True)
        for _ in range(2):
            state = await company_jobs.company_state(USER_ID, "SAP.DE")
            assert (
                state.status == "failed" and state.charge_state == "refunded" and state.can_analyze
            )
            assert "secret" not in state.reason
        assert await get_usage("analysis_run", str(USER_ID)) == 0
        assert await get_redis().get(jobs._active_key(USER_ID)) is None

    asyncio.run(scenario())


def test_holdings_and_discovery_claims_block_company_work_without_quota(setup_company):
    async def scenario():
        marker = await holdings_jobs.create_job(USER_ID, [])
        with pytest.raises(jobs.DiscoveryAlreadyRunning):
            await company_jobs.start_company(USER_ID, "SAP.DE", MagicMock(), 100, True)
        with pytest.raises(jobs.DiscoveryAlreadyRunning):
            await jobs.create_job(USER_ID)
        assert await get_usage("analysis_run", str(USER_ID)) == 0
        assert await get_redis().get(jobs._active_key(USER_ID)) == marker

    asyncio.run(scenario())


def test_duplicate_that_claims_after_first_completion_reuses_the_result(setup_company, monkeypatch):
    _, tasks = setup_company
    original_create = company_jobs._claim_company
    original_state = company_jobs.company_state
    calls = 0

    async def initial_stale_read(uid, ticker):
        nonlocal calls
        calls += 1
        if calls == 1:
            return None
        return await original_state(uid, ticker)

    async def finish_before_claim(uid):
        monkeypatch.setattr(company_jobs, "company_state", original_state)
        await company_jobs.start_company(USER_ID, "SAP.DE", MagicMock(), 100, True)
        await asyncio.gather(*tasks)
        monkeypatch.setattr(company_jobs, "company_state", initial_stale_read)
        return await original_create(uid)

    async def scenario():
        monkeypatch.setattr(company_jobs, "company_state", initial_stale_read)

        async def one_delayed_claim(uid):
            monkeypatch.setattr(company_jobs, "_claim_company", original_create)
            return await finish_before_claim(uid)

        monkeypatch.setattr(company_jobs, "_claim_company", one_delayed_claim)
        out = await company_jobs.start_company(USER_ID, "SAP.DE", MagicMock(), 100, True)
        assert out.status == "report"
        assert await get_usage("analysis_run", str(USER_ID)) == 1

    asyncio.run(scenario())


def test_refund_uses_original_month_and_cannot_decrement_twice():
    async def scenario():
        redis = get_redis()
        old = f"usage:analysis_run:{USER_ID}:2000-01"
        new = f"usage:analysis_run:{USER_ID}:2000-02"
        await redis.delete("company_usage:month-test", old, new)
        await redis.set(jobs._active_key(USER_ID), "month-test", ex=1200)
        await reserve_company_usage("month-test", old, 100, jobs._active_key(USER_ID))
        await redis.set(new, 5)
        await refund_company_usage("month-test", old)
        await refund_company_usage("month-test", old)
        assert await redis.get(old) == "0" and await redis.get(new) == "5"

    asyncio.run(scenario())


def test_exhausted_quota_never_launches_research(setup_company):
    async def scenario():
        with pytest.raises(UsageLimitExceeded):
            await company_jobs.start_company(USER_ID, "SAP.DE", MagicMock(), 0, True)
        assert await get_usage("analysis_run", str(USER_ID)) == 0

    asyncio.run(scenario())
    company_jobs.evaluate_candidate.assert_not_awaited()


def test_lost_preflight_claim_never_charges_or_launches(setup_company, monkeypatch):
    prepared, _ = setup_company

    async def expired(uid, ticker):
        await get_redis().delete(jobs._active_key(uid))
        return prepared

    monkeypatch.setattr(company_jobs, "prepare_company", expired)

    async def scenario():
        with pytest.raises(company_jobs.CompanyUnavailable):
            await company_jobs.start_company(USER_ID, "SAP.DE", MagicMock(), 100, True)
        assert await get_usage("analysis_run", str(USER_ID)) == 0

    asyncio.run(scenario())
    company_jobs.evaluate_candidate.assert_not_awaited()


def test_recovering_an_old_attempt_never_fails_its_replacement(
    setup_company, monkeypatch, db_session
):
    prepared, _ = setup_company
    original_latest = company_jobs._latest

    async def scenario():
        old = await asyncio.to_thread(company_jobs._insert, USER_ID, "SAP.DE", "old", prepared)
        await asyncio.to_thread(company_jobs._insert, USER_ID, "SAP.DE", "replacement", prepared)
        await get_redis().set(jobs._active_key(USER_ID), "replacement", ex=1200)
        calls = 0

        def stale_first_read(*args):
            nonlocal calls
            calls += 1
            return old if calls == 1 else original_latest(*args)

        monkeypatch.setattr(company_jobs, "_latest", stale_first_read)
        state = await company_jobs.company_state(USER_ID, "SAP.DE")
        assert state.job_id == "replacement" and state.status == "running"

    asyncio.run(scenario())
    rows = {r.job_id: r for r in db_session.query(CompanyAnalysis)}
    assert rows["old"].status == "failed"
    assert rows["replacement"].status == "running"


def test_persistence_failure_refunds_and_removed_company_polling_is_private(
    setup_company, monkeypatch, db_session, client
):
    _, tasks = setup_company
    monkeypatch.setattr(company_jobs, "_save_result", MagicMock(side_effect=RuntimeError("secret")))

    async def scenario():
        out = await company_jobs.start_company(USER_ID, "SAP.DE", MagicMock(), 100, True)
        await asyncio.gather(*tasks)
        state = await company_jobs.company_state(USER_ID, "SAP.DE")
        assert state.status == "failed" and state.charge_state == "refunded"
        assert await get_usage("analysis_run", str(USER_ID)) == 0
        return out.job_id

    job_id = asyncio.run(scenario())
    db_session.query(WatchlistItem).filter_by(user_id=USER_ID).delete()
    db_session.commit()
    import app.redis_client as redis_module

    redis_module._redis = None
    assert client.get(f"/discovery/run/{job_id}").status_code == 404
