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
