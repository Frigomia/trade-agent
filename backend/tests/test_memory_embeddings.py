import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import settings
from app.memory import embeddings


def test_embed_text_raises_without_api_key(monkeypatch):
    monkeypatch.setattr(settings, "voyage_api_key", None)

    with pytest.raises(RuntimeError):
        asyncio.run(embeddings.embed_text("test"))


def test_embed_text_calls_voyage_api(monkeypatch):
    monkeypatch.setattr(settings, "voyage_api_key", "test-key")

    fake_response = MagicMock()
    fake_response.json.return_value = {"data": [{"embedding": [0.1, 0.2, 0.3]}]}

    mock_client = MagicMock()
    mock_client.post = AsyncMock(return_value=fake_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.memory.embeddings.httpx.AsyncClient", return_value=mock_client):
        result = asyncio.run(embeddings.embed_text("AAPL BUY"))

    assert result == [0.1, 0.2, 0.3]
    fake_response.raise_for_status.assert_called_once()
    call_kwargs = mock_client.post.call_args.kwargs
    assert call_kwargs["headers"]["Authorization"] == "Bearer test-key"
    assert call_kwargs["json"] == {"input": ["AAPL BUY"], "model": embeddings.EMBEDDING_MODEL}
