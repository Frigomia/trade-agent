"""Monthly usage caps: Redis counters, one per user per kind, keyed by calendar month.

Parallel in shape to app.rate_limit's per-minute burst limiter, but counts across a month
instead of a 60-second window, and is checked against a per-user override (app_users, falling
back to a system default in Settings) instead of a fixed number.
"""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Protocol

from fastapi import Depends

from app.auth.deps import CurrentUser, get_current_user
from app.config import Settings, settings
from app.redis_client import get_redis

# Outlives any calendar month (max 31 days) with slack, so a stale key always expires on its
# own; no scheduled reset job is needed.
_MONTH_TTL_SECONDS = 40 * 24 * 60 * 60

KIND_LABELS: dict[str, str] = {
    "analysis_run": "analysis runs",
    "chat": "chat messages",
}


class UsageLimitExceeded(Exception):
    """Domain exception: user_id has used up its monthly allowance for kind. Routers never raise
    HTTPException directly; main.py's exception handler maps this to a 429."""

    def __init__(self, kind: str, limit: int) -> None:
        self.kind = kind
        self.limit = limit
        super().__init__(f"Monthly limit reached for {kind}: {limit}")


class _HasLimits(Protocol):
    """Structural type: AppUser and CurrentUser both have these two attributes. Declared
    read-only (via @property) so CurrentUser, a frozen dataclass, satisfies it under mypy
    strict mode: a plain attribute annotation would require a settable variable."""

    @property
    def monthly_analysis_limit(self) -> int | None: ...
    @property
    def monthly_chat_limit(self) -> int | None: ...


def effective_limit(user: _HasLimits, kind: str, settings: Settings) -> int:
    """The user's override if one is set, else the matching system default."""
    if kind == "analysis_run":
        if user.monthly_analysis_limit is not None:
            return user.monthly_analysis_limit
        return settings.default_monthly_analysis_limit
    if kind == "chat":
        if user.monthly_chat_limit is not None:
            return user.monthly_chat_limit
        return settings.default_monthly_chat_limit
    raise ValueError(f"Unknown usage kind: {kind!r}")


def _usage_key(kind: str, user_id: str) -> str:
    year_month = datetime.now(UTC).strftime("%Y-%m")
    return f"usage:{kind}:{user_id}:{year_month}"


async def check_and_increment_usage(kind: str, user_id: str, limit: int) -> None:
    """Increments this month's counter for user_id/kind, then raises UsageLimitExceeded if that
    pushed it over limit. The call that reaches exactly `limit` still succeeds; the next one is
    the first rejection (matches app.rate_limit's own off-by-one). A limit of 0 rejects the very
    first call, since count starts at 1."""
    redis = get_redis()
    key = _usage_key(kind, user_id)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, _MONTH_TTL_SECONDS)
    if count > limit:
        raise UsageLimitExceeded(kind, limit)


async def get_usage(kind: str, user_id: str) -> int:
    """This month's count so far, without incrementing it."""
    redis = get_redis()
    value = await redis.get(_usage_key(kind, user_id))
    return int(value) if value is not None else 0


def check_monthly_usage(kind: str) -> Callable[..., Awaitable[None]]:
    """FastAPI dependency factory: add as a route dependency to enforce kind's monthly cap."""

    async def _check(user: CurrentUser = Depends(get_current_user)) -> None:
        limit = effective_limit(user, kind, settings)
        await check_and_increment_usage(kind, str(user.id), limit)

    return _check
