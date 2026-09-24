import asyncio
from unittest.mock import MagicMock, patch

from app.agents import news
from app.config import settings


def test_run_news_agent_returns_none_without_api_key(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    news._client = None

    result = asyncio.run(news.run_news_agent("AAPL", "BUY", ["reason"]))

    assert result is None


def test_run_news_agent_calls_claude_with_web_search(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    news._client = None

    fake_block = MagicMock()
    fake_block.type = "text"
    fake_block.text = "Recent news looks positive."
    fake_response = MagicMock()
    fake_response.content = [fake_block]

    with patch("app.agents.news.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = fake_response
        mock_anthropic_cls.return_value = mock_client

        result = asyncio.run(news.run_news_agent("AAPL", "BUY", ["PEG 1.1"]))

    assert result == "Recent news looks positive."
    call_kwargs = mock_client.messages.create.call_args.kwargs
    assert call_kwargs["model"] == settings.anthropic_model
    assert call_kwargs["tools"][0]["type"] == "web_search_20260209"
    assert "untrusted DATA" in call_kwargs["system"]
