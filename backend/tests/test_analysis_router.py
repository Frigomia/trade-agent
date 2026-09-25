from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

from app.config import settings
from app.models import Holding, Recommendation


def test_run_analysis_with_no_tickers_uses_holdings(client, db_session):
    holding = Holding(
        user_id=settings.default_user_id,
        ticker="AAPL",
        name="Apple",
        asset_type="STOCK",
        shares=5,
        cost_basis=150.0,
        first_purchase_date=date(2024, 1, 1),
    )
    db_session.add(holding)
    db_session.commit()

    def _close_coro(coro):
        # asyncio.create_task(run_job(...)) with run_job mocked would otherwise
        # leave a dangling task the test's event loop tears down before it
        # finishes, risking a "Task was destroyed but it is pending" warning.
        # Closing the coroutine instead keeps the test's output pristine.
        coro.close()
        return MagicMock()  # stands in for the Task; add_done_callback is a no-op

    with (
        patch("app.routers.analysis.create_job", AsyncMock(return_value="job-123")),
        patch("app.routers.analysis.run_job", AsyncMock()),
        patch("app.routers.analysis.asyncio.create_task", side_effect=_close_coro),
    ):
        response = client.post("/analysis/run", json={})

    assert response.status_code == 202
    assert response.json() == {"job_id": "job-123"}


def test_run_analysis_rejects_unknown_ticker(client):
    response = client.post("/analysis/run", json={"tickers": ["NOPE"]})
    assert response.status_code == 404


def test_get_run_status_returns_404_for_unknown_job(client):
    with patch("app.routers.analysis.get_job_status", AsyncMock(return_value=None)):
        response = client.get("/analysis/run/unknown-job")
    assert response.status_code == 404


def test_get_run_status_returns_job_state(client):
    fake_status = {"status": "DONE", "total": 1, "done": 1, "results": []}
    with patch("app.routers.analysis.get_job_status", AsyncMock(return_value=fake_status)):
        response = client.get("/analysis/run/job-123")
    assert response.status_code == 200
    assert response.json() == fake_status


def test_list_and_approve_recommendation(client, db_session):
    rec = Recommendation(
        user_id=settings.default_user_id,
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.1"],
        status="PENDING",
    )
    db_session.add(rec)
    db_session.commit()
    db_session.refresh(rec)

    response = client.get("/analysis/recommendations?status=PENDING")
    assert response.status_code == 200
    assert len(response.json()) == 1

    response = client.post(f"/analysis/recommendations/{rec.id}/approve")
    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"

    response = client.get("/analysis/recommendations?status=PENDING")
    assert response.json() == []


def test_approve_missing_recommendation_returns_404(client):
    response = client.post("/analysis/recommendations/999/approve")
    assert response.status_code == 404


def test_run_analysis_rate_limited_after_5_calls_per_minute(client):
    def _close_coro(coro):
        coro.close()
        return MagicMock()

    with (
        patch("app.routers.analysis.create_job", AsyncMock(return_value="job-123")),
        patch("app.routers.analysis.run_job", AsyncMock()),
        patch("app.routers.analysis.asyncio.create_task", side_effect=_close_coro),
    ):
        for _ in range(5):
            response = client.post("/analysis/run", json={})
            assert response.status_code == 202

        response = client.post("/analysis/run", json={})

    assert response.status_code == 429
