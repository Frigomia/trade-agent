"""Monthly usage caps: Redis counters, one per user per kind, keyed by calendar month.

Parallel in shape to app.rate_limit's per-minute burst limiter, but counts across a month
instead of a 60-second window, and is checked against a per-user override (app_users, falling
back to a system default in Settings) instead of a fixed number.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from fastapi import Depends
from sqlalchemy.orm import Session, sessionmaker

from app.auth.deps import CurrentUser, get_current_user
from app.config import Settings, settings
from app.db import get_session_factory
from app.models import AppSettings
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


@dataclass(frozen=True)
class LimitDefaults:
    """The monthly limits a user without a personal override gets."""

    analysis_runs: int
    chat_messages: int


def load_limit_defaults(db: Session, settings: Settings) -> LimitDefaults:
    """The admin-set defaults from app_settings, each falling back to the environment value when
    the row (or that column) is empty."""
    # A missing row behaves like a row of NULLs; the transient object is never added to the session.
    row = db.get(AppSettings, 1) or AppSettings()
    analysis = row.default_monthly_analysis_limit
    chat = row.default_monthly_chat_limit
    return LimitDefaults(
        analysis_runs=analysis if analysis is not None else settings.default_monthly_analysis_limit,
        chat_messages=chat if chat is not None else settings.default_monthly_chat_limit,
    )


def get_limit_defaults(
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> LimitDefaults:
    """Route dependency. A plain session is enough: app_settings has no per-user scoping."""
    with factory() as db:
        return load_limit_defaults(db, settings)


def effective_limit(user: _HasLimits, kind: str, defaults: LimitDefaults) -> int:
    """The user's override if one is set, else the matching system default."""
    if kind == "analysis_run":
        if user.monthly_analysis_limit is not None:
            return user.monthly_analysis_limit
        return defaults.analysis_runs
    if kind == "chat":
        if user.monthly_chat_limit is not None:
            return user.monthly_chat_limit
        return defaults.chat_messages
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
        await redis.decr(key)
        raise UsageLimitExceeded(kind, limit)


# Decrements only while the value is above 0 and never creates the key. One atomic step in Redis.
_REFUND = """
local v = tonumber(redis.call('get', KEYS[1]))
if v and v > 0 then
    return redis.call('decr', KEYS[1])
end
return 0
"""


async def refund_usage(kind: str, user_id: str) -> None:
    """Gives back one unit of this month's count (a run that was counted but never started).
    Never goes below 0 and never creates the counter."""
    await get_redis().eval(_REFUND, 1, _usage_key(kind, user_id))


async def get_usage(kind: str, user_id: str) -> int:
    """This month's count so far, without incrementing it."""
    redis = get_redis()
    value = await redis.get(_usage_key(kind, user_id))
    return int(value) if value is not None else 0


# The reservation token and the original month counter change in one atomic operation.
_RESERVE_COMPANY = """
if redis.call('get', KEYS[3]) ~= ARGV[3] then return -2 end
if redis.call('exists', KEYS[2]) == 1 then return 0 end
local count = tonumber(redis.call('get', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return -1 end
redis.call('incr', KEYS[1])
redis.call('expire', KEYS[1], ARGV[2])
redis.call('set', KEYS[2], 'reserved', 'EX', ARGV[2])
return 1
"""
_REFUND_COMPANY = """
if redis.call('get', KEYS[2]) ~= 'reserved' then return 0 end
local count = tonumber(redis.call('get', KEYS[1]) or '0')
if count > 0 then redis.call('decr', KEYS[1]) end
redis.call('set', KEYS[2], 'refunded', 'EX', ARGV[1])
return 1
"""


class RunClaimLost(Exception):
    """The job no longer owns the shared analysis claim; it must not spend quota."""


async def reserve_company_usage(job_id: str, key: str, limit: int, claim_key: str) -> None:
    result = await get_redis().eval(
        _RESERVE_COMPANY,
        3,
        key,
        f"company_usage:{job_id}",
        claim_key,
        limit,
        _MONTH_TTL_SECONDS,
        job_id,
    )
    if result == -1:
        raise UsageLimitExceeded("analysis_run", limit)
    if result == -2:
        raise RunClaimLost


async def refund_company_usage(job_id: str, key: str) -> None:
    await get_redis().eval(_REFUND_COMPANY, 2, key, f"company_usage:{job_id}", _MONTH_TTL_SECONDS)


def check_monthly_usage(kind: str) -> Callable[..., Awaitable[None]]:
    """FastAPI dependency factory: add as a route dependency to enforce kind's monthly cap."""

    async def _check(
        user: CurrentUser = Depends(get_current_user),
        defaults: LimitDefaults = Depends(get_limit_defaults),
    ) -> None:
        limit = effective_limit(user, kind, defaults)
        await check_and_increment_usage(kind, str(user.id), limit)

    return _check
