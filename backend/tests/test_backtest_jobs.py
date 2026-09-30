import asyncio
from datetime import date
from unittest.mock import AsyncMock, patch

from app.backtest.engine import BacktestMetrics
from app.backtest.jobs import create_job, get_job_status, run_job
from app.models import BacktestResult
from tests.auth_support import OTHER_USER_ID, USER_ID


def test_backtest_job_completes_and_persists_result(session_local, app_session_local):
    fake_metrics = BacktestMetrics(
        final_value=11000.0,
        buy_and_hold_value=10500.0,
        excess_return_pct=0.0476,
        hit_rate_by_signal={"OVERSOLD": {"count": 3.0, "avg_forward_return_pct": 0.02}},
        equity_curve={"strategy": [10000.0, 11000.0], "buy_and_hold": [10000.0, 10500.0]},
    )

    async def _run() -> None:
        job_id = await create_job(OTHER_USER_ID, "AAPL", date(2020, 1, 1), date(2024, 1, 1))

        status = await get_job_status(job_id, OTHER_USER_ID)
        assert status == {"status": "RUNNING", "backtest_result_id": None}

        with (
            patch(
                "app.backtest.jobs.fetch_price_history",
                AsyncMock(return_value=[100.0] * 300),
            ),
            patch("app.backtest.jobs.simulate", return_value=fake_metrics),
            patch("app.db.SessionLocal", app_session_local),
        ):
            await run_job(job_id, OTHER_USER_ID, "AAPL", date(2020, 1, 1), date(2024, 1, 1))

        final = await get_job_status(job_id, OTHER_USER_ID)
        assert final is not None
        assert final["status"] == "DONE"
        assert final["backtest_result_id"] is not None

        owner = session_local()
        try:
            saved = owner.get(BacktestResult, final["backtest_result_id"])
            assert saved is not None
            assert saved.user_id == OTHER_USER_ID
            assert saved.equity_curve == {
                "strategy": [10000.0, 11000.0],
                "buy_and_hold": [10000.0, 10500.0],
            }
        finally:
            owner.close()

    asyncio.run(_run())


def test_backtest_job_marks_failed_on_error():
    async def _run() -> None:
        job_id = await create_job(USER_ID, "NOPE", date(2020, 1, 1), date(2024, 1, 1))

        with patch(
            "app.backtest.jobs.fetch_price_history",
            AsyncMock(side_effect=RuntimeError("boom")),
        ):
            await run_job(job_id, USER_ID, "NOPE", date(2020, 1, 1), date(2024, 1, 1))

        final = await get_job_status(job_id, USER_ID)
        assert final == {"status": "FAILED", "backtest_result_id": None}

    asyncio.run(_run())


def test_get_job_status_returns_none_for_unknown_job():
    result = asyncio.run(get_job_status("does-not-exist", USER_ID))
    assert result is None


def test_backtest_job_status_hides_other_users_jobs():
    async def _run() -> None:
        job_id = await create_job(USER_ID, "AAPL", date(2020, 1, 1), date(2024, 1, 1))
        assert await get_job_status(job_id, USER_ID) is not None
        assert await get_job_status(job_id, OTHER_USER_ID) is None

    asyncio.run(_run())
