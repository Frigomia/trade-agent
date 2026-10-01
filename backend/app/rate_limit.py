from collections.abc import Awaitable, Callable

from fastapi import Depends, HTTPException

from app.auth.deps import CurrentUser, get_current_user
from app.redis_client import get_redis


def rate_limiter(
    key_prefix: str, limit: int, window_seconds: int = 60
) -> Callable[..., Awaitable[None]]:
    async def _check(user: CurrentUser = Depends(get_current_user)) -> None:
        key = f"ratelimit:{key_prefix}:{user.id}"
        redis = get_redis()
        # One MULTI/EXEC round trip: create the key with its TTL if it is missing (NX), then
        # count. Two separate calls could die in between and leave a key that never expires.
        async with redis.pipeline(transaction=True) as pipe:
            pipe.set(key, 0, ex=window_seconds, nx=True)
            pipe.incr(key)
            _, count = await pipe.execute()
        if count > limit:
            raise HTTPException(status_code=429, detail="Rate limit exceeded, try again shortly")

    return _check
