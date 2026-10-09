import asyncio
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app.models import AppUser, Holding, PortfolioSnapshot
from app.snapshots import PriceUnavailable, record_snapshot
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user


@pytest.fixture(autouse=True)
def _active_user(db_session):
    add_app_user(db_session, USER_ID)  # record_snapshot only writes for an active account


def _holding(db, ticker="AAPL", shares=10, cost=150.0, user_id=USER_ID):
    db.add(
        Holding(
            user_id=user_id,
            ticker=ticker,
            name=ticker,
            asset_type="STOCK",
            shares=shares,
            cost_basis=cost,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    db.commit()


def _record(db, quote, user_id=USER_ID):
    with patch("app.snapshots.fetch_quote_and_history", quote):
        return asyncio.run(record_snapshot(db, user_id))


def test_record_snapshot_totals_priced_holdings(db_session):
    _holding(db_session, "AAPL", 10, 150.0)
    _holding(db_session, "MSFT", 2, 300.0)

    async def quote(ticker):
        return {"price": {"AAPL": 200.0, "MSFT": 400.0}[ticker], "closes": []}

    snapshot = _record(db_session, AsyncMock(side_effect=quote))

    assert float(snapshot.total_market_value) == 2800.0  # 10*200 + 2*400
    assert float(snapshot.total_cost_basis) == 2100.0  # 10*150 + 2*300
    assert db_session.query(PortfolioSnapshot).filter_by(user_id=USER_ID).count() == 1


def test_record_snapshot_of_an_empty_portfolio_is_a_zero_snapshot(db_session):
    quote = AsyncMock()
    snapshot = _record(db_session, quote)

    assert float(snapshot.total_market_value) == 0
    assert float(snapshot.total_cost_basis) == 0
    quote.assert_not_awaited()


def test_record_snapshot_skips_zero_share_holdings(db_session):
    _holding(db_session, "AAPL", 10, 150.0)
    _holding(db_session, "OLD", 0, 50.0)
    quote = AsyncMock(return_value={"price": 200.0, "closes": []})

    snapshot = _record(db_session, quote)

    assert float(snapshot.total_market_value) == 2000.0
    quote.assert_awaited_once_with("AAPL")


def test_record_snapshot_only_counts_the_users_own_holdings(db_session):
    _holding(db_session, "AAPL", 10, 150.0)
    _holding(db_session, "MSFT", 99, 1.0, user_id=OTHER_USER_ID)

    snapshot = _record(db_session, AsyncMock(return_value={"price": 200.0, "closes": []}))

    assert float(snapshot.total_market_value) == 2000.0


@pytest.mark.parametrize("bad_price", [None, float("nan"), float("inf")])
def test_record_snapshot_raises_price_unavailable_and_writes_nothing(db_session, bad_price):
    _holding(db_session, "DELISTED")

    with pytest.raises(PriceUnavailable) as caught:
        _record(db_session, AsyncMock(return_value={"price": bad_price, "closes": []}))

    assert caught.value.ticker == "DELISTED"
    assert str(caught.value) == "No current price available for DELISTED"
    assert db_session.query(PortfolioSnapshot).count() == 0


def test_record_snapshot_lets_a_quote_error_propagate(db_session):
    _holding(db_session, "AAPL")

    with pytest.raises(RuntimeError, match="yfinance unavailable"):
        _record(db_session, AsyncMock(side_effect=RuntimeError("yfinance unavailable")))

    assert db_session.query(PortfolioSnapshot).count() == 0


@pytest.mark.parametrize("status", ["disabled", None])
def test_record_snapshot_writes_nothing_for_a_blocked_user(db_session, status):
    if status is None:
        db_session.query(AppUser).filter_by(id=USER_ID).delete()
    else:
        db_session.query(AppUser).filter_by(id=USER_ID).update({"status": status})
    db_session.commit()

    assert _record(db_session, AsyncMock(return_value={"price": 1.0, "closes": []})) is None
    assert db_session.query(PortfolioSnapshot).count() == 0
