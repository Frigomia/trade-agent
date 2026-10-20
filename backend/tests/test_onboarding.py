import asyncio
import threading
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pandas as pd
import pytest

from app import holdings
from app.agents import market_data
from app.models import AppUser, Holding
from tests.auth_support import USER_ID


@pytest.fixture
def profile(monkeypatch):
    value = {
        "name": "Microsoft",
        "sector": "Technology",
        "industry": "Software",
        "country": "United States",
        "currency": "USD",
        "quote_type": "EQUITY",
    }
    monkeypatch.setattr(holdings, "fetch_profile", AsyncMock(return_value=value))
    return value


def test_ticker_and_shares_only_autofills_metadata_without_purchase_details(
    client, db_session, profile
):
    response = client.post("/portfolio/holdings", json={"ticker": "msft", "shares": 3})
    assert response.status_code == 200
    body = response.json()
    assert (body["ticker"], body["name"], body["asset_type"], body["sector"], body["currency"]) == (
        "MSFT",
        "Microsoft",
        "STOCK",
        "Technology",
        "USD",
    )
    assert body["cost_basis"] is body["first_purchase_date"] is None
    profile["country"] = "Changed on read"
    assert client.get("/portfolio/holdings").json()[0]["country"] == "Changed on read"
    assert not {"country", "industry", "currency"} & set(Holding.__table__.columns.keys())
    exported = client.get("/me/export").json()["holdings"][0]
    assert exported["cost_basis"] is None
    assert db_session.query(Holding).one().user_id == USER_ID


def test_partial_upsert_preserves_known_purchase_details_and_explicit_null_clears(client, profile):
    payload = {
        "ticker": "MSFT",
        "shares": 3,
        "cost_basis": 100,
        "first_purchase_date": "2024-01-01",
        "name": "My name",
        "target_weight": 0.2,
    }
    assert client.post("/portfolio/holdings", json=payload).status_code == 200
    body = client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 4}).json()
    assert (
        body["name"],
        body["cost_basis"],
        body["first_purchase_date"],
        body["target_weight"],
    ) == ("My name", 100, "2024-01-01", 0.2)
    cleared = client.post(
        "/portfolio/holdings",
        json={"ticker": "MSFT", "shares": 4, "cost_basis": None, "first_purchase_date": None},
    ).json()
    assert cleared["cost_basis"] is cleared["first_purchase_date"] is None


def test_unavailable_profile_requires_type_but_never_invents_purchase_price(client, db_session):
    assert (
        client.post("/portfolio/holdings", json={"ticker": "UNKNOWN", "shares": 2}).status_code
        == 422
    )
    assert db_session.query(Holding).count() == 0
    body = client.post(
        "/portfolio/holdings", json={"ticker": "UNKNOWN", "shares": 2, "asset_type": "ETF"}
    ).json()
    assert body["name"] == "UNKNOWN" and body["cost_basis"] is None


def test_removed_account_during_profile_lookup_cannot_write(client, db_session, monkeypatch):
    async def removed(ticker):
        db_session.get(AppUser, USER_ID).status = "disabled"
        db_session.commit()
        return {"name": "Microsoft", "quote_type": "EQUITY"}

    monkeypatch.setattr(holdings, "fetch_profile", removed)
    assert (
        client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 3}).status_code == 403
    )
    assert db_session.query(Holding).count() == 0


def test_summary_and_snapshot_keep_unknown_basis_out_of_profit(client, profile):
    client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 3})
    client.post("/portfolio/holdings", json={"ticker": "AAPL", "shares": 2, "cost_basis": 100})
    quote = {
        "price": 150,
        "closes": [150],
        "as_of": datetime.now(UTC).date().isoformat(),
        "stale": False,
    }
    with patch("app.routers.portfolio.fetch_quote_and_history", AsyncMock(return_value=quote)):
        body = client.get("/portfolio/summary").json()
    assert body["total_market_value"] == 750 and body["total_cost_basis"] == 200
    assert body["total_pl"] == 100 and body["total_pl_pct"] == 50
    assert (body["unknown_basis_count"], body["pl_covered_count"], body["pl_complete"]) == (
        1,
        1,
        False,
    )
    unknown = next(h for h in body["holdings"] if h["ticker"] == "MSFT")
    assert unknown["market_value"] == 450 and unknown["unrealized_pl"] is None
    assert unknown["as_of"] == quote["as_of"] and unknown["stale"] is False
    with patch("app.snapshots.fetch_quote_and_history", AsyncMock(return_value=quote)):
        snap = client.post("/portfolio/snapshot").json()
    assert snap["total_market_value"] == 750 and snap["total_cost_basis"] == 200
    assert snap["cost_basis_complete"] is False
    assert client.get("/portfolio/snapshots").json()[0]["cost_basis_complete"] is False


@pytest.mark.parametrize("action, shares", [("BUY", 1), ("SELL", 2)])
def test_trades_keep_existing_unknown_basis_unknown(client, profile, action, shares):
    client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 3})
    response = client.post(
        "/portfolio/trades",
        json={
            "ticker": "MSFT",
            "action": action,
            "shares": shares,
            "price": 50,
            "date": "2026-10-20",
        },
    )
    assert response.status_code == 200
    assert client.get("/portfolio/holdings").json()[0]["cost_basis"] is None


def test_first_buy_after_zero_shares_establishes_known_basis(client, profile):
    client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 0})
    client.post(
        "/portfolio/trades",
        json={"ticker": "MSFT", "action": "BUY", "shares": 2, "price": 50, "date": "2026-10-20"},
    )
    row = client.get("/portfolio/holdings").json()[0]
    assert row["cost_basis"] == 50 and row["first_purchase_date"] == "2026-10-20"


def test_quote_date_follows_last_finite_close_and_old_cache_is_stale(monkeypatch):
    today = datetime.now(UTC).date()
    dates = pd.to_datetime([today - timedelta(days=1), today])
    frame = pd.DataFrame({"Close": [100, float("nan")]}, index=dates)
    redis = AsyncMock()
    redis.get.return_value = None
    monkeypatch.setattr(market_data, "get_redis", lambda: redis)
    with patch.object(market_data.yf, "Ticker") as ticker:
        ticker.return_value.history.return_value = frame
        out = asyncio.run(market_data.fetch_quote_and_history("MSFT"))
    assert out["as_of"] == (today - timedelta(days=1)).isoformat()
    assert out["price"] == 100 and out["stale"] is False
    redis.get.return_value = '{"price":100,"closes":[100]}'
    assert asyncio.run(market_data.fetch_quote_and_history("MSFT"))["stale"] is True


@pytest.mark.parametrize("value", [None, "bad", "2000-01-01"])
def test_missing_or_old_quote_date_is_stale(value):
    assert market_data.quote_is_stale(value)


def test_metadata_outage_keeps_manual_updates_and_reads_available(client, monkeypatch, caplog):
    monkeypatch.setattr(
        holdings, "fetch_profile", AsyncMock(side_effect=ValueError("secret-cache"))
    )
    response = client.post(
        "/portfolio/holdings",
        json={"ticker": "MSFT", "shares": 1, "asset_type": "STOCK", "name": "Microsoft"},
    )
    assert response.status_code == 200
    assert (
        client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 2}).status_code == 200
    )
    assert client.get("/portfolio/holdings").status_code == 200
    with patch(
        "app.routers.portfolio.fetch_quote_and_history", AsyncMock(side_effect=ValueError())
    ):
        summary = client.get("/portfolio/summary")
    assert summary.status_code == 200 and summary.json()["unpriced_count"] == 1
    assert "secret-cache" not in caplog.text


@pytest.mark.parametrize("days_ahead, expected", [(1, False), (2, True)])
def test_quote_freshness_allows_exchange_local_date_one_day_ahead(days_ahead, expected):
    as_of = (datetime.now(UTC).date() + timedelta(days=days_ahead)).isoformat()
    assert market_data.quote_is_stale(as_of) is expected


def test_rebuy_preserves_known_first_purchase_date(client, profile):
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": "MSFT",
            "shares": 0,
            "cost_basis": 100,
            "first_purchase_date": "2024-01-01",
        },
    )
    response = client.post(
        "/portfolio/trades",
        json={
            "ticker": "MSFT",
            "action": "BUY",
            "shares": 2,
            "price": 50,
            "date": "2026-10-20",
        },
    )
    assert response.status_code == 200
    row = client.get("/portfolio/holdings").json()[0]
    assert row["cost_basis"] == 50
    assert row["first_purchase_date"] == "2024-01-01"


def test_profile_recovery_backfills_fallback_name_but_preserves_override(client, monkeypatch):
    client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 1, "asset_type": "STOCK"})
    monkeypatch.setattr(holdings, "fetch_profile", AsyncMock(return_value={"name": "Microsoft"}))
    assert client.get("/portfolio/holdings").json()[0]["name"] == "Microsoft"
    assert (
        client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 2}).json()["name"]
        == "Microsoft"
    )
    client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 2, "name": "My Microsoft"})
    assert client.get("/portfolio/holdings").json()[0]["name"] == "My Microsoft"


def test_explicit_null_sector_is_not_refilled_by_profile(client, profile):
    client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 1})
    body = client.post(
        "/portfolio/holdings", json={"ticker": "MSFT", "shares": 1, "sector": None}
    ).json()
    assert body["sector"] is None
    assert client.get("/portfolio/holdings").json()[0]["sector"] is None


def test_summary_overlaps_metadata_and_quotes_and_uses_provider_stale_flag(client, monkeypatch):
    client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 1, "asset_type": "STOCK"})
    started = asyncio.Event()

    async def profile(ticker):
        await asyncio.wait_for(started.wait(), timeout=2)
        return {"currency": "USD"}

    async def quote(ticker):
        started.set()
        return {"price": 100, "as_of": datetime.now(UTC).date().isoformat(), "stale": True}

    monkeypatch.setattr(holdings, "fetch_profile", profile)
    monkeypatch.setattr("app.routers.portfolio.fetch_quote_and_history", quote)
    body = client.get("/portfolio/summary").json()
    assert body["holdings"][0]["currency"] == "USD"
    assert body["holdings"][0]["stale"] is True


def test_list_holdings_reads_scoped_database_off_event_loop(client, monkeypatch):
    original = holdings.read_holdings
    called = []

    def read(db, user_id):
        with pytest.raises(RuntimeError, match="no running event loop"):
            asyncio.get_running_loop()
        called.append(user_id)
        return original(db, user_id)

    monkeypatch.setattr(holdings, "read_holdings", read)
    assert client.get("/portfolio/holdings").json() == []
    assert called == [USER_ID]


def test_list_holdings_returns_saved_rows_when_metadata_exceeds_budget(client, monkeypatch):
    client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 1, "asset_type": "STOCK"})

    async def slow_profile(ticker):
        await asyncio.sleep(60)
        return {"currency": "USD"}

    monkeypatch.setattr(holdings, "fetch_profile", slow_profile)
    monkeypatch.setattr("app.routers.portfolio.PROFILE_READ_TIMEOUT_SECONDS", 0.01)
    response = client.get("/portfolio/holdings")
    assert response.status_code == 200
    assert response.json()[0]["ticker"] == "MSFT"
    assert response.json()[0]["currency"] is None


def test_summary_skips_closed_metadata_and_shares_one_fanout_budget(client, monkeypatch):
    for i in range(12):
        client.post(
            "/portfolio/holdings", json={"ticker": f"TEST{i}", "shares": 1, "asset_type": "STOCK"}
        )
    client.post(
        "/portfolio/holdings", json={"ticker": "CLOSED", "shares": 0, "asset_type": "STOCK"}
    )
    active = peak = 0
    profiles, quotes = [], []

    async def fetch(ticker, calls, result):
        nonlocal active, peak
        calls.append(ticker)
        active += 1
        peak = max(peak, active)
        try:
            await asyncio.sleep(0.01)
            return result
        finally:
            active -= 1

    async def profile(ticker):
        return await fetch(ticker, profiles, {"currency": "USD"})

    async def quote(ticker):
        return await fetch(ticker, quotes, {"price": 100, "stale": False})

    monkeypatch.setattr(holdings, "fetch_profile", profile)
    monkeypatch.setattr("app.routers.portfolio.fetch_quote_and_history", quote)
    response = client.get("/portfolio/summary")
    assert response.status_code == 200
    assert len(profiles) == len(quotes) == 12
    assert "CLOSED" not in profiles + quotes
    assert 1 < peak <= 8


def test_edit_backfills_missing_sector_and_preserves_purchase_details(client, monkeypatch, profile):
    profile["sector"] = None
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": "MSFT",
            "shares": 0,
            "cost_basis": 100,
            "first_purchase_date": "2024-01-01",
            "target_weight": 0.2,
        },
    )
    profile["sector"] = "Technology"
    body = client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 1}).json()
    assert body["sector"] == "Technology"
    assert (body["cost_basis"], body["first_purchase_date"], body["target_weight"]) == (
        100,
        "2024-01-01",
        0.2,
    )


def test_provider_name_preserves_up_to_holding_column_limit(client, profile):
    profile["name"] = "A" * 180
    body = client.post("/portfolio/holdings", json={"ticker": "MSFT", "shares": 1}).json()
    assert body["name"] == "A" * 180


def test_cancelled_holding_read_finishes_before_dependency_closes_session(monkeypatch):
    started, release, finished = threading.Event(), threading.Event(), threading.Event()
    closures = []

    def read(db, user_id):
        started.set()
        try:
            assert release.wait(5)
            return []
        finally:
            finished.set()

    async def request():
        try:
            await holdings.load_holdings(None, USER_ID)
        finally:
            closures.append(finished.is_set())

    async def exercise():
        task = asyncio.create_task(request())
        try:
            assert await asyncio.to_thread(started.wait, 5)
            for _ in range(2):
                task.cancel()
                await asyncio.sleep(0)
                assert not task.done()
        finally:
            release.set()
        with pytest.raises(asyncio.CancelledError):
            await task

    monkeypatch.setattr(holdings, "read_holdings", read)
    asyncio.run(exercise())
    assert closures == [True]
