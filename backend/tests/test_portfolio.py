import uuid
from datetime import date

from app.models import Holding


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
        json={"date": "2024-03-01", "ticker": "VWCE", "action": "BUY", "shares": 10, "price": 100.0},
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
        json={"date": "2024-03-01", "ticker": "VWCE", "action": "SELL", "shares": 4, "price": 105.0},
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
        json={"date": "2024-03-01", "ticker": "VWCE", "action": "SELL", "shares": 11, "price": 105.0},
    )
    assert response.status_code == 422

    holdings = client.get("/portfolio/holdings").json()
    assert holdings[0]["shares"] == 10


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
