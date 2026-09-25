from collections.abc import Awaitable, Callable

from fastapi import HTTPException, Request

from app.redis_client import get_redis


def rate_limiter(
    key_prefix: str, limit: int, window_seconds: int = 60
) -> Callable[[Request], Awaitable[None]]:
    async def _check(request: Request) -> None:
        client_ip = request.client.host if request.client else "unknown"
        key = f"ratelimit:{key_prefix}:{client_ip}"
        redis = get_redis()
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window_seconds)
        if count > limit:
            raise HTTPException(status_code=429, detail="Rate limit exceeded, try again shortly")

    return _check
