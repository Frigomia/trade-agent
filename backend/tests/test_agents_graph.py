import asyncio
from unittest.mock import AsyncMock, patch

from app.agents.graph import run_graph_for_ticker
from tests.auth_support import USER_ID


def test_run_graph_for_stock_produces_buy_recommendation():
    quote = {
        "price": 86.0,
        "closes": [100.0] * 200 + [100.0 - i for i in range(1, 15)],
    }
    fundamentals = {
        "peg_ratio": 0.9,
        "roe": 0.22,
        "debt_to_equity": 0.3,
        "revenue_growth": 0.18,
        "profit_margin": 0.20,
    }
    with (
        patch("app.agents.market_data.fetch_quote_and_history", AsyncMock(return_value=quote)),
        patch("app.agents.market_data.fetch_fundamentals", AsyncMock(return_value=fundamentals)),
        patch("app.agents.context.build_context", AsyncMock(return_value="Some context")),
        patch("app.agents.news.run_news_agent", AsyncMock(return_value="Qualitative color")),
    ):
        result = asyncio.run(run_graph_for_ticker(USER_ID, "AAPL", "STOCK", is_held=False))

    assert result["fundamental_score"] == 100
    assert result["technical_signal"] == "OVERSOLD"
    assert result["action"] == "BUY"
    assert result["suggested_position_pct"] == 0.15
    assert result["context"] == "Some context"
    assert result["ai_analysis"] == "Qualitative color"


def test_run_graph_for_etf_skips_fundamentals_news_and_context_on_hold():
    quote = {"price": 100.0, "closes": [100.0] * 220}
    with (
        patch("app.agents.market_data.fetch_quote_and_history", AsyncMock(return_value=quote)),
        patch("app.agents.market_data.fetch_fundamentals", AsyncMock()) as mock_fundamentals,
        patch("app.agents.context.build_context", AsyncMock()) as mock_context,
        patch("app.agents.news.run_news_agent", AsyncMock(return_value=None)) as mock_news,
    ):
        result = asyncio.run(run_graph_for_ticker(USER_ID, "VWCE", "ETF", is_held=True))

    mock_fundamentals.assert_not_called()
    assert result["fundamental_score"] is None
    assert result["action"] == "HOLD"
    mock_context.assert_not_called()
    assert result["context"] is None
    mock_news.assert_not_called()
    assert result["ai_analysis"] is None


def test_run_graph_for_stock_with_no_fundamentals_data_skips_scoring():
    quote = {"price": 100.0, "closes": [100.0] * 220}
    empty_fundamentals = {
        "peg_ratio": None,
        "roe": None,
        "debt_to_equity": None,
        "revenue_growth": None,
        "profit_margin": None,
    }
    with (
        patch("app.agents.market_data.fetch_quote_and_history", AsyncMock(return_value=quote)),
        patch(
            "app.agents.market_data.fetch_fundamentals",
            AsyncMock(return_value=empty_fundamentals),
        ),
        patch("app.agents.context.build_context", AsyncMock()) as mock_context,
        patch("app.agents.news.run_news_agent", AsyncMock(return_value=None)) as mock_news,
    ):
        result = asyncio.run(run_graph_for_ticker(USER_ID, "AAPL", "STOCK", is_held=True))

    assert result["fundamental_score"] is None
    assert result["action"] is None
    mock_context.assert_not_called()
    assert result["context"] is None
    mock_news.assert_not_called()


def test_a_failing_web_opinion_does_not_discard_the_recommendation():
    quote = {
        "price": 86.0,
        "closes": [100.0] * 200 + [100.0 - i for i in range(1, 15)],
    }
    fundamentals = {
        "peg_ratio": 0.9,
        "roe": 0.22,
        "debt_to_equity": 0.3,
        "revenue_growth": 0.18,
        "profit_margin": 0.20,
    }
    with (
        patch("app.agents.market_data.fetch_quote_and_history", AsyncMock(return_value=quote)),
        patch("app.agents.market_data.fetch_fundamentals", AsyncMock(return_value=fundamentals)),
        patch("app.agents.context.build_context", AsyncMock(return_value="Some context")),
        patch(
            "app.agents.news.run_news_agent",
            AsyncMock(side_effect=RuntimeError("credit balance is too low")),
        ),
    ):
        result = asyncio.run(run_graph_for_ticker(USER_ID, "AAPL", "STOCK", is_held=False))

    assert result["action"] == "BUY"
    assert result["fundamental_score"] == 100
    assert result["ai_analysis"] is None
