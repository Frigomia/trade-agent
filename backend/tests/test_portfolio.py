import uuid
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app.models import Holding, PortfolioSnapshot, WatchlistItem
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


def test_readding_watchlist_ticker_without_note_keeps_the_note(client):
    client.post("/portfolio/watchlist", json={"ticker": "NVDA", "asset_type": "STOCK", "note": "n"})
    client.post("/portfolio/watchlist", json={"ticker": "NVDA", "asset_type": "STOCK"})

    assert client.get("/portfolio/watchlist").json()[0]["note"] == "n"


def test_readding_watchlist_ticker_with_null_note_clears_it(client):
    client.post("/portfolio/watchlist", json={"ticker": "NVDA", "asset_type": "STOCK", "note": "n"})
    client.post(
        "/portfolio/watchlist", json={"ticker": "NVDA", "asset_type": "STOCK", "note": None}
    )

    assert client.get("/portfolio/watchlist").json()[0]["note"] is None


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
        "app.snapshots.fetch_quote_and_history",
        AsyncMock(return_value={"price": 200.0, "closes": [200.0]}),
    ):
        response = client.post("/portfolio/snapshot")

    assert response.status_code == 200
    body = response.json()
    assert body["total_market_value"] == 2000.0  # 10 shares * $200
    assert body["total_cost_basis"] == 1500.0  # 10 shares * $150 cost basis


def test_snapshot_skips_zero_share_holdings(client):
    _add_holding(client)
    _hold(client, "OLD", 0, 50.0)

    async def fake_quote(ticker):
        if ticker != "AAPL":
            raise RuntimeError("no quote")
        return {"price": 200.0, "closes": [200.0]}

    with patch("app.snapshots.fetch_quote_and_history", AsyncMock(side_effect=fake_quote)) as mock:
        response = client.post("/portfolio/snapshot")

    assert response.status_code == 200
    body = response.json()
    assert body["total_market_value"] == 2000.0
    assert body["total_cost_basis"] == 1500.0
    mock.assert_awaited_once_with("AAPL")


def test_snapshot_fails_when_price_fetch_raises(client):
    _add_holding(client)

    with (
        patch(
            "app.snapshots.fetch_quote_and_history",
            AsyncMock(side_effect=RuntimeError("yfinance unavailable")),
        ),
        pytest.raises(RuntimeError, match="yfinance unavailable"),
    ):
        client.post("/portfolio/snapshot")

    assert client.get("/portfolio/snapshots").json() == []


def test_snapshot_fails_when_price_is_none(client):
    _add_holding(client, ticker="DELISTED", name="Delisted Co")

    with patch(
        "app.snapshots.fetch_quote_and_history",
        AsyncMock(return_value={"price": None, "closes": []}),
    ):
        response = client.post("/portfolio/snapshot")

    assert response.status_code == 500
    assert response.json() == {"detail": "No current price available for DELISTED"}
    assert client.get("/portfolio/snapshots").json() == []


def test_snapshot_fails_when_price_is_nan(client):
    _add_holding(client, ticker="DELISTED", name="Delisted Co")

    with patch(
        "app.snapshots.fetch_quote_and_history",
        AsyncMock(return_value={"price": float("nan"), "closes": []}),
    ):
        response = client.post("/portfolio/snapshot")

    assert response.status_code == 500
    assert response.json() == {"detail": "No current price available for DELISTED"}
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


def _hold(client, ticker, shares, cost_basis):
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": ticker,
            "name": ticker,
            "asset_type": "STOCK",
            "shares": shares,
            "cost_basis": cost_basis,
            "first_purchase_date": "2024-01-01",
        },
    )


def _summary(client, prices):
    """GET /portfolio/summary with quotes faked from {ticker: price or an Exception}."""

    async def fake_quote(ticker):
        value = prices[ticker]
        if isinstance(value, Exception):
            raise value
        return {"price": value, "closes": [value]}

    with patch(
        "app.routers.portfolio.fetch_quote_and_history", AsyncMock(side_effect=fake_quote)
    ) as mock:
        response = client.get("/portfolio/summary")
    return response, mock


def test_summary_empty_portfolio(client):
    response, mock = _summary(client, {})

    assert response.status_code == 200
    assert response.json() == {
        "holdings": [],
        "watchlist": [],
        "total_market_value": 0,
        "total_cost_basis": 0,
        "total_pl": 0,
        "total_pl_pct": None,
        "unpriced_count": 0,
    }
    mock.assert_not_awaited()


def test_summary_computes_value_pl_and_weights(client):
    _hold(client, "AAPL", 10, 150.0)
    _hold(client, "MSFT", 5, 400.0)

    response, _ = _summary(client, {"AAPL": 200.0, "MSFT": 380.0})

    body = response.json()
    aapl, msft = body["holdings"]  # ordered by ticker
    assert aapl["ticker"] == "AAPL"
    assert aapl["first_purchase_date"] == "2024-01-01"
    assert aapl["market_value"] == 2000.0
    assert aapl["unrealized_pl"] == 500.0
    assert aapl["unrealized_pl_pct"] == pytest.approx(500 / 1500 * 100)
    assert aapl["weight"] == pytest.approx(2000 / 3900)
    assert msft["unrealized_pl"] == -100.0
    assert body["total_market_value"] == 3900.0
    assert body["total_cost_basis"] == 3500.0
    assert body["total_pl"] == 400.0
    assert body["total_pl_pct"] == pytest.approx(400 / 3500 * 100)
    assert body["unpriced_count"] == 0


def test_summary_leaves_a_failed_quote_out_of_the_totals(client):
    _hold(client, "AAPL", 10, 150.0)
    _hold(client, "MSFT", 5, 400.0)

    response, _ = _summary(client, {"AAPL": 200.0, "MSFT": RuntimeError("yfinance is down")})

    body = response.json()
    assert response.status_code == 200
    msft = next(h for h in body["holdings"] if h["ticker"] == "MSFT")
    assert msft["current_price"] is None
    assert msft["market_value"] is None
    assert msft["weight"] is None
    assert body["unpriced_count"] == 1
    assert body["total_market_value"] == 2000.0
    assert body["total_cost_basis"] == 1500.0  # MSFT's cost is left out too: like with like


def test_summary_treats_a_nan_price_as_unpriced_not_a_500(client):
    _hold(client, "AAPL", 10, 150.0)

    response, _ = _summary(client, {"AAPL": float("nan")})

    assert response.status_code == 200
    assert response.json()["unpriced_count"] == 1
    assert response.json()["holdings"][0]["current_price"] is None


def test_summary_fetches_each_ticker_once_and_prices_the_watchlist(client):
    _hold(client, "AAPL", 10, 150.0)
    client.post("/portfolio/watchlist", json={"ticker": "AAPL", "asset_type": "STOCK"})
    client.post(
        "/portfolio/watchlist", json={"ticker": "ASML", "asset_type": "STOCK", "note": "chips"}
    )

    response, mock = _summary(client, {"AAPL": 200.0, "ASML": 700.0})

    assert mock.await_count == 2  # AAPL is held and watched, but fetched once
    watch = {w["ticker"]: w for w in response.json()["watchlist"]}
    assert watch["ASML"]["current_price"] == 700.0
    assert watch["ASML"]["note"] == "chips"


def test_summary_excludes_a_sold_out_holding_from_totals_and_never_prices_it(client):
    _hold(client, "AAPL", 10, 150.0)
    _hold(client, "OLD", 0, 10.0)

    response, mock = _summary(client, {"AAPL": 200.0})

    body = response.json()
    old = next(h for h in body["holdings"] if h["ticker"] == "OLD")
    assert old["current_price"] is None
    assert body["unpriced_count"] == 0  # a closed position is not "unpriced"
    assert body["total_market_value"] == 2000.0
    mock.assert_awaited_once_with("AAPL")


def test_summary_excludes_other_users_holdings(client, db_session):
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

    response, mock = _summary(client, {})

    assert response.json()["holdings"] == []
    mock.assert_not_awaited()


def test_summary_requires_authentication(anon_client):
    assert anon_client.get("/portfolio/summary").status_code == 401


def _holding_payload(ticker):
    return {
        "ticker": ticker,
        "name": ticker,
        "asset_type": "STOCK",
        "shares": 1,
        "cost_basis": 1,
        "first_purchase_date": "2024-01-15",
    }


def test_holdings_are_capped_at_100_per_user(client, db_session):
    for i in range(100):
        db_session.add(
            Holding(
                user_id=USER_ID,
                ticker=f"H{i}",
                name="x",
                asset_type="STOCK",
                shares=1,
                cost_basis=1,
                first_purchase_date=date(2024, 1, 1),
            )
        )
    db_session.commit()

    response = client.post("/portfolio/holdings", json=_holding_payload("NEWONE"))
    assert response.status_code == 409
    assert "100" in response.json()["detail"]

    # Updating a holding that already exists is still allowed at the cap.
    assert client.post("/portfolio/holdings", json=_holding_payload("H0")).status_code == 200


def test_watchlist_is_capped_at_100_per_user(client, db_session):
    for i in range(100):
        db_session.add(WatchlistItem(user_id=USER_ID, ticker=f"W{i}", asset_type="STOCK"))
    db_session.commit()

    response = client.post("/portfolio/watchlist", json={"ticker": "NEWONE", "asset_type": "ETF"})
    assert response.status_code == 409
    assert "100" in response.json()["detail"]

    existing = client.post("/portfolio/watchlist", json={"ticker": "W0", "asset_type": "STOCK"})
    assert existing.status_code == 200


@pytest.mark.parametrize(
    ("method", "path"),
    [("get", "/portfolio/summary"), ("post", "/portfolio/snapshot")],
)
def test_expensive_portfolio_routes_are_rate_limited(client, method, path):
    send = getattr(client, method)
    with patch("app.routers.portfolio.fetch_quote_and_history", AsyncMock(return_value={})):
        for _ in range(30):
            assert send(path).status_code != 429
        assert send(path).status_code == 429


def _record_statements(app_engine):
    from sqlalchemy import event

    statements: list[str] = []

    def _before(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(app_engine, "before_cursor_execute", _before)
    return statements


@pytest.mark.parametrize(
    ("path", "payload", "count_table"),
    [
        ("/portfolio/holdings", _holding_payload("LOCKME"), "FROM holdings"),
        ("/portfolio/watchlist", {"ticker": "LOCKME", "asset_type": "ETF"}, "FROM watchlist_items"),
    ],
)
def test_creating_a_row_takes_the_per_user_lock_before_counting(
    client, app_engine, path, payload, count_table
):
    statements = _record_statements(app_engine)
    assert client.post(path, json=payload).status_code == 200

    lock_at = next(i for i, s in enumerate(statements) if "pg_advisory_xact_lock" in s)
    count_at = next(i for i, s in enumerate(statements) if "count(*)" in s and count_table in s)
    assert lock_at < count_at


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/portfolio/holdings", _holding_payload("RATE")),
        ("/portfolio/watchlist", {"ticker": "RATE", "asset_type": "ETF"}),
    ],
)
def test_portfolio_writes_are_rate_limited(client, path, payload):
    for _ in range(60):
        assert client.post(path, json=payload).status_code == 200
    assert client.post(path, json=payload).status_code == 429
