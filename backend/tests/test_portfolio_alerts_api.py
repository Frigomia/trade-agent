from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, patch

from app.models import Holding, Recommendation
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user


def seed_holding(db, ticker, shares=1, cost=100.0, user_id=USER_ID, name=None, asset_type="STOCK"):
    db.add(
        Holding(
            user_id=user_id,
            ticker=ticker,
            name=name or f"{ticker} Inc",
            asset_type=asset_type,
            shares=shares,
            cost_basis=cost,
            first_purchase_date=date(2025, 1, 1),
        )
    )


def seed_rec(db, ticker, action="TRIM", source="manual", status="PENDING", user_id=USER_ID):
    db.add(
        Recommendation(
            user_id=user_id,
            ticker=ticker,
            asset_type="STOCK",
            action=action,
            reasoning=["r"],
            status=status,
            source=source,
        )
    )


def get_alerts(client, prices, earnings, stale=()):
    """GET /portfolio/alerts with quotes and earnings faked: {ticker: value or an Exception}."""

    async def quote(ticker):
        value = prices[ticker]
        if isinstance(value, Exception):
            raise value
        return {"price": value, "closes": [value], "stale": ticker in stale}

    async def next_earnings(ticker):
        value = earnings.get(ticker)
        if isinstance(value, Exception):
            raise value
        return value

    with (
        patch("app.routers.portfolio.fetch_quote_and_history", AsyncMock(side_effect=quote)),
        patch("app.routers.portfolio.fetch_next_earnings", AsyncMock(side_effect=next_earnings)),
    ):
        return client.get("/portfolio/alerts")


def tomorrow():
    return datetime.now(UTC).date() + timedelta(days=1)


def test_alerts_return_a_call_upcoming_earnings_and_a_move_for_the_users_holdings(
    client, db_session
):
    seed_holding(db_session, "AURL", name="Aurelle Foods")
    seed_holding(db_session, "CSTR", name="Castor Logistics")
    seed_rec(db_session, "AURL", action="TRIM")
    db_session.commit()

    response = get_alerts(client, {"AURL": 100.0, "CSTR": 120.0}, {"AURL": tomorrow()})

    assert response.status_code == 200
    body = response.json()
    assert body["missing"] == []
    assert [(a["kind"], a["ticker"], a["name"], a["text"]) for a in body["alerts"]] == [
        ("new_recommendation", "AURL", "Aurelle Foods", "New AI recommendation: TRIM"),
        ("earnings_upcoming", "AURL", "Aurelle Foods", "Earnings tomorrow"),
        ("move_since_purchase", "CSTR", "Castor Logistics", "Up 20.0% on your purchase cost"),
    ]
    assert body["alerts"][0]["recommendation_id"] is not None
    assert body["alerts"][1]["when"] == tomorrow().isoformat()
    assert body["alerts"][2]["direction"] == "up"


def test_alerts_are_empty_for_a_user_with_nothing_to_report(client):
    response = get_alerts(client, {}, {})

    assert response.status_code == 200
    assert response.json() == {"alerts": [], "missing": []}


def test_alerts_never_show_another_users_holdings_or_calls(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    seed_holding(db_session, "SECRET", user_id=OTHER_USER_ID, cost=1.0)
    seed_rec(db_session, "SECRET", user_id=OTHER_USER_ID)
    seed_holding(db_session, "MINE")
    db_session.commit()

    response = get_alerts(client, {"MINE": 100.0}, {})

    assert response.json()["alerts"] == []
    assert "SECRET" not in response.text


def test_alerts_leave_out_discovery_ideas_decided_calls_and_sold_holdings(client, db_session):
    seed_holding(db_session, "SOLD", shares=0, cost=1.0)
    seed_holding(db_session, "HELD")
    seed_rec(db_session, "HELD", source="discovery")
    seed_rec(db_session, "HELD", status="APPROVED")
    db_session.commit()

    response = get_alerts(client, {"HELD": 100.0}, {})

    # A sold holding is never looked up: a failed lookup would show up as "missing".
    assert response.json() == {"alerts": [], "missing": []}


def test_a_failed_earnings_lookup_is_reported_as_missing_not_as_nothing_to_report(
    client, db_session
):
    seed_holding(db_session, "AURL")
    seed_holding(db_session, "CSTR")
    db_session.commit()

    response = get_alerts(
        client,
        {"AURL": 130.0, "CSTR": 100.0},
        {"AURL": RuntimeError("yahoo is down"), "CSTR": None},
    )

    body = response.json()
    assert response.status_code == 200
    assert body["missing"] == ["earnings"]
    assert [a["kind"] for a in body["alerts"]] == ["move_since_purchase"]  # what could be built


def test_a_failed_quote_is_reported_as_missing_prices_and_a_holding_without_a_cost_is_not(
    client, db_session
):
    seed_holding(db_session, "AURL")
    seed_holding(db_session, "NOCOST", cost=None)
    db_session.commit()

    response = get_alerts(
        client, {"AURL": RuntimeError("down"), "NOCOST": RuntimeError("down")}, {}
    )

    assert response.json() == {"alerts": [], "missing": ["prices"]}


def test_no_earnings_date_is_not_a_failure(client, db_session):
    seed_holding(db_session, "ETF1")
    db_session.commit()

    response = get_alerts(client, {"ETF1": 100.0}, {"ETF1": None})

    assert response.json() == {"alerts": [], "missing": []}


def test_alerts_need_a_signed_in_user(anon_client):
    assert anon_client.get("/portfolio/alerts").status_code == 401


def test_a_stale_quote_makes_no_move_alert_and_is_reported_as_missing_prices(client, db_session):
    seed_holding(db_session, "HALTED")
    db_session.commit()

    response = get_alerts(client, {"HALTED": 60.0}, {}, stale={"HALTED"})

    assert response.json() == {"alerts": [], "missing": ["prices"]}


def test_an_etf_is_never_looked_up_for_earnings(client, db_session):
    seed_holding(db_session, "VWCE", asset_type="ETF")
    db_session.commit()

    async def boom(ticker):
        raise AssertionError("an ETF has no earnings to look up")

    with (
        patch(
            "app.routers.portfolio.fetch_quote_and_history",
            AsyncMock(return_value={"price": 100.0, "stale": False}),
        ),
        patch("app.routers.portfolio.fetch_next_earnings", AsyncMock(side_effect=boom)),
    ):
        response = client.get("/portfolio/alerts")

    assert response.json() == {"alerts": [], "missing": []}


def test_two_pending_calls_on_one_ticker_are_one_alert(client, db_session):
    seed_holding(db_session, "AURL")
    seed_rec(db_session, "AURL", action="BUY")
    seed_rec(db_session, "AURL", action="TRIM")
    db_session.commit()

    response = get_alerts(client, {"AURL": 100.0}, {})

    assert [a["text"] for a in response.json()["alerts"]] == ["New AI recommendation: TRIM"]
