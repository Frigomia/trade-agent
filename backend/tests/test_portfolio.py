import uuid
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app.models import Holding, PortfolioSnapshot
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user, auth_headers


def test_list_holdings_empty(client):
    response = client.get("/portfolio/holdings")
    assert response.status_code == 200
    assert response.json() == []


def test_create_and_list_holding(client):
    payload = {
        "ticker": "VWCE",
        "name": "Vanguard FTSE All-World",
        "asset_type": "ETF",
        "shares": 10,
        "cost_basis": 95.5,
        "first_purchase_date": "2024-01-15",
    }
    response = client.post("/portfolio/holdings", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["ticker"] == "VWCE"
    assert body["shares"] == 10

    response = client.get("/portfolio/holdings")
    assert len(response.json()) == 1


def test_upsert_holding_updates_existing(client):
    payload = {
        "ticker": "VWCE",
        "name": "Vanguard FTSE All-World",
        "asset_type": "ETF",
        "shares": 10,
        "cost_basis": 95.5,
        "first_purchase_date": "2024-01-15",
    }
    client.post("/portfolio/holdings", json=payload)

    payload["shares"] = 15
    response = client.post("/portfolio/holdings", json=payload)
    assert response.json()["shares"] == 15

    response = client.get("/portfolio/holdings")
    assert len(response.json()) == 1


def test_delete_holding(client):
    payload = {
        "ticker": "VWCE",
        "name": "Vanguard FTSE All-World",
        "asset_type": "ETF",
        "shares": 10,
        "cost_basis": 95.5,
        "first_purchase_date": "2024-01-15",
    }
    client.post("/portfolio/holdings", json=payload)

    response = client.delete("/portfolio/holdings/VWCE")
    assert response.status_code == 204

    response = client.get("/portfolio/holdings")
    assert response.json() == []


def test_delete_missing_holding_returns_404(client):
    response = client.delete("/portfolio/holdings/NOPE")
    assert response.status_code == 404


def test_create_holding_rejects_ticker_with_path_metacharacters(client):
    payload = {
        "ticker": "VWCE/../etc",
        "name": "Vanguard FTSE All-World",
        "asset_type": "ETF",
        "shares": 10,
        "cost_basis": 95.5,
        "first_purchase_date": "2024-01-15",
    }
    response = client.post("/portfolio/holdings", json=payload)
    assert response.status_code == 422


def test_create_holding_uppercases_ticker(client):
    payload = {
        "ticker": "vwce",
        "name": "Vanguard FTSE All-World",
        "asset_type": "ETF",
        "shares": 10,
        "cost_basis": 95.5,
        "first_purchase_date": "2024-01-15",
    }
    response = client.post("/portfolio/holdings", json=payload)
    assert response.status_code == 200
    assert response.json()["ticker"] == "VWCE"


def test_list_watchlist_empty(client):
    response = client.get("/portfolio/watchlist")
    assert response.status_code == 200
    assert response.json() == []


def test_create_and_upsert_watchlist_item(client):
    payload = {"ticker": "NVDA", "asset_type": "STOCK", "note": "watching earnings"}
    response = client.post("/portfolio/watchlist", json=payload)
    assert response.status_code == 200
    assert response.json()["note"] == "watching earnings"

    payload["note"] = "still watching"
    response = client.post("/portfolio/watchlist", json=payload)
    assert response.json()["note"] == "still watching"

    response = client.get("/portfolio/watchlist")
    assert len(response.json()) == 1


def test_create_watchlist_item_rejects_ticker_with_path_metacharacters(client):
    payload = {"ticker": "NVDA/../etc", "asset_type": "STOCK", "note": "watching earnings"}
    response = client.post("/portfolio/watchlist", json=payload)
    assert response.status_code == 422


def test_log_trade_buy_updates_holding_cost_basis(client):
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": "VWCE",
            "name": "Vanguard FTSE All-World",
            "asset_type": "ETF",
            "shares": 10,
            "cost_basis": 90.0,
            "first_purchase_date": "2024-01-15",
        },
    )

    response = client.post(
        "/portfolio/trades",
        json={
            "date": "2024-03-01",
            "ticker": "VWCE",
            "action": "BUY",
            "shares": 10,
            "price": 100.0,
        },
    )
    assert response.status_code == 200

    holdings = client.get("/portfolio/holdings").json()
    assert holdings[0]["shares"] == 20
    assert holdings[0]["cost_basis"] == 95.0


def test_log_trade_sell_reduces_shares(client):
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": "VWCE",
            "name": "Vanguard FTSE All-World",
            "asset_type": "ETF",
            "shares": 10,
            "cost_basis": 90.0,
            "first_purchase_date": "2024-01-15",
        },
    )

    response = client.post(
        "/portfolio/trades",
        json={
            "date": "2024-03-01",
            "ticker": "VWCE",
            "action": "SELL",
            "shares": 4,
            "price": 105.0,
        },
    )
    assert response.status_code == 200

    holdings = client.get("/portfolio/holdings").json()
    assert holdings[0]["shares"] == 6


def test_log_trade_missing_holding_returns_404(client):
    response = client.post(
        "/portfolio/trades",
        json={"date": "2024-03-01", "ticker": "NOPE", "action": "BUY", "shares": 1, "price": 1.0},
    )
    assert response.status_code == 404


def test_log_trade_sell_more_than_held_returns_422(client):
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": "VWCE",
            "name": "Vanguard FTSE All-World",
            "asset_type": "ETF",
            "shares": 10,
            "cost_basis": 90.0,
            "first_purchase_date": "2024-01-15",
        },
    )

    response = client.post(
        "/portfolio/trades",
        json={
            "date": "2024-03-01",
            "ticker": "VWCE",
            "action": "SELL",
            "shares": 11,
            "price": 105.0,
        },
    )
    assert response.status_code == 422

    holdings = client.get("/portfolio/holdings").json()
    assert holdings[0]["shares"] == 10


def _add_holding(client, ticker="AAPL", name="Apple Inc."):
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": ticker,
            "name": name,
            "asset_type": "STOCK",
            "shares": 10,
            "cost_basis": 150.0,
            "first_purchase_date": "2024-01-01",
        },
    )


def test_snapshot_empty_portfolio_has_zero_totals(client):
    response = client.post("/portfolio/snapshot")

    assert response.status_code == 200
    body = response.json()
    assert body["total_market_value"] == 0
    assert body["total_cost_basis"] == 0


def test_snapshot_computes_totals_from_holdings(client):
    _add_holding(client)

    with patch(
        "app.routers.portfolio.fetch_quote_and_history",
        AsyncMock(return_value={"price": 200.0, "closes": [200.0]}),
    ):
        response = client.post("/portfolio/snapshot")

    assert response.status_code == 200
    body = response.json()
    assert body["total_market_value"] == 2000.0  # 10 shares * $200
    assert body["total_cost_basis"] == 1500.0  # 10 shares * $150 cost basis


def test_snapshot_fails_when_price_fetch_raises(client):
    _add_holding(client)

    with (
        patch(
            "app.routers.portfolio.fetch_quote_and_history",
            AsyncMock(side_effect=RuntimeError("yfinance unavailable")),
        ),
        pytest.raises(RuntimeError, match="yfinance unavailable"),
    ):
        client.post("/portfolio/snapshot")

    assert client.get("/portfolio/snapshots").json() == []


def test_snapshot_fails_when_price_is_none(client):
    _add_holding(client, ticker="DELISTED", name="Delisted Co")

    with patch(
        "app.routers.portfolio.fetch_quote_and_history",
        AsyncMock(return_value={"price": None, "closes": []}),
    ):
        response = client.post("/portfolio/snapshot")

    assert response.status_code == 500
    assert client.get("/portfolio/snapshots").json() == []


def test_snapshot_fails_when_price_is_nan(client):
    _add_holding(client, ticker="DELISTED", name="Delisted Co")

    with patch(
        "app.routers.portfolio.fetch_quote_and_history",
        AsyncMock(return_value={"price": float("nan"), "closes": []}),
    ):
        response = client.post("/portfolio/snapshot")

    assert response.status_code == 500
    assert client.get("/portfolio/snapshots").json() == []


def test_list_snapshots_ordered_oldest_first(client, db_session):
    db_session.add(PortfolioSnapshot(user_id=USER_ID, total_market_value=100, total_cost_basis=90))
    db_session.commit()
    db_session.add(PortfolioSnapshot(user_id=USER_ID, total_market_value=200, total_cost_basis=90))
    db_session.commit()

    response = client.get("/portfolio/snapshots")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert float(body[0]["total_market_value"]) == 100
    assert float(body[1]["total_market_value"]) == 200


def test_holdings_scoped_to_user_id(client, db_session):
    other_user_id = uuid.uuid4()
    other_holding = Holding(
        user_id=other_user_id,
        ticker="AAPL",
        name="Apple Inc.",
        asset_type="STOCK",
        shares=5,
        cost_basis=150.0,
        first_purchase_date=date(2024, 1, 1),
    )
    db_session.add(other_holding)
    db_session.commit()

    response = client.get("/portfolio/holdings")
    assert response.json() == []

    response = client.delete("/portfolio/holdings/AAPL")
    assert response.status_code == 404


def test_portfolio_requires_authentication(anon_client):
    assert anon_client.get("/portfolio/holdings").status_code == 401


def test_list_holdings_excludes_other_users_holdings(client, db_session):
    db_session.add(
        Holding(
            user_id=OTHER_USER_ID,
            ticker="ZZZZ",
            name="Theirs",
            asset_type="STOCK",
            shares=1,
            cost_basis=1,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    db_session.commit()

    response = client.get("/portfolio/holdings")

    assert response.status_code == 200
    assert response.json() == []


def test_upsert_holding_is_stored_for_the_caller(client, db_session):
    payload = {
        "ticker": "AAPL",
        "name": "Apple",
        "asset_type": "STOCK",
        "shares": 2,
        "cost_basis": 100,
        "first_purchase_date": "2024-01-01",
    }
    assert client.post("/portfolio/holdings", json=payload).status_code == 200

    stored = db_session.query(Holding).filter_by(ticker="AAPL").one()
    assert stored.user_id == USER_ID


def test_identity_comes_from_the_token_not_a_default_user(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    as_other = auth_headers(OTHER_USER_ID)
    payload = {
        "ticker": "MSFT",
        "name": "Microsoft",
        "asset_type": "STOCK",
        "shares": 3,
        "cost_basis": 200,
        "first_purchase_date": "2024-01-01",
    }

    assert client.post("/portfolio/holdings", json=payload, headers=as_other).status_code == 200
    assert db_session.query(Holding).filter_by(ticker="MSFT").one().user_id == OTHER_USER_ID
    assert db_session.query(Holding).filter_by(user_id=USER_ID).count() == 0

    db_session.add(
        Holding(
            user_id=USER_ID,
            ticker="AAPL",
            name="Apple",
            asset_type="STOCK",
            shares=1,
            cost_basis=1,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    db_session.commit()

    response = client.get("/portfolio/holdings", headers=as_other)

    assert response.status_code == 200
    assert [h["ticker"] for h in response.json()] == ["MSFT"]
