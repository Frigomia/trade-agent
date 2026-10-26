import asyncio
import threading
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.analysis.portfolio import analyze_portfolio
from app.fx import EurPrice
from app.models import Holding
from app.portfolio_analytics import load_analytics
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user
from tests.test_portfolio_analytics_math import curve


def holding(client, ticker, shares=1):
    response = client.post(
        "/portfolio/holdings",
        json={
            "ticker": ticker,
            "name": ticker,
            "asset_type": "STOCK",
            "shares": shares,
            "cost_basis": 50,
            "first_purchase_date": "2025-01-01",
        },
    )
    assert response.status_code == 200


def test_analytics_values_only_the_authenticated_users_open_holdings(client, db_session):
    holding(client, "A", 2)
    holding(client, "SOLD", 0)
    add_app_user(db_session, OTHER_USER_ID)
    db_session.add(
        Holding(
            user_id=OTHER_USER_ID,
            ticker="SECRET",
            name="Private",
            asset_type="STOCK",
            shares=100,
            cost_basis=1,
            first_purchase_date=date(2025, 1, 1),
        )
    )
    db_session.commit()
    with (
        patch(
            "app.portfolio_analytics.fx.eur_prices",
            AsyncMock(return_value=({"A": EurPrice(Decimal(100), "USD", Decimal("0.8"))}, {})),
        ) as prices,
        patch(
            "app.portfolio_analytics.market_data.fetch_dated_closes",
            AsyncMock(return_value=curve()),
        ) as history,
        patch(
            "app.portfolio_analytics.market_data.fetch_profile",
            AsyncMock(
                return_value={
                    "sector": "Technology",
                    "industry": "Software",
                    "country": "Japan",
                    "exchange": "NMS",
                }
            ),
        ),
    ):
        response = client.get("/portfolio/analytics")

    assert response.status_code == 200
    body = response.json()
    assert [position["ticker"] for position in body["positions"]] == ["A"]
    assert body["by_country"] == [{"label": "Japan", "weight": 1.0}]
    assert body["total_value_eur"] > 0 and body["volatility_annualized"] > 0
    assert body["max_drawdown_1y"] is not None and body["max_drawdown_1y"] <= 0
    window = body["risk_window"]
    assert window["start"] < window["end"] and window["intervals_used"] >= 60
    assert window["intervals_skipped"] == 0
    assert body["positions"][0]["weight"] == 1
    assert response.headers["Cache-Control"] == "no-store"
    prices.assert_awaited_once_with({"A"})
    history.assert_awaited_once_with("A")


def test_history_and_profile_failures_preserve_valuation_and_sanitize_logs(client, caplog):
    holding(client, "A")
    with (
        patch(
            "app.portfolio_analytics.fx.eur_prices",
            AsyncMock(return_value=({"A": EurPrice(Decimal(100), "EUR", Decimal(1))}, {})),
        ),
        patch(
            "app.portfolio_analytics.market_data.fetch_dated_closes",
            AsyncMock(side_effect=RuntimeError("secret-token")),
        ),
        patch(
            "app.portfolio_analytics.market_data.fetch_profile",
            AsyncMock(side_effect=RuntimeError("secret-token")),
        ),
    ):
        response = client.get("/portfolio/analytics")
    assert response.status_code == 200
    body = response.json()
    assert body["total_value_eur"] == 100
    assert body["positions"][0]["price_as_of"] is None
    assert body["positions"][0]["stale"] is True
    assert body["volatility_annualized"] is None and body["max_drawdown_1y"] is None
    assert body["risk_window"] is None
    assert body["by_sector"] == [{"label": "Unclassified", "weight": 1.0}]
    assert "secret-token" not in caplog.text and "secret-token" not in response.text


def test_unpriced_positions_are_explained_and_never_trigger_more_fetches(client):
    holding(client, "A")
    with (
        patch(
            "app.portfolio_analytics.fx.eur_prices",
            AsyncMock(return_value=({}, {"A": "Its currency is unknown."})),
        ),
        patch("app.portfolio_analytics.market_data.fetch_dated_closes", AsyncMock()) as history,
        patch("app.portfolio_analytics.market_data.fetch_profile", AsyncMock()) as profile,
    ):
        response = client.get("/portfolio/analytics")
    assert response.status_code == 200
    assert response.json()["skipped"] == {"A": "Its currency is unknown."}
    assert response.json()["positions"] == []
    assert response.json()["total_value_eur"] is None
    history.assert_not_called()
    profile.assert_not_called()


def test_empty_account_requires_no_external_data(client):
    with patch("app.portfolio_analytics.fx.eur_prices", AsyncMock()) as prices:
        response = client.get("/portfolio/analytics")
    assert response.status_code == 200
    assert response.json()["positions"] == []
    prices.assert_not_called()


def test_analytics_requires_authentication_before_fetching(anon_client):
    with patch("app.portfolio_analytics.fx.eur_prices", AsyncMock()) as prices:
        assert anon_client.get("/portfolio/analytics").status_code == 401
    prices.assert_not_called()


def test_analytics_has_its_own_per_user_rate_limit(client):
    for _ in range(5):
        assert client.get("/portfolio/analytics").status_code == 200
    assert client.get("/portfolio/analytics").status_code == 429


def test_detail_fetches_stay_bounded_for_a_large_portfolio(client):
    for i in range(20):
        holding(client, f"A{i}")
    in_flight = peak = 0

    async def history(ticker):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.001)
        in_flight -= 1
        return curve()

    with (
        patch(
            "app.portfolio_analytics.fx.eur_prices",
            AsyncMock(
                return_value=(
                    {f"A{i}": EurPrice(Decimal(100), "EUR", Decimal(1)) for i in range(20)},
                    {},
                )
            ),
        ),
        patch("app.portfolio_analytics.market_data.fetch_dated_closes", side_effect=history),
        patch("app.portfolio_analytics.market_data.fetch_profile", AsyncMock(return_value={})),
    ):
        response = client.get("/portfolio/analytics")
    assert response.status_code == 200
    assert len(response.json()["positions"]) == 20
    assert 1 < peak <= 8


def test_slow_math_does_not_block_the_request_event_loop():
    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = [
        SimpleNamespace(ticker="A", name="A", shares=1, asset_type="STOCK", sector=None)
    ]
    started, released = threading.Event(), threading.Event()

    def slow_math(*args):
        started.set()
        # The event-loop task must be able to release the computation while it is running.
        assert released.wait(2), "analytics blocked the event loop"
        return analyze_portfolio(*args)

    async def exercise():
        task = asyncio.create_task(load_analytics(db, USER_ID))
        while not started.is_set():
            await asyncio.sleep(0)
        released.set()
        return await task

    with (
        patch("app.portfolio_analytics.fx.eur_prices", AsyncMock(return_value=({}, {}))),
        patch("app.portfolio_analytics.analyze_portfolio", side_effect=slow_math),
    ):
        result = asyncio.run(asyncio.wait_for(exercise(), timeout=5))
    assert result.positions == []
