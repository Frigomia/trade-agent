import asyncio

from app.agents.chat import build_portfolio_context
from app.config import settings
from app.models import Holding, Recommendation, WatchlistItem


def test_build_portfolio_context_includes_holdings_watchlist_recommendations(db_session):
    db_session.add(
        Holding(
            user_id=settings.default_user_id,
            ticker="AAPL",
            name="Apple Inc.",
            asset_type="STOCK",
            shares=10,
            cost_basis=150.0,
            first_purchase_date="2025-01-01",
            target_weight=0.2,
        )
    )
    db_session.add(
        WatchlistItem(user_id=settings.default_user_id, ticker="MSFT", asset_type="STOCK")
    )
    db_session.add(
        Recommendation(
            user_id=settings.default_user_id,
            ticker="AAPL",
            asset_type="STOCK",
            action="HOLD",
            reasoning=["PEG 1.1"],
        )
    )
    db_session.commit()

    context = asyncio.run(build_portfolio_context(db_session))

    assert "AAPL" in context
    assert "MSFT" in context
    assert "HOLD" in context


def test_build_portfolio_context_handles_empty_portfolio(db_session):
    context = asyncio.run(build_portfolio_context(db_session))

    assert isinstance(context, str)
    assert context != ""
