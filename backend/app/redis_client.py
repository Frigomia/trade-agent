from redis.asyncio import Redis

from app.config import settings

_redis: Redis | None = None

# Deletes the marker only if it still holds this job's id (a newer job may own it by now).
# Lua runs atomically inside Redis, so the compare and the delete cannot be interleaved.
_RELEASE_IF_MINE = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis
