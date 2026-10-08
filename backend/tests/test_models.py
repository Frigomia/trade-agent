import uuid
from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import (
    ChatMessage,
    ContributionPlan,
    ContributionPlanLine,
    Holding,
    InvestmentPreferences,
    PortfolioSnapshot,
    Recommendation,
    TelegramLink,
    Trade,
    WatchlistItem,
)


def test_holding_roundtrip(db_session):
    holding = Holding(
        user_id=uuid.uuid4(),
        ticker="VWCE",
        name="Vanguard FTSE All-World",
        asset_type="ETF",
        shares=10,
        cost_basis=95.5,
        first_purchase_date=date(2024, 1, 15),
    )
    db_session.add(holding)
    db_session.commit()

    fetched = db_session.query(Holding).filter_by(ticker="VWCE").one()
    assert fetched.asset_type == "ETF"
    assert float(fetched.shares) == 10


def test_watchlist_item_roundtrip(db_session):
    item = WatchlistItem(user_id=uuid.uuid4(), ticker="NVDA", asset_type="STOCK")
    db_session.add(item)
    db_session.commit()

    fetched = db_session.query(WatchlistItem).filter_by(ticker="NVDA").one()
    assert fetched.note is None


def test_trade_roundtrip(db_session):
    trade = Trade(
        user_id=uuid.uuid4(),
        date=date(2024, 2, 1),
        ticker="VWCE",
        action="BUY",
        shares=5,
        price=97.2,
    )
    db_session.add(trade)
    db_session.commit()

    fetched = db_session.query(Trade).filter_by(ticker="VWCE").one()
    assert fetched.action == "BUY"


def test_recommendation_roundtrip(db_session):
    rec = Recommendation(
        user_id=uuid.uuid4(),
        ticker="VWCE",
        asset_type="ETF",
        action="HOLD",
        reasoning=["trend is up", "valuation fair"],
    )
    db_session.add(rec)
    db_session.commit()

    fetched = db_session.query(Recommendation).filter_by(ticker="VWCE").one()
    assert fetched.status == "PENDING"
    assert fetched.reasoning == ["trend is up", "valuation fair"]


def test_chat_message_roundtrip(db_session):
    msg = ChatMessage(
        user_id=uuid.uuid4(),
        session_id="sess-1",
        role="user",
        content="How is my portfolio doing?",
    )
    db_session.add(msg)
    db_session.commit()

    fetched = db_session.query(ChatMessage).filter_by(session_id="sess-1").one()
    assert fetched.role == "user"


def test_recommendation_memory_fields_roundtrip(db_session):
    embedding = [0.1] * 1024
    rec = Recommendation(
        user_id=uuid.uuid4(),
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.1"],
        price_at_recommendation=150.25,
        embedding=embedding,
    )
    db_session.add(rec)
    db_session.commit()

    fetched = db_session.query(Recommendation).filter_by(ticker="AAPL").one()
    assert float(fetched.price_at_recommendation) == 150.25
    assert fetched.outcome_forward_return_pct is None
    assert fetched.outcome_evaluated_at is None
    assert fetched.embedding == embedding


def test_investment_preferences_roundtrip(db_session):
    pref = InvestmentPreferences(user_id=uuid.uuid4())
    db_session.add(pref)
    db_session.commit()
    db_session.refresh(pref)

    assert pref.risk_tolerance is None
    assert pref.sector_avoid_list == []
    assert pref.notes is None
    assert pref.updated_at is not None


def test_investment_preferences_user_id_unique(db_session):
    user_id = uuid.uuid4()
    db_session.add(InvestmentPreferences(user_id=user_id))
    db_session.commit()

    db_session.add(InvestmentPreferences(user_id=user_id))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_portfolio_snapshot_roundtrip(db_session):
    snapshot = PortfolioSnapshot(
        user_id=uuid.uuid4(),
        total_market_value=15000.50,
        total_cost_basis=12000.00,
    )
    db_session.add(snapshot)
    db_session.commit()
    db_session.refresh(snapshot)

    assert snapshot.id is not None
    assert snapshot.created_at is not None
    assert float(snapshot.total_market_value) == 15000.50
    assert float(snapshot.total_cost_basis) == 12000.00


def test_auto_analysis_is_off_and_a_recommendation_is_manual_unless_said_otherwise(db_session):
    pref = InvestmentPreferences(user_id=uuid.uuid4())
    rec = Recommendation(
        user_id=uuid.uuid4(), ticker="AAPL", asset_type="STOCK", action="BUY", reasoning=["x"]
    )
    db_session.add_all([pref, rec])
    db_session.commit()
    db_session.refresh(pref)
    db_session.refresh(rec)
    assert pref.auto_analysis is False
    assert rec.source == "manual"


def test_telegram_link_defaults(db_session):
    link = TelegramLink(user_id=uuid.uuid4(), chat_id=123456789)
    db_session.add(link)
    db_session.commit()
    db_session.refresh(link)
    assert (link.status, link.digest_enabled, link.moves_enabled) == ("ok", True, True)
    assert float(link.move_threshold_pct) == 5.0


def test_planner_columns_and_tables_have_the_documented_defaults(db_session):
    uid = uuid.uuid4()
    pref = InvestmentPreferences(user_id=uid)
    link = TelegramLink(user_id=uid, chat_id=4242)
    item = WatchlistItem(user_id=uid, ticker="NVDA", asset_type="STOCK")
    plan = ContributionPlan(
        user_id=uid,
        amount_eur=500,
        whole_shares=False,
        total_before_eur=4000,
        leftover_eur=0,
        notes=["a note"],
    )
    db_session.add_all([pref, link, item, plan])
    db_session.commit()
    db_session.add(
        ContributionPlanLine(
            user_id=uid,
            plan_id=plan.id,
            ticker="NVDA",
            name="NVDA",
            amount_eur=264.71,
            shares=2.647,
            price_eur=100,
            currency="USD",
            rate=0.8,
            reason="new_position",
        )
    )
    db_session.commit()
    for row in (pref, link, item, plan):
        db_session.refresh(row)
    assert pref.monthly_contribution is None and float(pref.drift_threshold_pct) == 5.0
    assert link.plan_reminder_enabled is True
    assert item.target_weight is None
    assert plan.created_at is not None and plan.notes == ["a note"]
