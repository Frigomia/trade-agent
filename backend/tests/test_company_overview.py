"""A free overview belongs to a saved company; it never starts research or charges quota."""

from unittest.mock import AsyncMock, patch

import pytest

from tests.auth_support import OTHER_USER_ID, add_app_user
from tests.test_discover import idea, seed

PROFILE = {
    "name": "Halden Systems",
    "currency": "USD",
    "sector": "Technology",
    "industry": "Software",
}
QUOTE = {"price": 184.2, "closes": [180.0, 184.2], "as_of": "2026-10-23", "stale": False}


@pytest.fixture(autouse=True)
def scoped_background_reads(monkeypatch, app_session_local):
    monkeypatch.setattr("app.db.SessionLocal", app_session_local)


def test_overview_keeps_facts_separate_and_links_an_existing_report(client, db_session):
    seed(db_session, "HLDN", name="Halden Systems", currency="USD")
    report_id = idea(db_session, "HLDN")
    with (
        patch("app.routers.discover.fetch_profile", AsyncMock(return_value=PROFILE)),
        patch("app.routers.discover.fetch_quote_and_history", AsyncMock(return_value=QUOTE)),
        patch("app.usage.check_and_increment_usage", AsyncMock()) as charge,
    ):
        response = client.get("/discover/HLDN/overview")
    assert response.status_code == 200
    body = response.json()
    assert body["company"]["report_id"] == report_id
    assert body["company"]["price_as_of"] == "2026-10-23"
    assert body["sector"] == "Technology" and body["industry"] == "Software"
    assert body["missing"] == []
    assert response.headers["cache-control"] == "no-store"
    charge.assert_not_awaited()


@pytest.mark.parametrize("route", ["overview", "history", "analyze"])
def test_other_users_saved_company_is_a_404_before_provider_work(client, db_session, route):
    add_app_user(db_session, OTHER_USER_ID)
    seed(db_session, "PRIVATE", user_id=OTHER_USER_ID)
    with (
        patch("app.routers.discover.fetch_profile", AsyncMock()) as profile,
        patch("app.routers.discover.fetch_quote_and_history", AsyncMock()) as quote,
        patch("app.price_history.fetch_dated_closes", AsyncMock()) as history,
        patch("app.usage.reserve_company_usage", AsyncMock()) as reserve,
        patch("app.usage.check_and_increment_usage", AsyncMock()) as charge,
    ):
        request = client.post if route == "analyze" else client.get
        assert request(f"/discover/PRIVATE/{route}").status_code == 404
    profile.assert_not_awaited()
    quote.assert_not_awaited()
    history.assert_not_awaited()
    reserve.assert_not_awaited()
    charge.assert_not_awaited()


def test_overview_preserves_saved_identity_when_both_providers_fail(client, db_session):
    seed(db_session, "HLDN", name="Saved name", currency="USD")
    with (
        patch("app.routers.discover.fetch_profile", AsyncMock(side_effect=RuntimeError("secret"))),
        patch(
            "app.routers.discover.fetch_quote_and_history",
            AsyncMock(side_effect=RuntimeError("secret")),
        ),
    ):
        response = client.get("/discover/HLDN/overview")
    assert response.status_code == 200
    body = response.json()
    assert body["company"]["name"] == "Saved name"
    assert body["company"]["price"] is None
    assert body["missing"] == ["prices", "profile"]
    assert "secret" not in response.text


@pytest.mark.parametrize(
    "range_,period", [("1w", "5d"), ("1m", "1mo"), ("6m", "6mo"), ("1y", "1y"), ("5y", "5y")]
)
def test_saved_company_history_is_dated_and_converts_minor_units(
    client, db_session, range_, period
):
    seed(db_session, "ULVR.L", currency="GBp")
    with (
        patch("app.price_history.fetch_currency", AsyncMock(return_value="GBp")),
        patch(
            "app.price_history.fetch_dated_closes", AsyncMock(return_value={"2026-10-23": 4200.0})
        ) as fetch,
    ):
        response = client.get("/discover/ULVR.L/history", params={"range": range_})
    assert response.status_code == 200
    assert response.json()["currency"] == "GBP"
    assert response.json()["points"] == [{"date": "2026-10-23", "close": 42.0}]
    fetch.assert_awaited_once_with("ULVR.L", period, strict=True)


def test_unknown_history_unit_is_never_guessed(client, db_session):
    seed(db_session, "ULVR.L", currency="GBp")
    with (
        patch("app.price_history.fetch_currency", AsyncMock(return_value=None)),
        patch(
            "app.price_history.fetch_dated_closes", AsyncMock(return_value={"2026-10-23": 4200.0})
        ),
    ):
        assert client.get("/discover/ULVR.L/history").status_code == 502
