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
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window_seconds)
        if count > limit:
            raise HTTPException(status_code=429, detail="Rate limit exceeded, try again shortly")

    return _check
