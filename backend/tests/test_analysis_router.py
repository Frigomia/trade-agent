from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

from app.models import Holding, Recommendation
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user, auth_headers


def test_run_analysis_with_no_tickers_uses_holdings(client, db_session):
    holding = Holding(
        user_id=USER_ID,
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
        user_id=USER_ID,
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


def _rec(user_id, ticker="AAPL"):
    return Recommendation(
        user_id=user_id,
        ticker=ticker,
        asset_type="STOCK",
        action="BUY",
        reasoning=["theirs"],
        status="PENDING",
    )


def _close_coro(coro):
    coro.close()
    return MagicMock()


def test_analysis_requires_authentication(anon_client):
    assert anon_client.get("/analysis/recommendations").status_code == 401


def test_analysis_run_requires_authentication_before_rate_limit(anon_client):
    for _ in range(6):
        assert anon_client.post("/analysis/run", json={}).status_code == 401


def test_job_status_is_looked_up_for_the_caller(client):
    fake_status = {"status": "DONE", "total": 1, "done": 1, "results": []}
    with patch(
        "app.routers.analysis.get_job_status", AsyncMock(return_value=fake_status)
    ) as mock_status:
        client.get("/analysis/run/job-123")
    mock_status.assert_awaited_once_with("job-123", USER_ID)


def test_recommendations_exclude_other_users(client, db_session):
    db_session.add(_rec(OTHER_USER_ID))
    db_session.commit()

    assert client.get("/analysis/recommendations").json() == []


def test_cannot_approve_another_users_recommendation(client, db_session):
    rec = _rec(OTHER_USER_ID)
    db_session.add(rec)
    db_session.commit()
    db_session.refresh(rec)

    assert client.post(f"/analysis/recommendations/{rec.id}/approve").status_code == 404


def test_run_analysis_builds_the_job_for_the_token_user(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    db_session.add_all(
        [
            Holding(
                user_id=USER_ID,
                ticker="AAPL",
                name="Apple",
                asset_type="STOCK",
                shares=5,
                cost_basis=150.0,
                first_purchase_date=date(2024, 1, 1),
            ),
            Holding(
                user_id=OTHER_USER_ID,
                ticker="MSFT",
                name="Microsoft",
                asset_type="STOCK",
                shares=2,
                cost_basis=300.0,
                first_purchase_date=date(2024, 1, 1),
            ),
        ]
    )
    db_session.commit()

    with (
        patch("app.routers.analysis.create_job", AsyncMock(return_value="job-123")) as mock_create,
        patch("app.routers.analysis.run_job", AsyncMock()) as mock_run,
        patch("app.routers.analysis.asyncio.create_task", side_effect=_close_coro),
    ):
        response = client.post("/analysis/run", json={}, headers=auth_headers(OTHER_USER_ID))

    assert response.status_code == 202
    infos = [{"ticker": "MSFT", "asset_type": "STOCK", "is_held": True}]
    mock_create.assert_awaited_once_with(OTHER_USER_ID, infos)
    mock_run.assert_called_once_with("job-123", OTHER_USER_ID, infos)


def test_job_status_is_looked_up_for_the_token_user(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    fake_status = {"status": "DONE", "total": 1, "done": 1, "results": []}
    with patch(
        "app.routers.analysis.get_job_status", AsyncMock(return_value=fake_status)
    ) as mock_status:
        client.get("/analysis/run/job-123", headers=auth_headers(OTHER_USER_ID))
    mock_status.assert_awaited_once_with("job-123", OTHER_USER_ID)


def test_recommendations_list_and_review_only_touch_the_token_users_rows(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    mine = _rec(USER_ID, "AAPL")
    theirs = _rec(OTHER_USER_ID, "MSFT")
    db_session.add_all([mine, theirs])
    db_session.commit()
    headers = auth_headers(OTHER_USER_ID)

    listed = client.get("/analysis/recommendations", headers=headers).json()
    assert [r["ticker"] for r in listed] == ["MSFT"]

    approve = client.post(f"/analysis/recommendations/{theirs.id}/approve", headers=headers)
    assert approve.status_code == 200
    reject_mine = client.post(f"/analysis/recommendations/{mine.id}/reject", headers=headers)
    assert reject_mine.status_code == 404
    db_session.refresh(mine)
    db_session.refresh(theirs)
    assert theirs.status == "APPROVED"
    assert mine.status == "PENDING"
