import uuid
from datetime import date

import pytest

from app.models import Holding
from app.schemas import TradeIn
from app.trades import TradeRefused, apply_trade


def _holding(db, shares, cost):
    uid = uuid.uuid4()
    h = Holding(
        user_id=uid,
        ticker="AAPL",
        name="Apple",
        asset_type="STOCK",
        shares=shares,
        cost_basis=cost,
        first_purchase_date=date(2024, 1, 1),
    )
    db.add(h)
    db.flush()
    return uid, h


def test_a_buy_updates_the_weighted_average_and_adds_the_trade(db_session):
    uid, h = _holding(db_session, 10, 100)
    trade = apply_trade(
        db_session,
        uid,
        h,
        TradeIn(date=date(2026, 10, 1), ticker="AAPL", action="BUY", shares=10, price=120),
    )
    assert (float(h.shares), float(h.cost_basis)) == (20.0, 110.0)
    assert trade.user_id == uid and trade.action == "BUY" and trade in db_session.new


def test_a_sell_reduces_shares_and_keeps_the_cost(db_session):
    uid, h = _holding(db_session, 10, 100)
    apply_trade(
        db_session,
        uid,
        h,
        TradeIn(date=date(2026, 10, 1), ticker="AAPL", action="SELL", shares=4, price=150),
    )
    assert (float(h.shares), float(h.cost_basis)) == (6.0, 100.0)


def test_selling_more_than_held_is_refused_and_changes_nothing(db_session):
    uid, h = _holding(db_session, 10, 100)
    with pytest.raises(TradeRefused, match="Cannot sell 11"):
        apply_trade(
            db_session,
            uid,
            h,
            TradeIn(date=date(2026, 10, 1), ticker="AAPL", action="SELL", shares=11, price=1),
        )
    assert float(h.shares) == 10.0


def test_shares_and_price_are_rounded_to_the_stored_step_before_the_maths(db_session):
    uid, h = _holding(db_session, 10, 100)
    trade = apply_trade(
        db_session,
        uid,
        h,
        TradeIn(
            date=date(2026, 10, 1), ticker="AAPL", action="BUY", shares=1.2345675, price=10.1234565
        ),
    )
    # Half-even to 6 places: 1.2345675 -> 1.234568, 10.1234565 -> 10.123456.
    assert (trade.shares, trade.price) == (1.234568, 10.123456)
    expected = (10 * 100 + 1.234568 * 10.123456) / (10 + 1.234568)
    assert float(h.shares) == 10 + 1.234568
    assert float(h.cost_basis) == pytest.approx(expected, abs=1e-12)
    db_session.flush()
    db_session.refresh(trade)
    assert (float(trade.shares), float(trade.price)) == (1.234568, 10.123456)
