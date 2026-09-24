from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

from app.config import settings
from app.models import BacktestResult


def _close_coro(coro):
    # Same reasoning as routers/analysis.py's tests: closing the coroutine
    # instead of letting asyncio.create_task actually schedule it avoids a
    # dangling task the test's event loop would otherwise tear down mid-run.
    coro.close()
    return MagicMock()


def test_run_backtest_returns_job_id(client):
    with (
        patch("app.routers.backtest.create_job", AsyncMock(return_value="job-123")),
        patch("app.routers.backtest.run_job", AsyncMock()),
        patch("app.routers.backtest.asyncio.create_task", side_effect=_close_coro),
    ):
        response = client.post(
            "/backtest/run",
            json={"ticker": "AAPL", "start_date": "2020-01-01", "end_date": "2024-01-01"},
        )

    assert response.status_code == 202
    assert response.json() == {"job_id": "job-123"}


def test_get_backtest_run_status_returns_404_for_unknown_job(client):
    with patch("app.routers.backtest.get_job_status", AsyncMock(return_value=None)):
        response = client.get("/backtest/run/unknown-job")
    assert response.status_code == 404


def test_get_backtest_run_status_returns_job_state(client):
    fake_status = {"status": "DONE", "backtest_result_id": 1}
    with patch("app.routers.backtest.get_job_status", AsyncMock(return_value=fake_status)):
        response = client.get("/backtest/run/job-123")
    assert response.status_code == 200
    assert response.json() == fake_status


def test_list_results_filters_by_ticker(client, db_session):
    result = BacktestResult(
        user_id=settings.default_user_id,
        ticker="AAPL",
        start_date=date(2020, 1, 1),
        end_date=date(2024, 1, 1),
        final_value=11000.0,
        buy_and_hold_value=10500.0,
        excess_return_pct=0.0476,
        hit_rate_by_signal={"OVERSOLD": {"count": 3.0, "avg_forward_return_pct": 0.02}},
        status="DONE",
    )
    db_session.add(result)
    db_session.commit()

    response = client.get("/backtest/results?ticker=AAPL")
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["ticker"] == "AAPL"

    response = client.get("/backtest/results?ticker=NOPE")
    assert response.json() == []
