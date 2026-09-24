import asyncio

from app.redis_client import get_redis


def test_redis_roundtrip():
    async def _run() -> None:
        redis = get_redis()
        await redis.set("test:roundtrip", "hello", ex=5)
        value = await redis.get("test:roundtrip")
        assert value == "hello"
        await redis.delete("test:roundtrip")

    asyncio.run(_run())
