from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

from app.models import BacktestResult
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user, auth_headers


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


def test_run_backtest_rejects_reversed_date_range(client):
    response = client.post(
        "/backtest/run",
        json={"ticker": "AAPL", "start_date": "2024-01-01", "end_date": "2020-01-01"},
    )
    assert response.status_code == 422


def test_run_backtest_rejects_range_over_30_years(client):
    response = client.post(
        "/backtest/run",
        json={"ticker": "AAPL", "start_date": "1990-01-01", "end_date": "2024-01-01"},
    )
    assert response.status_code == 422


def test_run_backtest_rejects_ticker_with_path_metacharacters(client):
    response = client.post(
        "/backtest/run",
        json={"ticker": "AAPL/../etc", "start_date": "2020-01-01", "end_date": "2024-01-01"},
    )
    assert response.status_code == 422


def test_run_backtest_uppercases_ticker(client):
    with (
        patch("app.routers.backtest.create_job", AsyncMock(return_value="job-123")) as mock_create,
        patch("app.routers.backtest.run_job", AsyncMock()),
        patch("app.routers.backtest.asyncio.create_task", side_effect=_close_coro),
    ):
        response = client.post(
            "/backtest/run",
            json={"ticker": "aapl", "start_date": "2020-01-01", "end_date": "2024-01-01"},
        )

    assert response.status_code == 202
    mock_create.assert_called_once_with(USER_ID, "AAPL", date(2020, 1, 1), date(2024, 1, 1))


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
        user_id=USER_ID,
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


def _result(user_id, ticker="AAPL"):
    return BacktestResult(
        user_id=user_id,
        ticker=ticker,
        start_date=date(2020, 1, 1),
        end_date=date(2024, 1, 1),
        final_value=11000.0,
        buy_and_hold_value=10500.0,
        excess_return_pct=0.0476,
        hit_rate_by_signal={},
        status="DONE",
    )


def test_backtest_requires_authentication(anon_client):
    assert anon_client.get("/backtest/results").status_code == 401
    assert anon_client.get("/backtest/run/job-123").status_code == 401
    body = {"ticker": "AAPL", "start_date": "2020-01-01", "end_date": "2024-01-01"}
    assert anon_client.post("/backtest/run", json=body).status_code == 401


def test_backtest_job_status_is_looked_up_for_the_caller(client):
    fake_status = {"status": "DONE", "backtest_result_id": 1}
    with patch(
        "app.routers.backtest.get_job_status", AsyncMock(return_value=fake_status)
    ) as mock_status:
        client.get("/backtest/run/job-123")
    mock_status.assert_awaited_once_with("job-123", USER_ID)


def test_backtest_run_builds_the_job_for_the_token_user(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    with (
        patch("app.routers.backtest.create_job", AsyncMock(return_value="job-123")) as mock_create,
        patch("app.routers.backtest.run_job", AsyncMock()) as mock_run,
        patch("app.routers.backtest.asyncio.create_task", side_effect=_close_coro),
    ):
        response = client.post(
            "/backtest/run",
            json={"ticker": "AAPL", "start_date": "2020-01-01", "end_date": "2024-01-01"},
            headers=auth_headers(OTHER_USER_ID),
        )

    assert response.status_code == 202
    mock_create.assert_awaited_once_with(OTHER_USER_ID, "AAPL", date(2020, 1, 1), date(2024, 1, 1))
    mock_run.assert_called_once_with(
        "job-123", OTHER_USER_ID, "AAPL", date(2020, 1, 1), date(2024, 1, 1)
    )


def test_backtest_job_status_is_looked_up_for_the_token_user(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    fake_status = {"status": "DONE", "backtest_result_id": 1}
    with patch(
        "app.routers.backtest.get_job_status", AsyncMock(return_value=fake_status)
    ) as mock_status:
        client.get("/backtest/run/job-123", headers=auth_headers(OTHER_USER_ID))
    mock_status.assert_awaited_once_with("job-123", OTHER_USER_ID)


def test_backtest_results_only_include_the_token_users_rows(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    db_session.add_all([_result(USER_ID, "AAPL"), _result(OTHER_USER_ID, "MSFT")])
    db_session.commit()

    assert [r["ticker"] for r in client.get("/backtest/results").json()] == ["AAPL"]
    theirs = client.get("/backtest/results", headers=auth_headers(OTHER_USER_ID)).json()
    assert [r["ticker"] for r in theirs] == ["MSFT"]
