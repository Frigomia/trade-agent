import asyncio
from unittest.mock import MagicMock, patch

import pytest

from app.config import settings
from app.memory import embeddings


def test_embed_text_raises_without_api_key(monkeypatch):
    monkeypatch.setattr(settings, "voyage_api_key", None)
    embeddings._client = None

    with pytest.raises(RuntimeError):
        asyncio.run(embeddings.embed_text("test"))


def test_embed_text_calls_voyage_client(monkeypatch):
    monkeypatch.setattr(settings, "voyage_api_key", "test-key")
    embeddings._client = None

    fake_result = MagicMock()
    fake_result.embeddings = [[0.1, 0.2, 0.3]]

    with patch("app.memory.embeddings.voyageai.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.embed.return_value = fake_result
        mock_client_cls.return_value = mock_client

        result = asyncio.run(embeddings.embed_text("AAPL BUY"))

    assert result == [0.1, 0.2, 0.3]
    mock_client.embed.assert_called_once_with(["AAPL BUY"], model=embeddings.EMBEDDING_MODEL)
