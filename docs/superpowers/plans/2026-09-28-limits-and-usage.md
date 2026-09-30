# Limits and Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each user an admin-configurable monthly cap on analysis runs and chat messages, make the existing burst rate limiter per-user instead of per-IP, and let a user export or delete their own data.

**Architecture:** Two nullable override columns on `app_users` plus system defaults in `Settings`; a new `app/usage.py` module tracks monthly counts in Redis (parallel in shape to the existing `app/rate_limit.py`) and is wired into `/analysis/run` and `/chat` as a FastAPI dependency; the admin API gains a `PATCH .../limits` route and four read-only fields on the user list; `/me` gains `usage`, `export`, and `data` (delete) routes, reusing a shared delete-helper extracted from the admin's existing "remove user" flow.

**Tech Stack:** FastAPI, SQLAlchemy 2 (sync), Alembic, Redis (`redis.asyncio`), Pydantic v2.

**Spec:** `docs/superpowers/specs/2026-09-28-limits-and-usage-design.md`

## Global Constraints

- The system never places a trade; no code in this plan calls a broker API.
- The admin never sees financial data — the four new admin-list fields are counts only.
- Self-service export and delete always run through `get_user_db` (the caller's own RLS-scoped session), never a bypass connection.
- Calm, generic error messages: the monthly-limit `429` names the kind and says "Resets next month, or ask your admin to raise it."; no raw Redis or SQL error ever reaches a response.
- Services raise domain exceptions (never `HTTPException` from `app/usage.py` or `app/admin/service.py`); `main.py` is the one place they become HTTP responses.
- Self-service data deletion is data-only: the account, login, and `app_users` row are untouched. Full self-offboarding is out of scope.
- The runtime role's `app_users` grant stays column-scoped: the new columns join the allowed `UPDATE` list, but `id`, `email`, and `role` are never grantable.
- No secrets or `.env` values committed; Conventional Commits; `docs/ARCHITECTURE.md` updated in the same PR that changes the API or data model.
- Migrations are only ever created through the `alembic` CLI, then hand-edited for the manual grant statements — never hand-written from scratch.

## Review Focus

- Two different users behind the same simulated client IP must each get their own rate-limit budget once the burst limiter is keyed by user id — a regression test proves this, since today they'd throttle each other (Task 3).
- An admin clearing an override with an explicit `null` must differ from simply omitting that field in the same `PATCH` body — omitted leaves the existing override untouched, `null` clears it back to the default (Task 6).
- A monthly limit of `0` must reject the very first call of the period, not just the second — the off-by-one logic must not special-case an empty counter (Task 2).
- `/me/usage`, `/me/export`, and `DELETE /me/data` must all be closed to an `invited` user (403), not just to an anonymous caller — invited users can otherwise reach `/me` and `/me/accept` only (Task 7).
- `/me/export` must return only the caller's own rows even when another user's rows exist in the same tables — proven against a second seeded user, the same way 2b's isolation tests work (Task 7).

---

### Task 1: Data model — override columns, defaults, and the auth path

**Files:**
- Modify: `backend/app/models.py` (`AppUser`)
- Modify: `backend/app/config.py` (`Settings`)
- Modify: `backend/app/rls.py` (`APP_USERS_UPDATABLE_COLUMNS`)
- Modify: `backend/app/auth/deps.py` (`CurrentUser`, `_authenticate`)
- Modify: `backend/tests/auth_support.py` (`add_app_user`)
- Create: `backend/migrations/versions/<generated>_add_monthly_limits_to_app_users.py`
- Test: `backend/tests/test_app_users_privileges.py`

**Interfaces:**
- Produces: `AppUser.monthly_analysis_limit: int | None`, `AppUser.monthly_chat_limit: int | None`; `Settings.default_monthly_analysis_limit: int`, `Settings.default_monthly_chat_limit: int`; `CurrentUser.monthly_analysis_limit: int | None`, `CurrentUser.monthly_chat_limit: int | None` (both default `None`); `add_app_user(..., monthly_analysis_limit: int | None = None, monthly_chat_limit: int | None = None)`.

- [ ] **Step 1: Add the two columns to `AppUser`**

In `backend/app/models.py`, add to the `AppUser` class, right after `invited_at`:

```python
    invited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # NULL means "use Settings.default_monthly_*_limit". Set only by the admin API.
    monthly_analysis_limit: Mapped[int | None] = mapped_column(nullable=True)
    monthly_chat_limit: Mapped[int | None] = mapped_column(nullable=True)
```

- [ ] **Step 2: Add the system defaults to `Settings`**

In `backend/app/config.py`, add after `invite_link_hours`:

```python
    invite_link_hours: int = 24  # display hint only; Supabase enforces the real link expiry

    default_monthly_analysis_limit: int = 100
    default_monthly_chat_limit: int = 500
```

- [ ] **Step 3: Extend the narrowed `app_users` grant list**

In `backend/app/rls.py`, change `APP_USERS_UPDATABLE_COLUMNS`:

```python
APP_USERS_UPDATABLE_COLUMNS: tuple[str, ...] = (
    "status",
    "accepted_terms_at",
    "last_seen_at",
    "invited_at",
    "monthly_analysis_limit",
    "monthly_chat_limit",
)
```

- [ ] **Step 4: Add the two fields to `CurrentUser` and populate them**

In `backend/app/auth/deps.py`:

```python
@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    email: str
    role: str
    monthly_analysis_limit: int | None = None
    monthly_chat_limit: int | None = None
```

And in `_authenticate`, change:

```python
        current = CurrentUser(id=row.id, email=row.email, role=row.role)
```

to:

```python
        current = CurrentUser(
            id=row.id,
            email=row.email,
            role=row.role,
            monthly_analysis_limit=row.monthly_analysis_limit,
            monthly_chat_limit=row.monthly_chat_limit,
        )
```

- [ ] **Step 5: Extend the `add_app_user` test helper**

In `backend/tests/auth_support.py`, change the `add_app_user` signature and body:

```python
def add_app_user(
    session: Session,
    user_id: uuid.UUID = USER_ID,
    *,
    role: str = "user",
    status: str = "active",
    email: str | None = None,
    invited_at: datetime | None = None,
    monthly_analysis_limit: int | None = None,
    monthly_chat_limit: int | None = None,
) -> AppUser:
    user = AppUser(
        id=user_id,
        email=email or f"{user_id}@example.com",
        role=role,
        status=status,
        invited_at=invited_at,
        monthly_analysis_limit=monthly_analysis_limit,
        monthly_chat_limit=monthly_chat_limit,
    )
    session.add(user)
    session.commit()
    return user
```

- [ ] **Step 6: Generate the migration**

```bash
cd backend
uv run alembic heads
```

Expected: `bbd35edc6948 (head)`. If it isn't, stop and report — this task assumes it's the current head.

```bash
uv run alembic revision --autogenerate -m "add monthly limits to app_users"
```

This creates `backend/migrations/versions/<newhash>_add_monthly_limits_to_app_users.py` with a generated `revision`, `down_revision = 'bbd35edc6948'`, and an `upgrade()`/`downgrade()` pair that only adds/drops the two columns. Open it and confirm the generated `upgrade()` has two `op.add_column('app_users', ...)` calls for `monthly_analysis_limit` and `monthly_chat_limit` (both `sa.Integer()`, `nullable=True`). Leave the generated column code as-is.

- [ ] **Step 7: Hand-edit the migration to widen the runtime grant**

In the same generated file, edit `upgrade()` to add the grant statements after the two `add_column` calls (mirrors `bbd35edc6948_add_invited_at_to_app_users.py`):

```python
def upgrade() -> None:
    op.add_column('app_users', sa.Column('monthly_analysis_limit', sa.Integer(), nullable=True))
    op.add_column('app_users', sa.Column('monthly_chat_limit', sa.Integer(), nullable=True))
    op.execute("REVOKE UPDATE ON app_users FROM trading_agent_app")
    op.execute(
        "GRANT UPDATE (status, accepted_terms_at, last_seen_at, invited_at, "
        "monthly_analysis_limit, monthly_chat_limit) ON app_users TO trading_agent_app"
    )
```

And `downgrade()`:

```python
def downgrade() -> None:
    op.execute(
        "REVOKE UPDATE (status, accepted_terms_at, last_seen_at, invited_at, "
        "monthly_analysis_limit, monthly_chat_limit) ON app_users FROM trading_agent_app"
    )
    op.execute(
        "GRANT UPDATE (status, accepted_terms_at, last_seen_at, invited_at) "
        "ON app_users TO trading_agent_app"
    )
    op.drop_column('app_users', 'monthly_chat_limit')
    op.drop_column('app_users', 'monthly_analysis_limit')
```

- [ ] **Step 8: Apply the migration to the local Docker test/dev database**

```bash
cd backend
uv run alembic upgrade head
```

Expected: no errors. (If `.env`'s `DATABASE_URL`/`MIGRATION_DATABASE_URL` point anywhere other than local Docker Postgres, STOP and report before running this — do not run migrations against a real/remote database. `backend/CLAUDE.md` and `docs/ARCHITECTURE.md` §13 describe the safe local setup.)

- [ ] **Step 9: Extend the column-privilege tests**

In `backend/tests/test_app_users_privileges.py`, change the parametrize list on `test_runtime_role_can_update_the_lifecycle_columns`:

```python
@pytest.mark.parametrize(
    "column",
    [
        "status",
        "accepted_terms_at",
        "last_seen_at",
        "invited_at",
        "monthly_analysis_limit",
        "monthly_chat_limit",
    ],
)
def test_runtime_role_can_update_the_lifecycle_columns(engine, column):
    assert _can_update(engine, column) is True
```

`test_runtime_role_cannot_update_identity_columns` (the `id`/`email`/`role`/`created_at` parametrize) is unchanged.

- [ ] **Step 10: Run the full test suite and lint**

```bash
cd backend
uv run python -m pytest tests/ -v
uv run ruff check . && uv run ruff format --check .
uv run mypy app
```

Expected: all pass. (Docker Postgres/Redis must be running: `docker compose up -d`.)

- [ ] **Step 11: Commit**

```bash
git add backend/app/models.py backend/app/config.py backend/app/rls.py backend/app/auth/deps.py backend/tests/auth_support.py backend/tests/test_app_users_privileges.py backend/migrations/versions/
git commit -m "feat: add per-user monthly limit overrides to app_users"
```

---

### Task 2: `app/usage.py` — monthly usage counters

**Files:**
- Create: `backend/app/usage.py`
- Modify: `backend/app/main.py` (exception handler)
- Modify: `backend/tests/conftest.py` (`_flush_rate_limit_keys`)
- Test: `backend/tests/test_usage.py`

**Interfaces:**
- Consumes: `CurrentUser`, `get_current_user` from `app.auth.deps` (Task 1); `Settings` from `app.config`; `get_redis` from `app.redis_client`.
- Produces: `UsageLimitExceeded(kind: str, limit: int)`; `KIND_LABELS: dict[str, str]`; `async check_and_increment_usage(kind: str, user_id: str, limit: int) -> None`; `async get_usage(kind: str, user_id: str) -> int`; `effective_limit(user, kind: str, settings: Settings) -> int`; `check_monthly_usage(kind: str) -> Callable[..., Awaitable[None]]` (a FastAPI dependency factory, used by Task 4).

- [ ] **Step 1: Write `app/usage.py`**

```python
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
    """Structural type: AppUser and CurrentUser both have these two attributes."""

    monthly_analysis_limit: int | None
    monthly_chat_limit: int | None


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
```

- [ ] **Step 2: Wire the exception handler in `main.py`**

In `backend/app/main.py`, add the import and a second handler:

```python
from app.admin.service import AdminError
from app.usage import KIND_LABELS, UsageLimitExceeded
```

```python
@app.exception_handler(UsageLimitExceeded)
def usage_limit_handler(request: Request, exc: UsageLimitExceeded) -> JSONResponse:
    """Services raise domain errors; this is the one place they become HTTP responses."""
    label = KIND_LABELS[exc.kind]
    detail = (
        f"Monthly limit reached ({exc.limit} {label} this month). "
        "Resets next month, or ask your admin to raise it."
    )
    return JSONResponse(status_code=429, content={"detail": detail})
```

- [ ] **Step 3: Flush `usage:*` Redis keys between tests**

In `backend/tests/conftest.py`, change the `_flush_rate_limit_keys` fixture body to also clear usage counters (same fixture, same reasoning — the `client`/`admin_client` fixtures always use the same test user ids, so a leftover count from an earlier test would cause a spurious 429):

```python
@pytest.fixture(autouse=True)
def _flush_rate_limit_keys() -> None:
    # Starlette's TestClient reports a fixed fake client IP ("testclient") for every request, and
    # the client/admin_client fixtures reuse the same user ids across tests, so both the burst
    # limiter's and the usage counter's Redis keys must be flushed before each test, or leftover
    # counts from a previous test cause a spurious 429. Uses its own throwaway event loop and
    # resets the client singleton afterward, same reason as _reset_redis_client below.
    async def _flush() -> None:
        redis = redis_client_module.get_redis()
        async for key in redis.scan_iter("ratelimit:*"):
            await redis.delete(key)
        async for key in redis.scan_iter("usage:*"):
            await redis.delete(key)

    asyncio.run(_flush())
    redis_client_module._redis = None
```

- [ ] **Step 4: Write `tests/test_usage.py`**

```python
import asyncio
import uuid

import pytest

from app.auth.deps import CurrentUser
from app.config import Settings
from app.usage import (
    UsageLimitExceeded,
    _usage_key,
    check_and_increment_usage,
    effective_limit,
    get_usage,
)


def test_check_and_increment_usage_allows_up_to_the_limit():
    user_id = str(uuid.uuid4())

    async def _run() -> None:
        for _ in range(3):
            await check_and_increment_usage("test_kind", user_id, limit=3)

    asyncio.run(_run())  # no exception


def test_check_and_increment_usage_raises_on_the_call_past_the_limit():
    user_id = str(uuid.uuid4())

    async def _run() -> None:
        for _ in range(3):
            await check_and_increment_usage("test_kind", user_id, limit=3)
        with pytest.raises(UsageLimitExceeded) as exc_info:
            await check_and_increment_usage("test_kind", user_id, limit=3)
        assert exc_info.value.kind == "test_kind"
        assert exc_info.value.limit == 3

    asyncio.run(_run())


def test_check_and_increment_usage_rejects_even_the_first_call_when_limit_is_zero():
    user_id = str(uuid.uuid4())

    async def _run() -> None:
        with pytest.raises(UsageLimitExceeded):
            await check_and_increment_usage("test_kind", user_id, limit=0)

    asyncio.run(_run())


def test_get_usage_reads_without_incrementing():
    user_id = str(uuid.uuid4())

    async def _run() -> int:
        await check_and_increment_usage("test_kind", user_id, limit=10)
        await check_and_increment_usage("test_kind", user_id, limit=10)
        return await get_usage("test_kind", user_id)

    assert asyncio.run(_run()) == 2


def test_get_usage_is_zero_for_a_user_with_no_calls_yet():
    assert asyncio.run(get_usage("test_kind", str(uuid.uuid4()))) == 0


def test_usage_key_is_scoped_to_the_calendar_month():
    key = _usage_key("chat", "user-1")
    prefix, kind, user_id, year_month = key.split(":")
    assert (prefix, kind, user_id) == ("usage", "chat", "user-1")
    assert len(year_month) == 7  # "YYYY-MM"


def _current_user(*, monthly_analysis_limit=None, monthly_chat_limit=None) -> CurrentUser:
    return CurrentUser(
        id=uuid.uuid4(),
        email="u@example.com",
        role="user",
        monthly_analysis_limit=monthly_analysis_limit,
        monthly_chat_limit=monthly_chat_limit,
    )


def test_effective_limit_uses_the_override_when_set():
    user = _current_user(monthly_analysis_limit=7)
    test_settings = Settings(default_monthly_analysis_limit=100, default_monthly_chat_limit=500)
    assert effective_limit(user, "analysis_run", test_settings) == 7


def test_effective_limit_falls_back_to_the_default_when_not_set():
    user = _current_user()
    test_settings = Settings(default_monthly_analysis_limit=100, default_monthly_chat_limit=500)
    assert effective_limit(user, "chat", test_settings) == 500


def test_effective_limit_rejects_an_unknown_kind():
    user = _current_user()
    with pytest.raises(ValueError, match="Unknown usage kind"):
        effective_limit(user, "not_a_kind", Settings())
```

- [ ] **Step 5: Run tests**

```bash
cd backend
uv run python -m pytest tests/test_usage.py -v
```

Expected: all pass.

- [ ] **Step 6: Run full suite and lint**

```bash
cd backend
uv run python -m pytest tests/ -v
uv run ruff check . && uv run ruff format --check .
uv run mypy app
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/usage.py backend/app/main.py backend/tests/conftest.py backend/tests/test_usage.py
git commit -m "feat: track monthly usage counts in Redis"
```

---

### Task 3: Per-user burst rate limiting

**Files:**
- Modify: `backend/app/rate_limit.py`
- Test: `backend/tests/test_rate_limit.py`

**Interfaces:**
- Consumes: `CurrentUser`, `get_current_user` from `app.auth.deps` (Task 1).
- Produces: `rate_limiter(key_prefix: str, limit: int, window_seconds: int = 60) -> Callable[..., Awaitable[None]]` — same name and call sites as before (`app/routers/analysis.py`, `app/routers/chat.py` need no changes in this task), but its Redis key is now `ratelimit:{key_prefix}:{user.id}` instead of `ratelimit:{key_prefix}:{client_ip}`.

- [ ] **Step 1: Change the rate limiter's key from client IP to user id**

Replace the whole of `backend/app/rate_limit.py`:

```python
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
```

- [ ] **Step 2: Update `tests/test_rate_limit.py`'s probe app to authenticate**

The probe app is a standalone `FastAPI()` instance, unrelated to `app.main.app`, so it needs its own `get_current_user` override rather than relying on any fixture. Replace the whole file:

```python
import uuid

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth.deps import CurrentUser, get_current_user
from app.rate_limit import rate_limiter


def _fake_user() -> CurrentUser:
    return CurrentUser(id=uuid.uuid4(), email="probe@example.com", role="user")


def _make_probe_app() -> FastAPI:
    app = FastAPI()

    @app.get("/probe", dependencies=[Depends(rate_limiter("test_probe", limit=3))])
    def probe() -> dict[str, bool]:
        return {"ok": True}

    app.dependency_overrides[get_current_user] = _fake_user
    return app


def test_rate_limiter_allows_calls_up_to_the_limit():
    # Entering TestClient's `with` block keeps one event loop alive across
    # every request made inside it -- without it, each call gets its own
    # loop and the second Redis call fails with "Event loop is closed"
    # (same reason conftest's `client` fixture uses this pattern).
    with TestClient(_make_probe_app()) as probe_client:
        for _ in range(3):
            assert probe_client.get("/probe").status_code == 200


def test_rate_limiter_blocks_after_the_limit():
    with TestClient(_make_probe_app()) as probe_client:
        for _ in range(3):
            probe_client.get("/probe")

        response = probe_client.get("/probe")

    assert response.status_code == 429


def test_rate_limiter_gives_each_user_their_own_budget():
    # Regression test: before this task, the key was the client IP, so two different users
    # behind the same IP (or, in tests, TestClient's fixed fake "testclient" host) shared one
    # budget and throttled each other.
    probe_app = _make_probe_app()
    with TestClient(probe_app) as probe_client:
        for _ in range(3):
            assert probe_client.get("/probe").status_code == 200
        assert probe_client.get("/probe").status_code == 429  # first user is now throttled

        probe_app.dependency_overrides[get_current_user] = _fake_user  # a second, distinct user
        assert probe_client.get("/probe").status_code == 200  # fresh budget
```

- [ ] **Step 3: Run tests**

```bash
cd backend
uv run python -m pytest tests/test_rate_limit.py -v
```

Expected: all pass.

- [ ] **Step 4: Run the full suite** (the existing `test_run_analysis_rate_limited_after_5_calls_per_minute` and `test_chat_rate_limited_after_20_calls_per_minute` tests exercise `rate_limiter` through the real `client` fixture, which is a single authenticated user — they must still pass unmodified)

```bash
cd backend
uv run python -m pytest tests/ -v
uv run ruff check . && uv run ruff format --check .
uv run mypy app
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/rate_limit.py backend/tests/test_rate_limit.py
git commit -m "fix: key the burst rate limiter by user, not client IP"
```

---

### Task 4: Wire monthly caps into `/analysis/run` and `/chat`

**Files:**
- Modify: `backend/app/routers/analysis.py`
- Modify: `backend/app/routers/chat.py`
- Test: `backend/tests/test_analysis_router.py`
- Test: `backend/tests/test_chat_router.py`

**Interfaces:**
- Consumes: `check_monthly_usage(kind: str)` from `app.usage` (Task 2).

- [ ] **Step 1: Add the dependency to `POST /analysis/run`**

In `backend/app/routers/analysis.py`, add the import:

```python
from app.rate_limit import rate_limiter
from app.schemas import RecommendationOut
from app.usage import check_monthly_usage
```

And change the route decorator:

```python
@router.post(
    "/run",
    status_code=202,
    dependencies=[
        Depends(rate_limiter("analysis_run", limit=5)),
        Depends(check_monthly_usage("analysis_run")),
    ],
)
```

- [ ] **Step 2: Add the dependency to `POST /chat`**

In `backend/app/routers/chat.py`, add the import:

```python
from app.rate_limit import rate_limiter
from app.schemas import ChatIn, ChatOut
from app.usage import check_monthly_usage
```

And change the route decorator:

```python
@router.post(
    "/chat",
    response_model=ChatOut,
    dependencies=[
        Depends(rate_limiter("chat", limit=20)),
        Depends(check_monthly_usage("chat")),
    ],
)
```

- [ ] **Step 3: Add a monthly-limit test to `test_analysis_router.py`**

Add to `backend/tests/test_analysis_router.py` (needs `AppUser` added to the existing `from app.models import Holding, Recommendation` import — change it to `from app.models import AppUser, Holding, Recommendation`):

```python
def test_run_analysis_is_429_after_the_monthly_limit(client, db_session):
    db_session.query(AppUser).filter_by(id=USER_ID).update({"monthly_analysis_limit": 1})
    db_session.commit()

    def _close_coro(coro):
        coro.close()
        return MagicMock()

    with (
        patch("app.routers.analysis.create_job", AsyncMock(return_value="job-1")),
        patch("app.routers.analysis.run_job", AsyncMock()),
        patch("app.routers.analysis.asyncio.create_task", side_effect=_close_coro),
    ):
        first = client.post("/analysis/run", json={})
        second = client.post("/analysis/run", json={})

    assert first.status_code == 202
    assert second.status_code == 429
    assert "Monthly limit reached" in second.json()["detail"]
```

- [ ] **Step 4: Add a monthly-limit test to `test_chat_router.py`**

Add to `backend/tests/test_chat_router.py` (needs `USER_ID` and `AppUser` added: change the imports to `from app.models import AppUser, ChatMessage` and `from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user, auth_headers`):

```python
def test_chat_is_429_after_the_monthly_limit(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", None)  # fast 503 per call, no mocking
    db_session.query(AppUser).filter_by(id=USER_ID).update({"monthly_chat_limit": 2})
    db_session.commit()

    for _ in range(2):
        response = client.post("/chat", json={"session_id": "s1", "message": "hi"})
        assert response.status_code == 503

    response = client.post("/chat", json={"session_id": "s1", "message": "hi"})
    assert response.status_code == 429
    assert "Monthly limit reached" in response.json()["detail"]
```

- [ ] **Step 5: Run the new and existing tests**

```bash
cd backend
uv run python -m pytest tests/test_analysis_router.py tests/test_chat_router.py -v
```

Expected: all pass, including the pre-existing burst-limit tests (`test_run_analysis_rate_limited_after_5_calls_per_minute`, `test_chat_rate_limited_after_20_calls_per_minute` — the default limits are generous enough that neither test trips the new monthly cap: 5 < 100 and 20 < 500).

- [ ] **Step 6: Run the full suite and lint**

```bash
cd backend
uv run python -m pytest tests/ -v
uv run ruff check . && uv run ruff format --check .
uv run mypy app
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/analysis.py backend/app/routers/chat.py backend/tests/test_analysis_router.py backend/tests/test_chat_router.py
git commit -m "feat: enforce monthly usage caps on analysis runs and chat"
```

---

### Task 5: Shared user-data-deletion helper

**Files:**
- Create: `backend/app/user_data.py`
- Modify: `backend/app/admin/service.py`
- Modify: `backend/tests/test_admin_lifecycle.py`

**Interfaces:**
- Produces: `delete_user_data(factory: sessionmaker[Session], user_id: uuid.UUID) -> None` (moved from `admin/service.py`'s private `_delete_user_data`, same behavior, used by Task 7's self-service delete).

- [ ] **Step 1: Create `app/user_data.py`**

```python
"""Deletes a user's rows in every user-data table, through a session scoped to that user.

Used by both the admin's "remove user" flow and the user's own self-service delete — one
implementation, so the filtered-delete logic only needs to be correct in one place.
"""

import uuid

from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker

from app import rls
from app.db import Base, open_user_session


def delete_user_data(factory: sessionmaker[Session], user_id: uuid.UUID) -> None:
    """Two layers of protection: the explicit user_id filter (holds even if DATABASE_URL is a
    role that bypasses RLS) and RLS on the scoped session. Nothing is read."""
    with open_user_session(factory, user_id) as session:
        for table_name in rls.USER_TABLES:
            table = Base.metadata.tables[table_name]
            session.execute(delete(table).where(table.c.user_id == user_id))
        session.commit()
```

- [ ] **Step 2: Remove the duplicate from `admin/service.py` and import the shared one**

In `backend/app/admin/service.py`, remove this whole function:

```python
def _delete_user_data(factory: sessionmaker[Session], user_id: uuid.UUID) -> None:
    """Deletes the user's rows in every user-data table through a session scoped to that user.
    Two layers: the explicit user_id filter (holds even if DATABASE_URL is a role that bypasses
    RLS) and RLS on the scoped session. Nothing is read."""
    with open_user_session(factory, user_id) as session:
        for table_name in rls.USER_TABLES:
            table = Base.metadata.tables[table_name]
            session.execute(delete(table).where(table.c.user_id == user_id))
        session.commit()
```

Change the imports at the top of the file — remove the now-unused `delete`, `rls`, `Base`, `open_user_session` (check each is not used elsewhere in the file before removing; `open_user_session` and `rls` and `Base` and `delete` are only used by the function just removed) and add:

```python
from app.user_data import delete_user_data
```

In `remove_user`, replace both calls:

```python
    _delete_user_data(factory, user.id)
    _upstream("delete", lambda: supabase.delete(user.id))
    # A running job may have written rows since the first pass. This narrows the window; it does
    # not close it.
    _delete_user_data(factory, user.id)
```

with:

```python
    delete_user_data(factory, user.id)
    _upstream("delete", lambda: supabase.delete(user.id))
    # A running job may have written rows since the first pass. This narrows the window; it does
    # not close it.
    delete_user_data(factory, user.id)
```

- [ ] **Step 3: Update the two tests that call the moved function directly**

In `backend/tests/test_admin_lifecycle.py`, change the import (add `from app.user_data import delete_user_data` alongside the existing `from app.admin import service` — keep `service` if other tests in the file still use it) and change:

```python
    service._delete_user_data(session_local, USER_ID)
```

to:

```python
    delete_user_data(session_local, USER_ID)
```

(This is inside `test_delete_user_data_only_touches_the_target_even_when_rls_is_bypassed`; search the file for any other `service._delete_user_data` reference and update it the same way — there should be exactly one.)

- [ ] **Step 4: Run the admin tests**

```bash
cd backend
uv run python -m pytest tests/test_admin_lifecycle.py tests/test_admin_users.py -v
```

Expected: all pass, unchanged behavior.

- [ ] **Step 5: Run the full suite and lint**

```bash
cd backend
uv run python -m pytest tests/ -v
uv run ruff check . && uv run ruff format --check .
uv run mypy app
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/user_data.py backend/app/admin/service.py backend/tests/test_admin_lifecycle.py
git commit -m "refactor: extract the shared user-data delete helper"
```

---

### Task 6: Admin API — usage visibility and per-user limit overrides

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/admin.py`
- Modify: `backend/app/admin/service.py`
- Test: `backend/tests/test_admin_users.py`

**Interfaces:**
- Consumes: `usage.effective_limit`, `usage.get_usage` from `app.usage` (Task 2).
- Produces: `LimitsIn` schema; `AdminUserOut` gains `monthly_analysis_limit`, `monthly_analysis_used`, `monthly_chat_limit`, `monthly_chat_used` (all `int | None`, filled by the router); `service.set_limits(db: Session, user_id: uuid.UUID, fields: dict[str, int | None]) -> AppUser`; `PATCH /admin/users/{id}/limits`.

- [ ] **Step 1: Add the new schemas and fields**

In `backend/app/schemas.py`, add `NonNegativeInt` to the existing pydantic import:

```python
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    NonNegativeFloat,
    NonNegativeInt,
    PositiveFloat,
    StringConstraints,
)
```

Add near `RemoveIn`:

```python
class LimitsIn(BaseModel):
    """Either field is independent: omitted leaves that limit unchanged, an explicit null clears
    the override back to the system default, and a non-negative integer sets it."""

    analysis_limit: NonNegativeInt | None = None
    chat_limit: NonNegativeInt | None = None
```

Change `AdminUserOut`:

```python
class AdminUserOut(BaseModel):
    """Access-management data only: never anything from the user's portfolio or chats. The four
    monthly_* fields are effective limits and this month's counts (never the raw nullable
    override column) — always filled in by the router's _to_out, like invite_expires_at below."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    role: str
    status: str
    created_at: datetime
    invited_at: datetime | None
    invite_expires_at: datetime | None = None  # display hint, filled in by the router
    accepted_terms_at: datetime | None
    last_seen_at: datetime | None
    monthly_analysis_limit: int | None = None
    monthly_analysis_used: int | None = None
    monthly_chat_limit: int | None = None
    monthly_chat_used: int | None = None
```

- [ ] **Step 2: Add `set_limits` to `admin/service.py`**

In `backend/app/admin/service.py`, add near `accept_terms`:

```python
def set_limits(db: Session, user_id: uuid.UUID, fields: dict[str, int | None]) -> AppUser:
    """`fields` holds only the keys the caller actually sent (see LimitsIn and
    model_dump(exclude_unset=True)): an omitted key leaves that limit unchanged, a present key
    (including an explicit null) sets or clears the override."""
    user = _get_user(db, user_id)
    if "analysis_limit" in fields:
        user.monthly_analysis_limit = fields["analysis_limit"]
    if "chat_limit" in fields:
        user.monthly_chat_limit = fields["chat_limit"]
    db.commit()
    db.refresh(user)
    return user
```

- [ ] **Step 3: Rewrite `admin.py`'s response-building and add the route**

Replace the whole of `backend/app/routers/admin.py`:

```python
import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session, sessionmaker

from app import usage
from app.admin import service
from app.auth.deps import CurrentUser, get_user_db, require_admin
from app.auth.supabase_admin import SupabaseAdmin, get_supabase_admin
from app.config import settings
from app.db import get_session_factory
from app.models import AppUser
from app.schemas import AdminUserOut, InviteIn, LimitsIn, RemoveIn

# require_admin runs first for every route here (it depends on get_current_user), so an
# unauthenticated caller gets 401 and a non-admin gets 403 before anything else happens.
router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


async def _to_out(user: AppUser) -> AdminUserOut:
    out = AdminUserOut.model_validate(user)
    if user.status == "invited" and user.invited_at is not None:
        out.invite_expires_at = user.invited_at + timedelta(hours=settings.invite_link_hours)
    out.monthly_analysis_limit = usage.effective_limit(user, "analysis_run", settings)
    out.monthly_chat_limit = usage.effective_limit(user, "chat", settings)
    out.monthly_analysis_used = await usage.get_usage("analysis_run", str(user.id))
    out.monthly_chat_used = await usage.get_usage("chat", str(user.id))
    return out


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(
    status: Literal["invited", "active", "disabled"] | None = None,
    db: Session = Depends(get_user_db),
) -> list[AdminUserOut]:
    return [await _to_out(u) for u in service.list_users(db, status)]


@router.post("/users/invite", response_model=AdminUserOut, status_code=201)
async def invite_user(
    payload: InviteIn,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> AdminUserOut:
    user = service.invite_user(db, supabase, payload.email, settings.invite_redirect_url)
    return await _to_out(user)


@router.post("/users/{user_id}/resend", response_model=AdminUserOut)
async def resend_invite(
    user_id: uuid.UUID,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> AdminUserOut:
    user = service.resend_invite(db, supabase, user_id, settings.invite_redirect_url)
    return await _to_out(user)


@router.post("/users/{user_id}/revoke", status_code=204)
def revoke_invite(
    user_id: uuid.UUID,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> Response:
    service.revoke_invite(db, supabase, user_id)
    return Response(status_code=204)


@router.post("/users/{user_id}/disable", response_model=AdminUserOut)
async def disable_user(
    user_id: uuid.UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> AdminUserOut:
    return await _to_out(service.disable_user(db, supabase, user_id, admin.id))


@router.post("/users/{user_id}/enable", response_model=AdminUserOut)
async def enable_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> AdminUserOut:
    return await _to_out(service.enable_user(db, supabase, user_id))


@router.patch("/users/{user_id}/limits", response_model=AdminUserOut)
async def set_limits(
    user_id: uuid.UUID,
    payload: LimitsIn,
    db: Session = Depends(get_user_db),
) -> AdminUserOut:
    fields = payload.model_dump(exclude_unset=True)
    user = service.set_limits(db, user_id, fields)
    return await _to_out(user)


@router.delete("/users/{user_id}", status_code=204)
def remove_user(
    user_id: uuid.UUID,
    payload: RemoveIn,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> Response:
    service.remove_user(db, supabase, factory, user_id, payload.confirm_email, admin.id)
    return Response(status_code=204)
```

(`list_users`, `invite_user`, `resend_invite`, `disable_user`, and `enable_user` become `async def` because `_to_out` now awaits Redis reads; `revoke_invite` and `remove_user` are unchanged, since neither returns an `AdminUserOut`. This mirrors the existing precedent in `analysis.py`/`chat.py`, which already mix `async def` routes with synchronous SQLAlchemy calls — admin traffic is low-volume, so the same tradeoff applies here rather than adding a second, synchronous Redis client.)

- [ ] **Step 4: Add tests to `test_admin_users.py`**

```python
def test_list_users_includes_usage_fields(admin_client, db_session):
    add_app_user(db_session, USER_ID)

    response = admin_client.get("/admin/users")

    assert response.status_code == 200
    row = next(u for u in response.json() if u["id"] == str(USER_ID))
    assert row["monthly_analysis_limit"] == settings.default_monthly_analysis_limit
    assert row["monthly_analysis_used"] == 0
    assert row["monthly_chat_limit"] == settings.default_monthly_chat_limit
    assert row["monthly_chat_used"] == 0


def test_set_limits_overrides_and_then_clears(admin_client, db_session):
    add_app_user(db_session, USER_ID)

    response = admin_client.patch(f"/admin/users/{USER_ID}/limits", json={"analysis_limit": 7})
    assert response.status_code == 200
    assert response.json()["monthly_analysis_limit"] == 7
    # chat_limit was never mentioned in the body, so it stays at the default.
    assert response.json()["monthly_chat_limit"] == settings.default_monthly_chat_limit

    response = admin_client.patch(f"/admin/users/{USER_ID}/limits", json={"analysis_limit": None})
    assert response.status_code == 200
    assert response.json()["monthly_analysis_limit"] == settings.default_monthly_analysis_limit


def test_set_limits_rejects_a_negative_value(admin_client, db_session):
    add_app_user(db_session, USER_ID)

    response = admin_client.patch(f"/admin/users/{USER_ID}/limits", json={"analysis_limit": -1})

    assert response.status_code == 422


def test_set_limits_unknown_user_is_404(admin_client):
    response = admin_client.patch(
        f"/admin/users/{uuid.uuid4()}/limits", json={"analysis_limit": 1}
    )
    assert response.status_code == 404
```

(These go alongside the other tests in `test_admin_users.py`, which already imports `uuid`, `settings`, and `add_app_user` — no new imports needed.)

- [ ] **Step 5: Run tests**

```bash
cd backend
uv run python -m pytest tests/test_admin_users.py tests/test_admin_lifecycle.py tests/test_admin_route_authorization.py -v
```

Expected: all pass. `test_every_admin_route_is_403_for_an_active_non_admin` and `test_an_invited_user_is_403_everywhere_except_the_signup_routes` (in `test_admin_route_authorization.py`) automatically cover the new `PATCH /admin/users/{id}/limits` route via OpenAPI enumeration — no changes needed there.

- [ ] **Step 6: Run the full suite and lint**

```bash
cd backend
uv run python -m pytest tests/ -v
uv run ruff check . && uv run ruff format --check .
uv run mypy app
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/admin.py backend/app/admin/service.py backend/tests/test_admin_users.py
git commit -m "feat: admin can view usage and set per-user monthly limit overrides"
```

---

### Task 7: Self-service usage, export, and data deletion

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/me.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_me_router.py`

**Interfaces:**
- Consumes: `usage.get_usage`, `usage.effective_limit` from `app.usage` (Task 2); `delete_user_data` from `app.user_data` (Task 5).
- Produces: `GET /me/usage`, `GET /me/export`, `DELETE /me/data`.

- [ ] **Step 1: Add the export/usage/delete schemas**

In `backend/app/schemas.py`, add near `ChatOut`:

```python
class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: str
    role: str
    content: str
    created_at: datetime
```

Add near `MeOut`:

```python
class ExportProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    role: str
    status: str
    created_at: datetime
    accepted_terms_at: datetime | None
    last_seen_at: datetime | None


class ExportOut(BaseModel):
    profile: ExportProfileOut
    holdings: list[HoldingOut]
    watchlist_items: list[WatchlistItemOut]
    trades: list[TradeOut]
    recommendations: list[RecommendationOut]
    chat_messages: list[ChatMessageOut]
    backtest_results: list[BacktestResultOut]
    investment_preferences: PreferencesOut | None
    portfolio_snapshots: list[PortfolioSnapshotOut]


class UsageDetail(BaseModel):
    used: int
    limit: int


class UsageOut(BaseModel):
    analysis_runs: UsageDetail
    chat_messages: UsageDetail


class DataDeleteIn(BaseModel):
    confirm: Literal[True]  # false or missing is a 422, same idiom as AcceptIn
```

- [ ] **Step 2: Add the active-only routes to `me.py`**

Replace the whole of `backend/app/routers/me.py`:

```python
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session, sessionmaker

from app import usage
from app.admin import service
from app.auth.deps import CurrentUser, get_current_user, get_known_user, get_user_db
from app.config import settings
from app.db import get_session_factory
from app.models import (
    AppUser,
    BacktestResult,
    ChatMessage,
    Holding,
    InvestmentPreferences,
    PortfolioSnapshot,
    Recommendation,
    Trade,
    WatchlistItem,
)
from app.schemas import (
    AcceptIn,
    BacktestResultOut,
    ChatMessageOut,
    DataDeleteIn,
    ExportOut,
    ExportProfileOut,
    HoldingOut,
    MeOut,
    PortfolioSnapshotOut,
    PreferencesOut,
    RecommendationOut,
    TradeOut,
    UsageDetail,
    UsageOut,
    WatchlistItemOut,
)
from app.user_data import delete_user_data

# Invited or active: an invitee finishing signup can reach only these two routes.
router = APIRouter(prefix="/me", tags=["me"], dependencies=[Depends(get_known_user)])

# Active only: usage, export, and self-service delete are not part of signing up.
active_router = APIRouter(prefix="/me", tags=["me"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=MeOut)
def get_me(
    user: CurrentUser = Depends(get_known_user),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> MeOut:
    with factory() as db:
        row = db.get(AppUser, user.id)
        return MeOut.model_validate(row)


@router.post("/accept", response_model=MeOut)
def accept(
    payload: AcceptIn,
    user: CurrentUser = Depends(get_known_user),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> MeOut:
    with factory() as db:
        return MeOut.model_validate(service.accept_terms(db, user.id))


@active_router.get("/usage", response_model=UsageOut)
async def get_usage_summary(user: CurrentUser = Depends(get_current_user)) -> UsageOut:
    analysis_used = await usage.get_usage("analysis_run", str(user.id))
    chat_used = await usage.get_usage("chat", str(user.id))
    return UsageOut(
        analysis_runs=UsageDetail(
            used=analysis_used, limit=usage.effective_limit(user, "analysis_run", settings)
        ),
        chat_messages=UsageDetail(
            used=chat_used, limit=usage.effective_limit(user, "chat", settings)
        ),
    )


@active_router.get("/export", response_model=ExportOut)
def export_data(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> ExportOut:
    profile = db.get(AppUser, user.id)
    preferences = db.query(InvestmentPreferences).filter_by(user_id=user.id).one_or_none()
    return ExportOut(
        profile=ExportProfileOut.model_validate(profile),
        holdings=[
            HoldingOut.model_validate(h) for h in db.query(Holding).filter_by(user_id=user.id)
        ],
        watchlist_items=[
            WatchlistItemOut.model_validate(w)
            for w in db.query(WatchlistItem).filter_by(user_id=user.id)
        ],
        trades=[TradeOut.model_validate(t) for t in db.query(Trade).filter_by(user_id=user.id)],
        recommendations=[
            RecommendationOut.model_validate(r)
            for r in db.query(Recommendation).filter_by(user_id=user.id)
        ],
        chat_messages=[
            ChatMessageOut.model_validate(c)
            for c in db.query(ChatMessage).filter_by(user_id=user.id)
        ],
        backtest_results=[
            BacktestResultOut.model_validate(b)
            for b in db.query(BacktestResult).filter_by(user_id=user.id)
        ],
        investment_preferences=(
            PreferencesOut.model_validate(preferences) if preferences is not None else None
        ),
        portfolio_snapshots=[
            PortfolioSnapshotOut.model_validate(p)
            for p in db.query(PortfolioSnapshot).filter_by(user_id=user.id)
        ],
    )


@active_router.delete("/data", status_code=204)
def delete_my_data(
    payload: DataDeleteIn,
    user: CurrentUser = Depends(get_current_user),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> Response:
    delete_user_data(factory, user.id)
    return Response(status_code=204)
```

- [ ] **Step 3: Register the new router**

In `backend/app/main.py`, change:

```python
app.include_router(me.router)
```

to:

```python
app.include_router(me.router)
app.include_router(me.active_router)
```

- [ ] **Step 4: Add tests to `tests/test_me_router.py`**

The file currently starts with:

```python
from datetime import datetime

from app.models import AppUser
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user, auth_headers
```

Replace those four lines with:

```python
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app import rls
from app.db import Base
from app.models import AppUser, Holding
from tests.auth_support import ROW_FACTORIES, OTHER_USER_ID, USER_ID, add_app_user, auth_headers
```

(`AppUser` was already imported; this adds `date`, the SQLAlchemy pieces `_count` needs, `rls`, `Base`, `Holding`, and `ROW_FACTORIES`. Run `ruff check . --fix` afterward if import ordering flags it.)

Add the tests:

```python
def _count(engine, table_name: str, user_id) -> int:
    table = Base.metadata.tables[table_name]
    with sessionmaker(bind=engine)() as session:
        return session.execute(
            select(func.count()).select_from(table).where(table.c.user_id == user_id)
        ).scalar_one()


def test_usage_starts_at_zero_with_the_default_limits(client):
    from app.config import settings

    response = client.get("/me/usage")

    assert response.status_code == 200
    body = response.json()
    assert body["analysis_runs"] == {
        "used": 0,
        "limit": settings.default_monthly_analysis_limit,
    }
    assert body["chat_messages"] == {"used": 0, "limit": settings.default_monthly_chat_limit}


def test_usage_is_403_for_an_invited_user(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    response = client.get("/me/usage", headers=auth_headers(OTHER_USER_ID))
    assert response.status_code == 403


def test_export_returns_only_the_callers_own_rows(client, db_session):
    db_session.add(
        Holding(
            user_id=USER_ID,
            ticker="AAPL",
            name="Apple",
            asset_type="STOCK",
            shares=1,
            cost_basis=1,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    add_app_user(db_session, OTHER_USER_ID)
    db_session.add(
        Holding(
            user_id=OTHER_USER_ID,
            ticker="MSFT",
            name="Microsoft",
            asset_type="STOCK",
            shares=1,
            cost_basis=1,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    db_session.commit()

    response = client.get("/me/export")

    assert response.status_code == 200
    body = response.json()
    assert body["profile"]["id"] == str(USER_ID)
    assert [h["ticker"] for h in body["holdings"]] == ["AAPL"]


def test_export_is_403_for_an_invited_user(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    response = client.get("/me/export", headers=auth_headers(OTHER_USER_ID))
    assert response.status_code == 403


def test_delete_my_data_wipes_only_the_callers_rows(client, db_session, engine):
    add_app_user(db_session, OTHER_USER_ID)
    for table_name in rls.USER_TABLES:
        db_session.add_all(
            [ROW_FACTORIES[table_name](USER_ID), ROW_FACTORIES[table_name](OTHER_USER_ID)]
        )
    db_session.commit()

    response = client.request("DELETE", "/me/data", json={"confirm": True})

    assert response.status_code == 204
    for table_name in rls.USER_TABLES:
        assert _count(engine, table_name, USER_ID) == 0, table_name
        assert _count(engine, table_name, OTHER_USER_ID) == 1, table_name


def test_delete_my_data_requires_confirm(client):
    assert client.request("DELETE", "/me/data", json={}).status_code == 422
    assert client.request("DELETE", "/me/data", json={"confirm": False}).status_code == 422


def test_delete_my_data_is_403_for_an_invited_user(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    response = client.request(
        "DELETE", "/me/data", json={"confirm": True}, headers=auth_headers(OTHER_USER_ID)
    )
    assert response.status_code == 403
```

- [ ] **Step 5: Run tests**

```bash
cd backend
uv run python -m pytest tests/test_me_router.py -v
```

Expected: all pass.

- [ ] **Step 6: Run the full suite and lint**

```bash
cd backend
uv run python -m pytest tests/ -v
uv run ruff check . && uv run ruff format --check .
uv run mypy app
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/me.py backend/app/main.py backend/tests/test_me_router.py
git commit -m "feat: self-service usage, data export, and data deletion"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: nothing new — this task only documents Tasks 1-7's already-shipped behavior.

- [ ] **Step 1: Update §4 (Data model)**

Find the `AppUser` description (added in the 2a/2b cycles) and add a line documenting the two new columns and the widened grant, matching the existing style, e.g.:

```markdown
`app_users` also holds `monthly_analysis_limit` and `monthly_chat_limit` (both nullable integers):
`NULL` means "use the system default" (`Settings.default_monthly_analysis_limit` /
`default_monthly_chat_limit`), a value overrides it. Set only by the admin API
(`PATCH /admin/users/{id}/limits`). The runtime role's narrowed `UPDATE` grant on `app_users`
(security finding L1) now also covers these two columns.
```

- [ ] **Step 2: Update §5 (Backend API reference)**

Add four rows to the API table, matching its existing format:

```markdown
| GET | `/me/usage` | — | The caller's own usage this month and effective limits: `{analysis_runs: {used, limit}, chat_messages: {used, limit}}` |
| GET | `/me/export` | — | The caller's own data as JSON: profile fields plus every row in each user-data table |
| DELETE | `/me/data` | `{confirm: true}` | Deletes the caller's own rows in every user-data table (not the account); `422` without `confirm: true` |
| PATCH | `/admin/users/{id}/limits` | `{analysis_limit?, chat_limit?}` | **Admin only.** Sets or clears (via explicit `null`) a per-user monthly override; an omitted field is left unchanged |
```

Update the `/analysis/run` and `/chat` rows to mention the monthly cap alongside the existing per-minute note, e.g. change:

```markdown
| POST | `/analysis/run` | — | **Starts** the analysis as a background job and returns `{job_id}` immediately — does not block until finished (see performance note below). Rate limited: 5/min per client IP |
```

to:

```markdown
| POST | `/analysis/run` | — | **Starts** the analysis as a background job and returns `{job_id}` immediately — does not block until finished (see performance note below). Rate limited: 5/min per user; also capped at a monthly total (default 100/month, admin-configurable) |
```

and similarly for `/chat`'s row (5/min → per user; 20/min → per user; add the monthly cap note, default 500/month).

Also update the sentence documenting `GET /admin/users`'s response shape to mention the four new fields:

```markdown
| GET | `/admin/users?status=` | — | **Admin only.** List users (access data only: never portfolios, recommendations, or chats); `invite_expires_at` is a display hint; also returns each user's effective monthly limits and this month's usage counts |
```

Add a line after the existing admin error-notes paragraph documenting the new `429`:

```markdown
`POST /analysis/run` and `POST /chat` return `429` with a calm, specific message when the caller's
monthly cap is reached ("Monthly limit reached (N analysis runs this month). Resets next month, or
ask your admin to raise it."), distinct from the generic `429` the per-minute burst limiter returns.
```

- [ ] **Step 3: Update §11 (Configuration)**

Add the two new settings to wherever the configuration table/list documents `Settings` fields:

```markdown
`DEFAULT_MONTHLY_ANALYSIS_LIMIT` (default 100) and `DEFAULT_MONTHLY_CHAT_LIMIT` (default 500):
system-wide fallback monthly caps, used whenever a user has no per-user override
(`app_users.monthly_analysis_limit` / `monthly_chat_limit`, set by the admin API). No `.env` entry
is required — these are plain `Settings` defaults, not secrets.
```

- [ ] **Step 4: Update the roadmap/status section**

Find wherever the document lists the three backend cycles (2a/2b/2c) and their status (this was updated at the end of the 2a and 2b cycles — likely §13 or §16) and mark 2c done, matching the existing wording style used for 2a and 2b.

- [ ] **Step 5: Read the diff and confirm no other section references stale information**

```bash
git diff docs/ARCHITECTURE.md
```

Confirm the four edits above are present and no other section still says "not yet built" about anything this plan just shipped.

- [ ] **Step 6: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: document monthly limits, usage, and self-service export/deletion"
```
