import httpx

from app.config import settings

EMBEDDING_MODEL = "voyage-finance-2"
VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings"


async def embed_text(text: str) -> list[float]:
    if not settings.voyage_api_key:
        raise RuntimeError("VOYAGE_API_KEY not configured")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            VOYAGE_EMBEDDINGS_URL,
            headers={"Authorization": f"Bearer {settings.voyage_api_key}"},
            json={"input": [text], "model": EMBEDDING_MODEL},
        )
        response.raise_for_status()
        embedding: list[float] = response.json()["data"][0]["embedding"]
        return embedding
