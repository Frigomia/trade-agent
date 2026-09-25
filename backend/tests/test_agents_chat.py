import asyncio
from unittest.mock import MagicMock, patch

import pytest

from app.agents import chat as chat_module
from app.agents.chat import build_portfolio_context, run_chat
from app.config import settings
from app.models import ChatMessage, Holding, Recommendation, WatchlistItem


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


def test_run_chat_raises_without_api_key(monkeypatch, db_session):
    monkeypatch.setattr(settings, "anthropic_api_key", None)

    with pytest.raises(RuntimeError):
        asyncio.run(run_chat(db_session, "session-1", "hello", history=[]))


def test_run_chat_calls_claude_with_history_and_web_search(monkeypatch, db_session):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    chat_module._client = None

    prior = ChatMessage(
        user_id=settings.default_user_id,
        session_id="session-1",
        role="user",
        content="what's my AAPL position?",
    )

    fake_block = MagicMock()
    fake_block.type = "text"
    fake_block.text = "You hold 10 shares of AAPL."
    fake_response = MagicMock()
    fake_response.content = [fake_block]

    with patch("app.agents.chat.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = fake_response
        mock_anthropic_cls.return_value = mock_client

        result = asyncio.run(run_chat(db_session, "session-1", "should I sell?", history=[prior]))

    assert result == "You hold 10 shares of AAPL."
    call_kwargs = mock_client.messages.create.call_args.kwargs
    assert call_kwargs["model"] == settings.anthropic_model
    assert call_kwargs["tools"][0]["type"] == "web_search_20260209"
    assert "untrusted" in call_kwargs["system"].lower()
    messages = call_kwargs["messages"]
    assert messages[0] == {"role": "user", "content": "what's my AAPL position?"}
    assert messages[-1] == {"role": "user", "content": "should I sell?"}


def test_run_chat_accepts_empty_history(monkeypatch, db_session):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    chat_module._client = None

    fake_block = MagicMock()
    fake_block.type = "text"
    fake_block.text = "Hi, how can I help?"
    fake_response = MagicMock()
    fake_response.content = [fake_block]

    with patch("app.agents.chat.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = fake_response
        mock_anthropic_cls.return_value = mock_client

        result = asyncio.run(run_chat(db_session, "brand-new-session", "hello", history=[]))

    assert result == "Hi, how can I help?"
    messages = mock_client.messages.create.call_args.kwargs["messages"]
    assert messages == [{"role": "user", "content": "hello"}]


def test_run_chat_raises_on_no_text_blocks(monkeypatch, db_session):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    chat_module._client = None

    fake_response = MagicMock()
    fake_response.content = []
    fake_response.stop_reason = "pause_turn"

    with patch("app.agents.chat.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = fake_response
        mock_anthropic_cls.return_value = mock_client

        with pytest.raises(RuntimeError):
            asyncio.run(run_chat(db_session, "session-1", "hello", history=[]))
