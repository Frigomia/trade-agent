import asyncio

import voyageai

from app.config import settings

EMBEDDING_MODEL = "voyage-finance-2"

_client: voyageai.Client | None = None  # type: ignore[name-defined]


def _get_client() -> voyageai.Client:  # type: ignore[name-defined]
    global _client
    if not settings.voyage_api_key:
        raise RuntimeError("VOYAGE_API_KEY not configured")
    if _client is None:
        _client = voyageai.Client(api_key=settings.voyage_api_key)  # type: ignore[attr-defined]
    return _client


async def embed_text(text: str) -> list[float]:
    client = _get_client()

    def _embed() -> list[float]:
        result = client.embed([text], model=EMBEDDING_MODEL)
        embedding: list[float] = result.embeddings[0]
        return embedding

    return await asyncio.to_thread(_embed)
