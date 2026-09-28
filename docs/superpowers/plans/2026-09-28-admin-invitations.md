# Admin and Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One admin can invite people by email, list them, resend or revoke invitations, disable, enable, and permanently remove users through an API; invitees accept the terms; and the runtime database role can no longer change a user's id, email, or role.

**Architecture:** Invitations are Supabase-native: the backend calls Supabase Auth's admin API (secret key) through a small injected `httpx` client, then mirrors the person in `app_users` with the new status `invited`. Lifecycle logic lives in a service module that raises domain errors, mapped to HTTP by one handler in `main.py`; two thin routers (`/admin`, `/me`) call it. Access control reuses 2a: `require_admin`, per-request status checks in `app_users`, and RLS-scoped deletion of a removed user's data.

**Tech Stack:** FastAPI, SQLAlchemy 2 (sync), Alembic, Postgres 16, `httpx` (already a dependency), pytest, ruff, mypy strict, bandit, uv.

**Spec:** `docs/superpowers/specs/2026-09-28-admin-invitations-design.md` (builds on `2026-09-28-auth-core-design.md`).

## Global Constraints

Copied from the spec and repo rules; every task's requirements implicitly include these.

- Every admin endpoint reads and writes `app_users` only and never returns holdings, recommendations, or chats. Removing a user is the one flow that touches financial tables: it only deletes, through that user's own RLS scope (`open_user_session`).
- Statuses: `invited | active | disabled`. Invitation link lifetime is Supabase's "Email OTP expiration", set by the owner to 24 hours (86400 s). `INVITE_LINK_HOURS` (default 24) is used only to compute a display hint `invite_expires_at = invited_at + hours`.
- Disable/enable: call Supabase first (ban `"876000h"` / unban `"none"`), then update the database; a Supabase failure leaves the database unchanged. Remove: disable first (ban + `status = "disabled"`), then delete the user's rows in the eight user-data tables through a session scoped to that user, then delete the Supabase user (a Supabase "not found" counts as success), then delete the `app_users` row. A failure after the first step leaves the user disabled and the operation retryable.
- Invite: only after Supabase succeeds insert `app_users`; if the insert fails, delete the just-created Supabase user (compensation). An address Supabase reports as already registered is 409, never 502.
- Guards: an admin cannot disable, remove, or revoke themselves; removing requires `{confirm_email}` to match the user's email (422 otherwise). The "last admin can never be disabled or removed" guarantee is structural (only an active admin can call these routes and cannot act on themselves, so the caller always remains); no separate last-admin check is written, and a test asserts the caller stays an active admin.
- Errors, calm and generic: 404 unknown user id; 409 invalid state or guard; 422 bad body; `502 Could not reach the authentication service` when Supabase fails (log the exception class only, never response bodies, emails from responses, or keys); `503 User management not configured` when `SUPABASE_URL` or `SUPABASE_SECRET_KEY` is unset.
- `get_current_user` stays strict (active only). New `get_known_user` admits `invited` and `active`, refuses `disabled` and unknown users (403), and is used only by `GET /me` and `POST /me/accept`.
- Runtime role permissions on `app_users` become `SELECT, INSERT, DELETE` plus `UPDATE` on only `status, accepted_terms_at, last_seen_at, invited_at` (never `id`, `email`, `role`). Role is set only by the bootstrap command on the owner connection.
- `SUPABASE_SECRET_KEY` is a backend-only secret: never logged, never returned, never committed.
- Repo rules: Conventional Commits; commit trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`; no `print`; type hints on every signature; ruff line length 100; mypy strict; bandit clean; never commit `.env`, keys, or connection strings; migrations only via the alembic CLI (create with `alembic revision`, then add manual grant statements to the generated body); services raise domain exceptions, not `HTTPException`.
- This system never places a trade. Nothing here touches that, and nothing may.

## Review Focus

The failure modes the spec implies but a straightforward implementation is most likely to get wrong, most likely first. Each has a test in the task that owns the code.

1. **Inviting an address Supabase already has confirmed** must be `409`, not a 502 or 500. Pinned in Task 2 (client maps `422 email_exists` to `SupabaseUserExists`) and Task 4 (`test_invite_address_already_registered_in_supabase_is_409`).
2. **A database failure after a successful Supabase invite** must delete the Supabase user again and leave no `app_users` row. Pinned in Task 4 (`test_invite_database_failure_deletes_the_supabase_user`).
3. **A remove that fails halfway** (Supabase delete fails after the data is gone) must leave the user disabled, with no access, and a retry must complete it. Pinned in Task 5.
4. **Acting on yourself, or a typed confirmation that does not match**, must change nothing. Pinned in Task 5.
5. **Invited and disabled users**: an invited user can reach only `/me` and `/me/accept` (every other route 403); a disabled user gets 403 everywhere including `/me`; the runtime role cannot change `role`/`email`/`id`. Pinned in Tasks 1 and 3.

## Environment notes

- Run everything from `backend/`. Prefix Python tooling with `uv run`.
- On this machine Avast intercepts TLS: before any `uv` command that downloads packages run `export SSL_CERT_FILE="C:\ProgramData\Avast Software\Avast\wscert.pem"` (Git Bash); `UV_HTTP_TIMEOUT=120` if a download times out.
- Tests need Docker Postgres and Redis: `docker compose up -d` in `backend/` (start Docker Desktop first if the engine is not running).
- Test command: `uv run python -m pytest tests/ -v` (must be `python -m pytest`).
- Full check (run at the end of every task that changes code): `uv run ruff format . && uv run ruff check . && uv run mypy app && uv run bandit -r app -q && uv run python -m pytest tests/ -q`. It formats first (CI runs `ruff format --check`); include any reformatted files in the task's commit. Repo files use CRLF; keep each file's existing line endings.
- Test-writing rule (lesson from 2a): tests that authenticate as `USER_ID` cannot detect certain regressions because `USER_ID` is the historical default id; where a test needs to prove identity comes from the token, authenticate as a different id.

## File Structure

Create:
- `backend/app/auth/supabase_admin.py`: the Supabase Auth admin client, its errors, and the `get_supabase_admin` dependency.
- `backend/app/admin/__init__.py`, `backend/app/admin/service.py`: lifecycle logic and the `AdminError` family.
- `backend/app/routers/admin.py`, `backend/app/routers/me.py`.
- `backend/migrations/versions/<rev>_add_invited_at_to_app_users.py`.
- Tests: `test_app_users_privileges.py`, `test_supabase_admin.py`, `test_me_router.py`, `test_admin_users.py`, `test_admin_lifecycle.py`.

Modify:
- `backend/app/config.py`, `backend/.env.example`, `backend/app/models.py` (`invited_at`), `backend/app/rls.py` (narrowed `app_users` grants), `backend/migrations/versions/dd035aae788b_enable_rls_and_runtime_role.py` (freeze its `app_users` grant), `backend/app/auth/deps.py` (`get_known_user`), `backend/app/schemas.py`, `backend/app/main.py`.
- `backend/tests/auth_support.py` (`ADMIN_ID`, `FakeSupabaseAdmin`, `add_app_user(invited_at=...)`, `ROW_FACTORIES`), `backend/tests/conftest.py` (`fake_supabase`, `admin_client`), `backend/tests/test_rls.py` (import `ROW_FACTORIES`).
- Docs: `docs/ARCHITECTURE.md`, `docs/superpowers/specs/2026-09-28-frontend-design-direction-design.md`, `docs/design/mockups/auth-and-admin.html`.

---

### Task 1: `invited_at`, narrowed `app_users` grants, and settings

**Files:**
- Modify: `backend/app/config.py`, `backend/.env.example`, `backend/app/models.py`, `backend/app/rls.py`, `backend/migrations/versions/dd035aae788b_enable_rls_and_runtime_role.py`
- Create: migration `<rev>_add_invited_at_to_app_users.py`, `backend/tests/test_app_users_privileges.py`

**Interfaces:**
- Consumes: 2a's `rls.grant_table_sql`, `AppUser`, fixtures `engine`, `app_session_local`, `db_session`, helper `add_app_user`.
- Produces:
  - `AppUser.invited_at: datetime | None`; `status` may be `"invited"`.
  - `settings.supabase_secret_key: str | None`, `settings.invite_redirect_url: str | None`, `settings.invite_link_hours: int` (default 24).
  - `rls.APP_USERS_UPDATABLE_COLUMNS: tuple[str, ...]`; `rls.grant_table_sql("app_users")` returns the narrowed grants.

- [ ] **Step 1: Write the failing privilege tests**

Create `backend/tests/test_app_users_privileges.py`:

```python
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app import rls
from app.models import AppUser
from tests.auth_support import USER_ID, add_app_user


def _can_update(engine, column: str) -> bool:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT has_column_privilege(:role, 'app_users', :column, 'UPDATE')"),
            {"role": rls.RUNTIME_ROLE, "column": column},
        ).scalar_one()


@pytest.mark.parametrize("column", ["status", "accepted_terms_at", "last_seen_at", "invited_at"])
def test_runtime_role_can_update_the_lifecycle_columns(engine, column):
    assert _can_update(engine, column) is True


@pytest.mark.parametrize("column", ["id", "email", "role", "created_at"])
def test_runtime_role_cannot_update_identity_columns(engine, column):
    assert _can_update(engine, column) is False


def test_runtime_role_cannot_promote_a_user_to_admin(db_session, app_session_local):
    add_app_user(db_session, role="user")

    with app_session_local() as session, pytest.raises(DBAPIError, match="permission denied"):
        session.execute(text("UPDATE app_users SET role = 'admin'"))


def test_runtime_role_can_still_create_update_status_and_delete_users(app_session_local):
    with app_session_local() as session:
        session.add(AppUser(id=USER_ID, email="u@example.com", role="user", status="invited"))
        session.commit()

        user = session.get(AppUser, USER_ID)
        user.status = "active"
        session.commit()
        assert session.get(AppUser, USER_ID).status == "active"

        session.delete(user)
        session.commit()
        assert session.get(AppUser, USER_ID) is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run python -m pytest tests/test_app_users_privileges.py -v`
Expected: FAIL (`test_runtime_role_cannot_update_identity_columns` and `..._promote...` fail because the role currently holds table-wide UPDATE; `test_..._lifecycle_columns[invited_at]` errors because the column does not exist yet).

- [ ] **Step 3: Add the model column and settings**

In `backend/app/models.py`, in `AppUser`, change the status comment and add the column after `last_seen_at`:

```python
    status: Mapped[str] = mapped_column(String(10), default="active")  # "invited" | "active" | "disabled"
```
(if that exceeds 100 characters, put the comment on its own line above), and

```python
    invited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

In `backend/app/config.py` `Settings`, after `migration_database_url`:

```python
    supabase_secret_key: str | None = None  # backend-only secret for Supabase Auth admin calls
    invite_redirect_url: str | None = None  # where the emailed invitation link lands (frontend)
    invite_link_hours: int = 24  # display hint only; Supabase enforces the real link expiry
```

Append to `backend/.env.example`:

```
SUPABASE_SECRET_KEY=
INVITE_REDIRECT_URL=
INVITE_LINK_HOURS=24
```

- [ ] **Step 4: Narrow the grants in `app/rls.py`**

Add below `RUNTIME_TABLES`:

```python
# The auth table is deliberately not writable wholesale: the runtime role may create and delete
# rows and update only these columns, so no application bug can change a user's id, email, or
# role (for example promote someone to admin). Role is set only by the bootstrap command on the
# owner connection.
APP_USERS_UPDATABLE_COLUMNS: tuple[str, ...] = (
    "status",
    "accepted_terms_at",
    "last_seen_at",
    "invited_at",
)
```

Replace `grant_table_sql` with:

```python
def grant_table_sql(table: str) -> list[str]:
    if table == "app_users":
        columns = ", ".join(APP_USERS_UPDATABLE_COLUMNS)
        return [
            f"GRANT SELECT, INSERT, DELETE ON app_users TO {RUNTIME_ROLE}",
            f"GRANT UPDATE ({columns}) ON app_users TO {RUNTIME_ROLE}",
        ]
    statements = [f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {RUNTIME_ROLE}"]
    if table in USER_TABLES:
        # Every user table has an integer id backed by a serial sequence named <table>_id_seq.
        statements.append(f"GRANT USAGE, SELECT ON SEQUENCE {table}_id_seq TO {RUNTIME_ROLE}")
    return statements
```

- [ ] **Step 5: Freeze the old RLS migration's `app_users` grant**

Replaying history on a fresh database runs `dd035aae788b` before the new migration; if it called the live builder it would grant `UPDATE (invited_at)` on a column that does not exist yet. In `backend/migrations/versions/dd035aae788b_enable_rls_and_runtime_role.py` `upgrade()`, replace the grant loop

```python
    for table in (*USER_TABLES, "app_users"):
        for statement in rls.grant_table_sql(table):
            op.execute(statement)
```
with

```python
    for table in USER_TABLES:
        for statement in rls.grant_table_sql(table):
            op.execute(statement)
    # app_users exactly as it was at this revision (narrowed by a later migration). Written out
    # so replaying history does not depend on the current rls.py.
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON app_users TO {rls.RUNTIME_ROLE}")
```
Leave `downgrade()` unchanged.

- [ ] **Step 6: Generate and complete the migration**

```bash
docker compose up -d
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "add invited_at to app_users"
```
Open the new file. The autogenerated body must contain only `op.add_column('app_users', sa.Column('invited_at', sa.DateTime(), nullable=True))` and the matching `drop_column`; remove any unrelated operations. Then add the grant statements so the file reads (keep the generated header and revision ids):

```python
def upgrade() -> None:
    op.add_column('app_users', sa.Column('invited_at', sa.DateTime(), nullable=True))
    # Narrow the runtime role: no UPDATE on id, email, or role.
    op.execute("REVOKE UPDATE ON app_users FROM trading_agent_app")
    op.execute(
        "GRANT UPDATE (status, accepted_terms_at, last_seen_at, invited_at) "
        "ON app_users TO trading_agent_app"
    )


def downgrade() -> None:
    op.execute(
        "REVOKE UPDATE (status, accepted_terms_at, last_seen_at, invited_at) "
        "ON app_users FROM trading_agent_app"
    )
    op.execute("GRANT UPDATE ON app_users TO trading_agent_app")
    op.drop_column('app_users', 'invited_at')
```
(The role name is written out on purpose: the migration must not depend on later edits to `rls.py`.) Then prove it round-trips on the local dev database:

```bash
uv run alembic upgrade head
uv run alembic downgrade -1
uv run alembic upgrade head
```
Expected: all succeed.

- [ ] **Step 7: Run the privilege tests, then the full check**

Run: `uv run python -m pytest tests/test_app_users_privileges.py -v`, then the full check from "Environment notes".
Expected: all green (the existing RLS and auth tests still pass: `_touch_last_seen` updates only `last_seen_at`, which stays allowed).

- [ ] **Step 8: Commit**

```bash
git add backend/app/config.py backend/.env.example backend/app/models.py backend/app/rls.py backend/migrations/versions backend/tests/test_app_users_privileges.py
git commit -m "feat: add invited_at and narrow the runtime role's app_users writes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Supabase admin client and test fakes

**Files:**
- Create: `backend/app/auth/supabase_admin.py`, `backend/tests/test_supabase_admin.py`
- Modify: `backend/tests/auth_support.py`, `backend/tests/conftest.py`

**Interfaces:**
- Consumes: `settings.supabase_url`, `settings.supabase_secret_key` (Task 1).
- Produces:
  - `SupabaseAdminError(Exception)`, `SupabaseUserExists(SupabaseAdminError)`
  - `SupabaseAdmin(base_url: str, secret_key: str, transport: httpx.BaseTransport | None = None)` with `invite(email: str, redirect_to: str | None) -> uuid.UUID`, `ban(user_id: uuid.UUID) -> None`, `unban(user_id: uuid.UUID) -> None`, `delete(user_id: uuid.UUID) -> None` (a 404 is success)
  - `get_supabase_admin() -> SupabaseAdmin` (FastAPI dependency; raises `HTTPException(503, "User management not configured")` when settings are missing)
  - In `tests/auth_support.py`: `ADMIN_ID: uuid.UUID`; `FakeSupabaseAdmin` (same four methods; `.calls: list[tuple[str, object]]`, `.fail_on: set[str]`, `.existing_emails: set[str]`, `.next_id: uuid.UUID | None`, `.ids_by_email: dict[str, uuid.UUID]`); `add_app_user(..., invited_at: datetime | None = None)`; `ROW_FACTORIES` (moved from `test_rls.py`)
  - conftest fixtures `fake_supabase` and `admin_client`

- [ ] **Step 1: Write the failing client contract tests**

Create `backend/tests/test_supabase_admin.py`:

```python
import uuid

import httpx
import pytest
from fastapi import HTTPException

from app.auth.supabase_admin import (
    SupabaseAdmin,
    SupabaseAdminError,
    SupabaseUserExists,
    get_supabase_admin,
)
from app.config import settings
from tests.auth_support import TEST_SUPABASE_URL

USER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
NEW_KEY = "sb_secret_abc123"
LEGACY_KEY = "eyJlegacy.service.role"


def _client(handler, key: str = NEW_KEY) -> SupabaseAdmin:
    return SupabaseAdmin(TEST_SUPABASE_URL, key, transport=httpx.MockTransport(handler))


def test_invite_posts_the_email_and_returns_the_user_id():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": str(USER_ID), "email": "a@example.com"})

    result = _client(handler).invite("a@example.com", "https://app.example.com/welcome")

    assert result == USER_ID
    request = seen[0]
    assert request.method == "POST"
    assert request.url.path == "/auth/v1/invite"
    assert request.url.params["redirect_to"] == "https://app.example.com/welcome"
    assert request.read() == b'{"email":"a@example.com"}'


def test_invite_without_a_redirect_sends_no_redirect_parameter():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": str(USER_ID)})

    _client(handler).invite("a@example.com", None)

    assert "redirect_to" not in seen[0].url.params


def test_new_style_secret_key_goes_in_apikey_only():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": str(USER_ID)})

    _client(handler, NEW_KEY).invite("a@example.com", None)

    assert seen[0].headers["apikey"] == NEW_KEY
    assert "authorization" not in seen[0].headers


def test_legacy_jwt_key_is_sent_in_both_headers():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": str(USER_ID)})

    _client(handler, LEGACY_KEY).invite("a@example.com", None)

    assert seen[0].headers["apikey"] == LEGACY_KEY
    assert seen[0].headers["authorization"] == f"Bearer {LEGACY_KEY}"


def test_invite_of_a_confirmed_user_raises_user_exists():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"code": 422, "error_code": "email_exists", "msg": "x"})

    with pytest.raises(SupabaseUserExists):
        _client(handler).invite("a@example.com", None)


def test_ban_and_unban_put_the_ban_duration():
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append((request.method, request.url.path, request.read()))
        return httpx.Response(200, json={})

    client = _client(handler)
    client.ban(USER_ID)
    client.unban(USER_ID)

    assert bodies[0] == ("PUT", f"/auth/v1/admin/users/{USER_ID}", b'{"ban_duration":"876000h"}')
    assert bodies[1] == ("PUT", f"/auth/v1/admin/users/{USER_ID}", b'{"ban_duration":"none"}')


def test_delete_treats_not_found_as_success():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        assert request.url.path == f"/auth/v1/admin/users/{USER_ID}"
        return httpx.Response(404, json={"error_code": "user_not_found"})

    _client(handler).delete(USER_ID)  # must not raise


@pytest.mark.parametrize("call", ["invite", "ban", "unban", "delete"])
def test_server_errors_raise_without_leaking_the_response(call):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"msg": "secret-in-body a@example.com"})

    client = _client(handler)
    args = ("a@example.com", None) if call == "invite" else (USER_ID,)

    with pytest.raises(SupabaseAdminError) as excinfo:
        getattr(client, call)(*args)

    assert "secret-in-body" not in str(excinfo.value)
    assert "a@example.com" not in str(excinfo.value)


def test_network_failure_raises_supabase_admin_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom with secret host")

    with pytest.raises(SupabaseAdminError) as excinfo:
        _client(handler).ban(USER_ID)

    assert "secret host" not in str(excinfo.value)


def test_unexpected_invite_response_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"no": "id"})

    with pytest.raises(SupabaseAdminError):
        _client(handler).invite("a@example.com", None)


def test_get_supabase_admin_is_503_when_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "supabase_secret_key", None)

    with pytest.raises(HTTPException) as excinfo:
        get_supabase_admin()

    assert excinfo.value.status_code == 503
    assert excinfo.value.detail == "User management not configured"


def test_get_supabase_admin_builds_a_client_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "supabase_secret_key", NEW_KEY)

    assert isinstance(get_supabase_admin(), SupabaseAdmin)
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run python -m pytest tests/test_supabase_admin.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.auth.supabase_admin'`.

- [ ] **Step 3: Implement the client**

Create `backend/app/auth/supabase_admin.py`:

```python
"""Supabase Auth admin API: invite, ban, unban, delete users.

A small synchronous httpx client (routes are sync `def`). Every failure becomes one
SupabaseAdminError that carries no response text or exception message: those can echo keys,
hosts, and email addresses.
"""

import uuid
from typing import Any

import httpx
from fastapi import HTTPException

from app.config import settings

REQUEST_TIMEOUT_SECONDS = 10.0
# Supabase takes Go duration units (hours at most); 876000h is 100 years, i.e. permanent.
BAN_FOREVER = "876000h"
UNBAN = "none"


class SupabaseAdminError(Exception):
    """A Supabase Auth admin call failed."""


class SupabaseUserExists(SupabaseAdminError):
    """The address is already a confirmed Supabase user."""


def _error_code(response: httpx.Response) -> str | None:
    try:
        data = response.json()
    except ValueError:
        return None
    if isinstance(data, dict):
        code = data.get("error_code") or data.get("code")
        return str(code) if code is not None else None
    return None


def _raise_for_status(response: httpx.Response) -> None:
    if response.status_code >= 400:
        raise SupabaseAdminError(f"HTTP {response.status_code}")


class SupabaseAdmin:
    def __init__(
        self,
        base_url: str,
        secret_key: str,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._auth_url = f"{base_url.rstrip('/')}/auth/v1"
        self._secret_key = secret_key
        self._transport = transport

    def _headers(self) -> dict[str, str]:
        headers = {"apikey": self._secret_key}
        # Legacy service_role keys are JWTs and also go in Authorization. New sb_secret_ keys
        # are not JWTs and must only be sent as the apikey.
        if not self._secret_key.startswith("sb_secret_"):
            headers["Authorization"] = f"Bearer {self._secret_key}"
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict[str, str] | None = None,
    ) -> httpx.Response:
        try:
            with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS, transport=self._transport) as http:
                return http.request(
                    method,
                    f"{self._auth_url}{path}",
                    headers=self._headers(),
                    json=json,
                    params=params,
                )
        except httpx.HTTPError as exc:
            raise SupabaseAdminError(type(exc).__name__) from None

    def invite(self, email: str, redirect_to: str | None) -> uuid.UUID:
        """Invites the address (re-sends if it is invited but unconfirmed) and returns its id."""
        params = {"redirect_to": redirect_to} if redirect_to else None
        response = self._request("POST", "/invite", json={"email": email}, params=params)
        if response.status_code == 422 and _error_code(response) == "email_exists":
            raise SupabaseUserExists("email_exists")
        _raise_for_status(response)
        try:
            return uuid.UUID(str(response.json()["id"]))
        except (ValueError, KeyError, TypeError):
            raise SupabaseAdminError("Unexpected invite response") from None

    def _set_ban(self, user_id: uuid.UUID, duration: str) -> None:
        response = self._request(
            "PUT", f"/admin/users/{user_id}", json={"ban_duration": duration}
        )
        _raise_for_status(response)

    def ban(self, user_id: uuid.UUID) -> None:
        self._set_ban(user_id, BAN_FOREVER)

    def unban(self, user_id: uuid.UUID) -> None:
        self._set_ban(user_id, UNBAN)

    def delete(self, user_id: uuid.UUID) -> None:
        response = self._request("DELETE", f"/admin/users/{user_id}")
        if response.status_code == 404:
            return  # already gone: exactly what a retry of a half-finished remove needs
        _raise_for_status(response)


def get_supabase_admin() -> SupabaseAdmin:
    """FastAPI dependency; tests override it with a fake."""
    if not settings.supabase_url or not settings.supabase_secret_key:
        raise HTTPException(status_code=503, detail="User management not configured")
    return SupabaseAdmin(settings.supabase_url, settings.supabase_secret_key)
```

- [ ] **Step 4: Run the client tests**

Run: `uv run python -m pytest tests/test_supabase_admin.py -v`
Expected: PASS. (If the `request.read()` body comparisons fail only on whitespace, httpx's JSON encoding is compact in this version; compare against the exact bytes it produced and keep the test strict about the keys and values.)

- [ ] **Step 5: Add the shared test support**

In `backend/tests/auth_support.py`:

Add imports `from datetime import date, datetime`, `from app.auth.supabase_admin import SupabaseAdminError, SupabaseUserExists`, and the model imports the row factories need (`BacktestResult, ChatMessage, Holding, InvestmentPreferences, PortfolioSnapshot, Recommendation, Trade, WatchlistItem` in addition to `AppUser`), plus `from collections.abc import Callable` and `from app.db import Base`.

Add after `OTHER_USER_ID`:

```python
ADMIN_ID = uuid.UUID("00000000-0000-0000-0000-0000000000a1")
```

Extend `add_app_user` with a keyword `invited_at: datetime | None = None` and pass `invited_at=invited_at` into the `AppUser(...)` constructor.

Move `ROW_FACTORIES` here verbatim from `backend/tests/test_rls.py` (the dict of `lambda uid: Model(...)` factories keyed by table name, with its type annotation `dict[str, Callable[[uuid.UUID], Base]]`), and in `test_rls.py` replace the local definition and its now-unused model imports with `from tests.auth_support import OTHER_USER_ID, ROW_FACTORIES, USER_ID`.

Append the fake:

```python
class FakeSupabaseAdmin:
    """Stands in for SupabaseAdmin in API tests: records calls and can be told to fail."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []
        self.fail_on: set[str] = set()  # method names that should raise SupabaseAdminError
        self.existing_emails: set[str] = set()  # invite raises SupabaseUserExists for these
        self.next_id: uuid.UUID | None = None  # the id the next new invite returns
        self.ids_by_email: dict[str, uuid.UUID] = {}

    def _maybe_fail(self, name: str) -> None:
        if name in self.fail_on:
            raise SupabaseAdminError(f"{name} failed")

    def invite(self, email: str, redirect_to: str | None) -> uuid.UUID:
        self.calls.append(("invite", email))
        self._maybe_fail("invite")
        if email in self.existing_emails:
            raise SupabaseUserExists("email_exists")
        if email not in self.ids_by_email:
            self.ids_by_email[email] = self.next_id or uuid.uuid4()
        return self.ids_by_email[email]

    def ban(self, user_id: uuid.UUID) -> None:
        self.calls.append(("ban", user_id))
        self._maybe_fail("ban")

    def unban(self, user_id: uuid.UUID) -> None:
        self.calls.append(("unban", user_id))
        self._maybe_fail("unban")

    def delete(self, user_id: uuid.UUID) -> None:
        self.calls.append(("delete", user_id))
        self._maybe_fail("delete")
```

In `backend/tests/conftest.py` add imports `from app.auth.supabase_admin import get_supabase_admin`, and `ADMIN_ID, FakeSupabaseAdmin` to the `tests.auth_support` import, then add:

```python
@pytest.fixture()
def fake_supabase() -> FakeSupabaseAdmin:
    return FakeSupabaseAdmin()


@pytest.fixture()
def admin_client(
    engine: Engine, app_engine: Engine, fake_supabase: FakeSupabaseAdmin
) -> Generator[TestClient, None, None]:
    """Authenticated as an active admin (ADMIN_ID); Supabase is replaced by `fake_supabase`."""
    with sessionmaker(bind=engine)() as setup:
        setup.add(AppUser(id=ADMIN_ID, email="admin@example.com", role="admin", status="active"))
        setup.commit()
    _install_overrides(app_engine)
    app.dependency_overrides[get_supabase_admin] = lambda: fake_supabase
    with TestClient(app, headers=auth_headers(ADMIN_ID)) as test_client:
        yield test_client
    app.dependency_overrides.clear()
```

- [ ] **Step 6: Full check and commit**

Run the full check from "Environment notes". Expected: all green (the moved `ROW_FACTORIES` keeps `test_rls.py` passing).

```bash
git add backend/app/auth/supabase_admin.py backend/tests
git commit -m "feat: add the Supabase Auth admin client and test fakes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `get_known_user`, `GET /me`, and `POST /me/accept`

**Files:**
- Create: `backend/app/admin/__init__.py`, `backend/app/admin/service.py` (errors and `accept_terms` only in this task), `backend/app/routers/me.py`, `backend/tests/test_me_router.py`
- Modify: `backend/app/auth/deps.py`, `backend/app/schemas.py`, `backend/app/main.py`

**Interfaces:**
- Consumes: Task 1 (`invited_at`, statuses), Task 2 fixtures (`admin_client` not needed here; `client`, `db_session`, `add_app_user`, `auth_headers`).
- Produces:
  - `app.admin.service`: `AdminError(Exception)` with class attribute `status_code: int` and instance attribute `detail: str`; subclasses `NotFound` (404), `Conflict` (409), `Unprocessable` (422), `UpstreamError` (502); `UPSTREAM_DETAIL = "Could not reach the authentication service"`; `accept_terms(db: Session, user_id: uuid.UUID) -> AppUser`
  - `app.auth.deps.get_known_user(...) -> CurrentUser` (invited or active)
  - `app.schemas`: `Email` (annotated str), `AcceptIn(accept_terms: Literal[True])`, `MeOut`
  - `main.py` exception handler mapping `AdminError` to `JSONResponse`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_me_router.py`:

```python
from datetime import datetime

from app.models import AppUser
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user, auth_headers


def test_me_returns_the_callers_own_state(client):
    body = client.get("/me").json()

    assert body["id"] == str(USER_ID)
    assert body["email"] == "user@example.com"
    assert body["role"] == "user"
    assert body["status"] == "active"


def test_an_invited_user_can_read_me_but_nothing_else(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited", invited_at=datetime(2026, 9, 28))
    headers = auth_headers(OTHER_USER_ID)

    assert client.get("/me", headers=headers).json()["status"] == "invited"
    assert client.get("/portfolio/holdings", headers=headers).status_code == 403
    assert client.get("/preferences", headers=headers).status_code == 403


def test_a_disabled_user_is_refused_on_me_and_accept(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="disabled")
    headers = auth_headers(OTHER_USER_ID)

    assert client.get("/me", headers=headers).status_code == 403
    assert client.post("/me/accept", json={"accept_terms": True}, headers=headers).status_code == 403


def test_an_unknown_user_is_refused_on_me(client):
    assert client.get("/me", headers=auth_headers(OTHER_USER_ID)).status_code == 403


def test_me_requires_authentication(anon_client):
    assert anon_client.get("/me").status_code == 401
    assert anon_client.post("/me/accept", json={"accept_terms": True}).status_code == 401


def test_accepting_activates_an_invited_user_and_records_the_terms(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited", invited_at=datetime(2026, 9, 28))
    headers = auth_headers(OTHER_USER_ID)

    response = client.post("/me/accept", json={"accept_terms": True}, headers=headers)

    assert response.status_code == 200
    assert response.json()["status"] == "active"
    assert response.json()["accepted_terms_at"] is not None
    # Now a normal active user: regular routes work.
    assert client.get("/portfolio/holdings", headers=headers).status_code == 200


def test_accepting_without_ticking_the_terms_changes_nothing(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    headers = auth_headers(OTHER_USER_ID)

    assert client.post("/me/accept", json={"accept_terms": False}, headers=headers).status_code == 422
    assert client.post("/me/accept", json={}, headers=headers).status_code == 422

    db_session.expire_all()
    stored = db_session.get(AppUser, OTHER_USER_ID)
    assert stored.status == "invited"
    assert stored.accepted_terms_at is None


def test_accepting_twice_is_idempotent(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    headers = auth_headers(OTHER_USER_ID)

    first = client.post("/me/accept", json={"accept_terms": True}, headers=headers).json()
    second = client.post("/me/accept", json={"accept_terms": True}, headers=headers).json()

    assert second["status"] == "active"
    assert second["accepted_terms_at"] == first["accepted_terms_at"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run python -m pytest tests/test_me_router.py -v`
Expected: FAIL (404 for `/me`).

- [ ] **Step 3: Add the schemas**

In `backend/app/schemas.py` add (with the other imports already present: `datetime`, `Annotated`, `Literal`, `UUID`, `BaseModel`, `ConfigDict`, `StringConstraints`):

```python
# Light shape check only; the real check is that Supabase can deliver the invitation. Lowercased
# and trimmed so the same person is never two rows.
Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        max_length=320,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    ),
]


class AcceptIn(BaseModel):
    accept_terms: Literal[True]  # false or missing is a 422


class MeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    role: str
    status: str
    accepted_terms_at: datetime | None
```

- [ ] **Step 4: Add the service module (errors and `accept_terms`)**

Create empty `backend/app/admin/__init__.py`, then `backend/app/admin/service.py`:

```python
"""Lifecycle actions on app_users. Services raise AdminError subclasses; main.py maps them to
HTTP responses, so this module never imports FastAPI."""

import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import AppUser

UPSTREAM_DETAIL = "Could not reach the authentication service"


class AdminError(Exception):
    status_code = 500

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class NotFound(AdminError):
    status_code = 404


class Conflict(AdminError):
    status_code = 409


class Unprocessable(AdminError):
    status_code = 422


class UpstreamError(AdminError):
    status_code = 502


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)  # columns are naive UTC


def _get_user(db: Session, user_id: uuid.UUID) -> AppUser:
    user = db.get(AppUser, user_id)
    if user is None:
        raise NotFound("User not found")
    return user


def accept_terms(db: Session, user_id: uuid.UUID) -> AppUser:
    """Records acceptance and activates an invited user. Idempotent."""
    user = _get_user(db, user_id)
    changed = False
    if user.status == "invited":
        user.status = "active"
        changed = True
    if user.accepted_terms_at is None:
        user.accepted_terms_at = _utcnow()
        changed = True
    if changed:
        db.commit()
        db.refresh(user)
    return user
```

- [ ] **Step 5: Refactor `deps.py` to add `get_known_user`**

In `backend/app/auth/deps.py`, replace `get_current_user` with a shared helper plus two thin dependencies (keep everything else in the file, including `_not_authenticated`, `_touch_last_seen`, `require_admin`, `get_user_db`, `CurrentUser`):

```python
_ACTIVE = frozenset({"active"})
_INVITED_OR_ACTIVE = frozenset({"invited", "active"})


def _authenticate(
    credentials: HTTPAuthorizationCredentials | None,
    resolve_key: KeyResolver,
    factory: sessionmaker[Session],
    allowed_statuses: frozenset[str],
) -> CurrentUser:
    if credentials is None:
        raise _not_authenticated()

    try:
        verified = verify_token(credentials.credentials, resolve_key)
    except AuthUnavailable:
        logger.error("Token verification is unavailable")
        raise HTTPException(
            status_code=503, detail="Authentication temporarily unavailable"
        ) from None
    except AuthError as exc:
        logger.info("Rejected token: %s", exc)
        raise _not_authenticated() from None

    with factory() as db:
        row = db.get(AppUser, verified.user_id)
        # Role and status come from our own table on every request, so disabling a user takes
        # effect immediately rather than when their token expires. A user with a valid
        # Supabase token but no row here (for example a self-registered account) is refused.
        if row is None or row.status not in allowed_statuses:
            logger.info("Refused user without allowed access: %s", verified.user_id)
            raise HTTPException(status_code=403, detail="No access to this service")
        # Build the result first: a failed bookkeeping commit expires the row's attributes.
        current = CurrentUser(id=row.id, email=row.email, role=row.role)
        _touch_last_seen(db, row)
        return current


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    resolve_key: KeyResolver = Depends(get_key_resolver),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> CurrentUser:
    """Active users only: every data route uses this."""
    return _authenticate(credentials, resolve_key, factory, _ACTIVE)


def get_known_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    resolve_key: KeyResolver = Depends(get_key_resolver),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> CurrentUser:
    """Invited or active users: only /me and /me/accept, so an invitee can finish signing up."""
    return _authenticate(credentials, resolve_key, factory, _INVITED_OR_ACTIVE)
```

- [ ] **Step 6: Add the `/me` router and wire `main.py`**

Create `backend/app/routers/me.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, sessionmaker

from app.admin import service
from app.auth.deps import CurrentUser, get_known_user
from app.db import get_session_factory
from app.models import AppUser
from app.schemas import AcceptIn, MeOut

router = APIRouter(prefix="/me", tags=["me"], dependencies=[Depends(get_known_user)])


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
```

Replace `backend/app/main.py` with:

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.admin.service import AdminError
from app.routers import analysis, backtest, chat, me, memory, portfolio, preferences

app = FastAPI(title="Trading Agent API")
app.include_router(portfolio.router)
app.include_router(analysis.router)
app.include_router(backtest.router)
app.include_router(memory.router)
app.include_router(chat.router)
app.include_router(preferences.router)
app.include_router(me.router)


@app.exception_handler(AdminError)
def admin_error_handler(request: Request, exc: AdminError) -> JSONResponse:
    """Services raise domain errors; this is the one place they become HTTP responses."""
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 7: Run the tests, then the full check**

Run: `uv run python -m pytest tests/test_me_router.py tests/test_auth_deps.py tests/test_routes_require_auth.py -v`, then the full check from "Environment notes".
Expected: all green. `test_every_route_except_health_requires_authentication` now also covers `/me` and `/me/accept` (they must return 401 unauthenticated).

- [ ] **Step 8: Commit**

```bash
git add backend/app backend/tests/test_me_router.py
git commit -m "feat: let invited users read /me and accept the terms

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Admin API, part 1: list, invite, resend, revoke

**Files:**
- Create: `backend/app/routers/admin.py`, `backend/tests/test_admin_users.py`
- Modify: `backend/app/admin/service.py`, `backend/app/schemas.py`, `backend/app/main.py`

**Interfaces:**
- Consumes: `SupabaseAdmin`, `SupabaseAdminError`, `SupabaseUserExists`, `get_supabase_admin` (Task 2); `AdminError` family, `_get_user`, `_utcnow`, `UPSTREAM_DETAIL` (Task 3); fixtures `admin_client`, `fake_supabase`, `client`, `anon_client`, `db_session`, `add_app_user`, `ADMIN_ID`.
- Produces:
  - `service.list_users(db: Session, status: str | None) -> list[AppUser]`
  - `service.invite_user(db, supabase, email: str, redirect_to: str | None) -> AppUser`
  - `service.resend_invite(db, supabase, user_id: uuid.UUID, redirect_to: str | None) -> AppUser`
  - `service.revoke_invite(db, supabase, user_id: uuid.UUID) -> None`
  - `schemas.AdminUserOut`, `schemas.InviteIn`
  - Routes: `GET /admin/users?status=`, `POST /admin/users/invite` (201), `POST /admin/users/{id}/resend`, `POST /admin/users/{id}/revoke` (204)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_admin_users.py`:

```python
import uuid
from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.auth.supabase_admin import get_supabase_admin
from app.config import settings
from app.main import app
from app.models import AppUser
from tests.auth_support import ADMIN_ID, OTHER_USER_ID, USER_ID, add_app_user

OLD = datetime(2020, 1, 1)


def _row(db_session, user_id) -> AppUser | None:
    db_session.expire_all()
    return db_session.get(AppUser, user_id)


# ---- access control -------------------------------------------------------------------------
def test_admin_routes_require_authentication(anon_client):
    assert anon_client.get("/admin/users").status_code == 401
    assert anon_client.post("/admin/users/invite", json={"email": "a@example.com"}).status_code == 401


def test_a_non_admin_is_refused_on_admin_routes(client):
    assert client.get("/admin/users").status_code == 403
    assert client.post("/admin/users/invite", json={"email": "a@example.com"}).status_code == 403


def test_user_management_is_503_when_the_secret_key_is_not_configured(admin_client, monkeypatch):
    app.dependency_overrides.pop(get_supabase_admin)
    monkeypatch.setattr(settings, "supabase_secret_key", None)

    response = admin_client.post("/admin/users/invite", json={"email": "a@example.com"})

    assert response.status_code == 503
    assert response.json() == {"detail": "User management not configured"}


# ---- list ------------------------------------------------------------------------------------
def test_list_shows_users_with_invitation_expiry_hint(admin_client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "invite_link_hours", 24)
    add_app_user(db_session, USER_ID, status="invited", invited_at=datetime(2026, 9, 28, 10, 0))

    users = {u["id"]: u for u in admin_client.get("/admin/users").json()}

    assert users[str(ADMIN_ID)]["role"] == "admin"
    assert users[str(ADMIN_ID)]["invite_expires_at"] is None
    assert users[str(USER_ID)]["status"] == "invited"
    assert users[str(USER_ID)]["invite_expires_at"].startswith("2026-09-29T10:00:00")


def test_list_filters_by_status_and_rejects_an_unknown_status(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="invited")
    add_app_user(db_session, OTHER_USER_ID, status="disabled")

    invited = admin_client.get("/admin/users?status=invited").json()
    assert [u["id"] for u in invited] == [str(USER_ID)]
    assert admin_client.get("/admin/users?status=bogus").status_code == 422


def test_list_never_exposes_financial_fields(admin_client):
    for user in admin_client.get("/admin/users").json():
        assert set(user) == {
            "id", "email", "role", "status", "created_at", "invited_at",
            "invite_expires_at", "accepted_terms_at", "last_seen_at",
        }  # fmt: skip


# ---- invite ----------------------------------------------------------------------------------
def test_invite_creates_an_invited_user_after_supabase_succeeds(
    admin_client, fake_supabase, db_session, monkeypatch
):
    monkeypatch.setattr(settings, "invite_redirect_url", "https://app.example.com/welcome")
    fake_supabase.next_id = USER_ID

    response = admin_client.post("/admin/users/invite", json={"email": "  New@Example.COM "})

    assert response.status_code == 201
    body = response.json()
    assert body["id"] == str(USER_ID)
    assert body["email"] == "new@example.com"
    assert body["status"] == "invited"
    assert body["invite_expires_at"] is not None
    assert fake_supabase.calls == [("invite", "new@example.com")]
    stored = _row(db_session, USER_ID)
    assert stored.role == "user" and stored.invited_at is not None


def test_invite_rejects_an_invalid_email(admin_client):
    assert admin_client.post("/admin/users/invite", json={"email": "not-an-email"}).status_code == 422


def test_invite_of_an_address_that_already_has_access_is_409(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="active", email="a@example.com")

    response = admin_client.post("/admin/users/invite", json={"email": "a@example.com"})

    assert response.status_code == 409
    assert fake_supabase.calls == []


def test_invite_of_a_still_invited_address_acts_as_a_resend(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="invited", email="a@example.com", invited_at=OLD)
    fake_supabase.ids_by_email["a@example.com"] = USER_ID

    response = admin_client.post("/admin/users/invite", json={"email": "a@example.com"})

    assert response.status_code == 201
    assert response.json()["id"] == str(USER_ID)
    assert _row(db_session, USER_ID).invited_at > OLD
    assert fake_supabase.calls == [("invite", "a@example.com")]


def test_invite_address_already_registered_in_supabase_is_409(
    admin_client, fake_supabase, db_session
):
    fake_supabase.existing_emails.add("taken@example.com")

    response = admin_client.post("/admin/users/invite", json={"email": "taken@example.com"})

    assert response.status_code == 409
    assert db_session.query(AppUser).filter_by(email="taken@example.com").count() == 0


def test_invite_supabase_failure_is_502_and_creates_nothing(admin_client, fake_supabase, db_session):
    fake_supabase.fail_on.add("invite")

    response = admin_client.post("/admin/users/invite", json={"email": "a@example.com"})

    assert response.status_code == 502
    assert response.json() == {"detail": "Could not reach the authentication service"}
    assert db_session.query(AppUser).filter_by(email="a@example.com").count() == 0


def test_invite_database_failure_deletes_the_supabase_user(admin_client, fake_supabase, db_session):
    # The fake hands back an id that already exists in app_users, so the insert fails.
    fake_supabase.next_id = ADMIN_ID

    with pytest.raises(IntegrityError):
        admin_client.post("/admin/users/invite", json={"email": "a@example.com"})

    assert ("delete", ADMIN_ID) in fake_supabase.calls
    assert db_session.query(AppUser).filter_by(email="a@example.com").count() == 0


# ---- resend ----------------------------------------------------------------------------------
def test_resend_refreshes_the_invitation(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="invited", email="a@example.com", invited_at=OLD)

    response = admin_client.post(f"/admin/users/{USER_ID}/resend")

    assert response.status_code == 200
    assert _row(db_session, USER_ID).invited_at > OLD
    assert fake_supabase.calls == [("invite", "a@example.com")]


def test_resend_is_only_for_invited_users(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="active")

    assert admin_client.post(f"/admin/users/{USER_ID}/resend").status_code == 409


def test_resend_unknown_user_is_404(admin_client):
    assert admin_client.post(f"/admin/users/{uuid.uuid4()}/resend").status_code == 404


def test_resend_supabase_failure_is_502_and_changes_nothing(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="invited", invited_at=OLD)
    fake_supabase.fail_on.add("invite")

    assert admin_client.post(f"/admin/users/{USER_ID}/resend").status_code == 502
    assert _row(db_session, USER_ID).invited_at == OLD


# ---- revoke ----------------------------------------------------------------------------------
def test_revoke_deletes_the_invited_user_everywhere(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="invited")

    response = admin_client.post(f"/admin/users/{USER_ID}/revoke")

    assert response.status_code == 204
    assert _row(db_session, USER_ID) is None
    assert fake_supabase.calls == [("delete", USER_ID)]


def test_revoke_is_only_for_invited_users(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="active")

    assert admin_client.post(f"/admin/users/{USER_ID}/revoke").status_code == 409


def test_revoke_supabase_failure_keeps_the_row(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="invited")
    fake_supabase.fail_on.add("delete")

    assert admin_client.post(f"/admin/users/{USER_ID}/revoke").status_code == 502
    assert _row(db_session, USER_ID) is not None
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run python -m pytest tests/test_admin_users.py -v`
Expected: FAIL (404s: the admin routes do not exist yet).

- [ ] **Step 3: Add the schemas**

In `backend/app/schemas.py`:

```python
class InviteIn(BaseModel):
    email: Email


class AdminUserOut(BaseModel):
    """Access-management data only: never anything from the user's portfolio or chats."""

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
```

- [ ] **Step 4: Extend the service**

In `backend/app/admin/service.py` add imports `import logging`, `from collections.abc import Callable`, and

```python
from app.auth.supabase_admin import SupabaseAdmin, SupabaseAdminError, SupabaseUserExists

logger = logging.getLogger(__name__)
```

and these functions (after `accept_terms`):

```python
def _upstream[T](action: str, call: Callable[[], T]) -> T:
    """Runs a Supabase call; any failure becomes a generic 502. Only the class is logged."""
    try:
        return call()
    except SupabaseAdminError as exc:
        logger.error("Supabase %s failed: %s", action, type(exc).__name__)
        raise UpstreamError(UPSTREAM_DETAIL) from None


def list_users(db: Session, status: str | None) -> list[AppUser]:
    query = db.query(AppUser)
    if status is not None:
        query = query.filter_by(status=status)
    return query.order_by(AppUser.created_at, AppUser.email).all()


def invite_user(
    db: Session, supabase: SupabaseAdmin, email: str, redirect_to: str | None
) -> AppUser:
    existing = db.query(AppUser).filter_by(email=email).one_or_none()
    if existing is not None:
        if existing.status != "invited":
            raise Conflict("That address already has access")
        return resend_invite(db, supabase, existing.id, redirect_to)

    try:
        supabase_id = supabase.invite(email, redirect_to)
    except SupabaseUserExists:
        raise Conflict("That address is already registered") from None
    except SupabaseAdminError as exc:
        logger.error("Supabase invite failed: %s", type(exc).__name__)
        raise UpstreamError(UPSTREAM_DETAIL) from None

    user = AppUser(
        id=supabase_id, email=email, role="user", status="invited", invited_at=_utcnow()
    )
    try:
        db.add(user)
        db.commit()
    except Exception:
        db.rollback()
        # Do not leave a Supabase user (and a sent email) that we have no record of.
        try:
            supabase.delete(supabase_id)
        except SupabaseAdminError as exc:
            logger.error("Compensating Supabase delete failed: %s", type(exc).__name__)
        raise
    db.refresh(user)
    return user


def resend_invite(
    db: Session, supabase: SupabaseAdmin, user_id: uuid.UUID, redirect_to: str | None
) -> AppUser:
    user = _get_user(db, user_id)
    if user.status != "invited":
        raise Conflict("Only pending invitations can be resent")
    _upstream("invite", lambda: supabase.invite(user.email, redirect_to))
    user.invited_at = _utcnow()
    db.commit()
    db.refresh(user)
    return user


def revoke_invite(db: Session, supabase: SupabaseAdmin, user_id: uuid.UUID) -> None:
    user = _get_user(db, user_id)
    if user.status != "invited":
        raise Conflict("Only pending invitations can be revoked")
    _upstream("delete", lambda: supabase.delete(user.id))
    db.delete(user)
    db.commit()
```

- [ ] **Step 5: Add the admin router**

Create `backend/app/routers/admin.py`:

```python
import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.admin import service
from app.auth.deps import get_user_db, require_admin
from app.auth.supabase_admin import SupabaseAdmin, get_supabase_admin
from app.config import settings
from app.models import AppUser
from app.schemas import AdminUserOut, InviteIn

# require_admin runs first for every route here (it depends on get_current_user), so an
# unauthenticated caller gets 401 and a non-admin gets 403 before anything else happens.
router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _to_out(user: AppUser) -> AdminUserOut:
    out = AdminUserOut.model_validate(user)
    if user.status == "invited" and user.invited_at is not None:
        out.invite_expires_at = user.invited_at + timedelta(hours=settings.invite_link_hours)
    return out


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    status: Literal["invited", "active", "disabled"] | None = None,
    db: Session = Depends(get_user_db),
) -> list[AdminUserOut]:
    return [_to_out(u) for u in service.list_users(db, status)]


@router.post("/users/invite", response_model=AdminUserOut, status_code=201)
def invite_user(
    payload: InviteIn,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> AdminUserOut:
    user = service.invite_user(db, supabase, payload.email, settings.invite_redirect_url)
    return _to_out(user)


@router.post("/users/{user_id}/resend", response_model=AdminUserOut)
def resend_invite(
    user_id: uuid.UUID,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> AdminUserOut:
    user = service.resend_invite(db, supabase, user_id, settings.invite_redirect_url)
    return _to_out(user)


@router.post("/users/{user_id}/revoke", status_code=204)
def revoke_invite(
    user_id: uuid.UUID,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> Response:
    service.revoke_invite(db, supabase, user_id)
    return Response(status_code=204)
```

In `backend/app/main.py` change the router import to include `admin` and add `app.include_router(admin.router)` after `app.include_router(me.router)`.

- [ ] **Step 6: Run the tests, then the full check**

Run: `uv run python -m pytest tests/test_admin_users.py tests/test_routes_require_auth.py -v`, then the full check.
Expected: all green. The route-protection test now also covers every new admin route (401 unauthenticated). If `test_invite_database_failure_deletes_the_supabase_user` does not raise `IntegrityError` through the TestClient, the insert did not conflict: confirm the fake returns `ADMIN_ID` and that the admin row exists.

- [ ] **Step 7: Commit**

```bash
git add backend/app backend/tests/test_admin_users.py
git commit -m "feat: add admin routes to list, invite, resend, and revoke users

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Admin API, part 2: disable, enable, remove

**Files:**
- Create: `backend/tests/test_admin_lifecycle.py`
- Modify: `backend/app/admin/service.py`, `backend/app/routers/admin.py`, `backend/app/schemas.py`

**Interfaces:**
- Consumes: Task 4 service/router/fixtures; `rls.USER_TABLES`, `Base`, `open_user_session`, `get_session_factory`; `ROW_FACTORIES` (Task 2).
- Produces:
  - `service.disable_user(db, supabase, user_id: uuid.UUID, acting_admin_id: uuid.UUID) -> AppUser`
  - `service.enable_user(db, supabase, user_id: uuid.UUID) -> AppUser`
  - `service.remove_user(db, supabase, factory: sessionmaker[Session], user_id: uuid.UUID, confirm_email: str, acting_admin_id: uuid.UUID) -> None`
  - `schemas.RemoveIn(confirm_email: Email)`
  - Routes: `POST /admin/users/{id}/disable`, `POST /admin/users/{id}/enable`, `DELETE /admin/users/{id}` (204, body `{confirm_email}`)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_admin_lifecycle.py`:

```python
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app import rls
from app.db import Base
from app.models import AppUser
from tests.auth_support import (
    ADMIN_ID,
    OTHER_USER_ID,
    ROW_FACTORIES,
    USER_ID,
    add_app_user,
    auth_headers,
)


def _row(db_session, user_id) -> AppUser | None:
    db_session.expire_all()
    return db_session.get(AppUser, user_id)


def _count(engine, table_name: str, user_id) -> int:
    table = Base.metadata.tables[table_name]
    with sessionmaker(bind=engine)() as session:
        return session.execute(
            select(func.count()).select_from(table).where(table.c.user_id == user_id)
        ).scalar_one()


# ---- disable / enable ------------------------------------------------------------------------
def test_disable_bans_the_user_and_locks_them_out_immediately(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="active")
    token_headers = auth_headers(USER_ID)
    assert admin_client.get("/portfolio/holdings", headers=token_headers).status_code == 200

    response = admin_client.post(f"/admin/users/{USER_ID}/disable")

    assert response.status_code == 200
    assert response.json()["status"] == "disabled"
    assert fake_supabase.calls == [("ban", USER_ID)]
    # Same unexpired token, now refused.
    assert admin_client.get("/portfolio/holdings", headers=token_headers).status_code == 403
    assert admin_client.get("/me", headers=token_headers).status_code == 403


def test_disable_supabase_failure_is_502_and_changes_nothing(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="active")
    fake_supabase.fail_on.add("ban")

    assert admin_client.post(f"/admin/users/{USER_ID}/disable").status_code == 502
    assert _row(db_session, USER_ID).status == "active"


def test_an_admin_cannot_disable_themselves(admin_client, db_session, fake_supabase):
    assert admin_client.post(f"/admin/users/{ADMIN_ID}/disable").status_code == 409
    assert fake_supabase.calls == []
    assert _row(db_session, ADMIN_ID).status == "active"


def test_disabling_another_admin_leaves_the_caller_an_active_admin(
    admin_client, db_session
):
    add_app_user(db_session, OTHER_USER_ID, role="admin")

    assert admin_client.post(f"/admin/users/{OTHER_USER_ID}/disable").status_code == 200

    assert _row(db_session, OTHER_USER_ID).status == "disabled"
    assert _row(db_session, ADMIN_ID).status == "active"  # at least one active admin remains


def test_disable_only_applies_to_active_users(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="invited")
    add_app_user(db_session, OTHER_USER_ID, status="disabled")

    assert admin_client.post(f"/admin/users/{USER_ID}/disable").status_code == 409
    assert admin_client.post(f"/admin/users/{OTHER_USER_ID}/disable").status_code == 409
    assert admin_client.post(f"/admin/users/{uuid.uuid4()}/disable").status_code == 404


def test_enable_unbans_and_reactivates(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="disabled")

    response = admin_client.post(f"/admin/users/{USER_ID}/enable")

    assert response.status_code == 200
    assert response.json()["status"] == "active"
    assert fake_supabase.calls == [("unban", USER_ID)]


def test_enable_supabase_failure_is_502_and_keeps_the_user_disabled(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="disabled")
    fake_supabase.fail_on.add("unban")

    assert admin_client.post(f"/admin/users/{USER_ID}/enable").status_code == 502
    assert _row(db_session, USER_ID).status == "disabled"


def test_enable_only_applies_to_disabled_users(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="active")

    assert admin_client.post(f"/admin/users/{USER_ID}/enable").status_code == 409


# ---- remove ----------------------------------------------------------------------------------
def _remove(admin_client, user_id, email):
    return admin_client.request("DELETE", f"/admin/users/{user_id}", json={"confirm_email": email})


def test_remove_requires_the_matching_email_and_changes_nothing_otherwise(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="active", email="target@example.com")

    response = _remove(admin_client, USER_ID, "wrong@example.com")

    assert response.status_code == 422
    assert fake_supabase.calls == []
    assert _row(db_session, USER_ID).status == "active"


def test_remove_deletes_only_the_targets_data_and_accounts(
    admin_client, db_session, engine, fake_supabase
):
    add_app_user(db_session, USER_ID, status="active", email="target@example.com")
    add_app_user(db_session, OTHER_USER_ID, status="active")
    for table_name in rls.USER_TABLES:
        db_session.add_all(
            [ROW_FACTORIES[table_name](USER_ID), ROW_FACTORIES[table_name](OTHER_USER_ID)]
        )
    db_session.commit()

    response = _remove(admin_client, USER_ID, "target@example.com")

    assert response.status_code == 204
    assert fake_supabase.calls == [("ban", USER_ID), ("delete", USER_ID)]
    assert _row(db_session, USER_ID) is None
    for table_name in rls.USER_TABLES:
        assert _count(engine, table_name, USER_ID) == 0, table_name
        assert _count(engine, table_name, OTHER_USER_ID) == 1, table_name
    assert _row(db_session, OTHER_USER_ID) is not None


def test_a_remove_that_fails_at_supabase_leaves_the_user_disabled_and_a_retry_completes_it(
    admin_client, db_session, engine, fake_supabase
):
    add_app_user(db_session, USER_ID, status="active", email="target@example.com")
    db_session.add(ROW_FACTORIES["holdings"](USER_ID))
    db_session.commit()
    fake_supabase.fail_on.add("delete")

    first = _remove(admin_client, USER_ID, "target@example.com")

    assert first.status_code == 502
    assert _row(db_session, USER_ID).status == "disabled"  # access is already cut
    assert _count(engine, "holdings", USER_ID) == 0

    fake_supabase.fail_on.clear()
    second = _remove(admin_client, USER_ID, "target@example.com")

    assert second.status_code == 204
    assert _row(db_session, USER_ID) is None


def test_an_admin_cannot_remove_themselves(admin_client, db_session, fake_supabase):
    response = _remove(admin_client, ADMIN_ID, "admin@example.com")

    assert response.status_code == 409
    assert fake_supabase.calls == []
    assert _row(db_session, ADMIN_ID) is not None


def test_remove_unknown_user_is_404(admin_client):
    assert _remove(admin_client, uuid.uuid4(), "a@example.com").status_code == 404


def test_remove_works_for_a_pending_invitation(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="invited", email="pending@example.com")

    assert _remove(admin_client, USER_ID, "pending@example.com").status_code == 204
    assert _row(db_session, USER_ID) is None


def test_lifecycle_routes_require_admin(client, anon_client):
    assert client.post(f"/admin/users/{USER_ID}/disable").status_code == 403
    assert client.request("DELETE", f"/admin/users/{USER_ID}", json={"confirm_email": "a@b.co"}).status_code == 403
    assert anon_client.post(f"/admin/users/{USER_ID}/enable").status_code == 401
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run python -m pytest tests/test_admin_lifecycle.py -v`
Expected: FAIL (404/405: the routes do not exist yet).

- [ ] **Step 3: Add `RemoveIn`**

In `backend/app/schemas.py` (next to `InviteIn`):

```python
class RemoveIn(BaseModel):
    confirm_email: Email  # must repeat the user's email; the API's safeguard for a permanent delete
```

- [ ] **Step 4: Extend the service**

In `backend/app/admin/service.py` add imports `from sqlalchemy import delete`, `from sqlalchemy.orm import sessionmaker` (extend the existing `sqlalchemy.orm` import), `from app import rls`, `from app.db import Base, open_user_session`; then append:

```python
def _reject_self(user: AppUser, acting_admin_id: uuid.UUID) -> None:
    # The caller is always an active admin (require_admin), so refusing self-service is also
    # what guarantees at least one active admin always remains.
    if user.id == acting_admin_id:
        raise Conflict("You can't do that to your own account")


def disable_user(
    db: Session, supabase: SupabaseAdmin, user_id: uuid.UUID, acting_admin_id: uuid.UUID
) -> AppUser:
    user = _get_user(db, user_id)
    _reject_self(user, acting_admin_id)
    if user.status != "active":
        raise Conflict("Only active users can be disabled")
    # Supabase first: if it fails, nothing changes on our side.
    _upstream("ban", lambda: supabase.ban(user.id))
    user.status = "disabled"
    db.commit()
    db.refresh(user)
    return user


def enable_user(db: Session, supabase: SupabaseAdmin, user_id: uuid.UUID) -> AppUser:
    user = _get_user(db, user_id)
    if user.status != "disabled":
        raise Conflict("Only disabled users can be enabled")
    _upstream("unban", lambda: supabase.unban(user.id))
    user.status = "active"
    db.commit()
    db.refresh(user)
    return user


def _delete_user_data(factory: sessionmaker[Session], user_id: uuid.UUID) -> None:
    """Deletes the user's rows in every user-data table through a session scoped to that user.
    RLS limits each DELETE to their own rows; nothing is read."""
    with open_user_session(factory, user_id) as session:
        for table_name in rls.USER_TABLES:
            session.execute(delete(Base.metadata.tables[table_name]))
        session.commit()


def remove_user(
    db: Session,
    supabase: SupabaseAdmin,
    factory: sessionmaker[Session],
    user_id: uuid.UUID,
    confirm_email: str,
    acting_admin_id: uuid.UUID,
) -> None:
    """Permanent removal. Order: cut access, delete data, delete the Supabase user, delete the
    row. A failure after the first step leaves the user disabled; the call can be repeated."""
    user = _get_user(db, user_id)
    _reject_self(user, acting_admin_id)
    if user.email != confirm_email:
        raise Unprocessable("Confirmation email does not match")

    if user.status != "disabled":
        _upstream("ban", lambda: supabase.ban(user.id))
        user.status = "disabled"
        db.commit()

    _delete_user_data(factory, user.id)
    _upstream("delete", lambda: supabase.delete(user.id))
    db.delete(user)
    db.commit()
```

- [ ] **Step 5: Add the routes**

In `backend/app/routers/admin.py` add `from sqlalchemy.orm import Session, sessionmaker` (extend the existing import), `from app.auth.deps import CurrentUser, get_user_db, require_admin`, `from app.db import get_session_factory`, `from app.schemas import AdminUserOut, InviteIn, RemoveIn`, then append:

```python
@router.post("/users/{user_id}/disable", response_model=AdminUserOut)
def disable_user(
    user_id: uuid.UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> AdminUserOut:
    return _to_out(service.disable_user(db, supabase, user_id, admin.id))


@router.post("/users/{user_id}/enable", response_model=AdminUserOut)
def enable_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> AdminUserOut:
    return _to_out(service.enable_user(db, supabase, user_id))


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

- [ ] **Step 6: Run the tests, then the full check**

Run: `uv run python -m pytest tests/test_admin_lifecycle.py tests/test_admin_users.py tests/test_routes_require_auth.py -v`, then the full check.
Expected: all green. If bandit flags `service.py`, do not add a `nosec`: the SQL is built with SQLAlchemy `delete()` and no strings.

- [ ] **Step 7: Commit**

```bash
git add backend/app backend/tests/test_admin_lifecycle.py
git commit -m "feat: add admin routes to disable, enable, and remove users

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Documentation and copy corrections

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `docs/superpowers/specs/2026-09-28-frontend-design-direction-design.md`, `docs/design/mockups/auth-and-admin.html`

**Interfaces:** none.

- [ ] **Step 1: Update `docs/ARCHITECTURE.md`**

Make these edits (search for the quoted text):

1. §4 `AppUser` model block: replace the two lines
   `id (= Supabase auth uid), email (unique), role ("admin"|"user"), status ("active"|"disabled"),` / `created_at, accepted_terms_at, last_seen_at` with
   `id (= Supabase auth uid), email (unique), role ("admin"|"user"), status ("invited"|"active"|"disabled"),` / `created_at, invited_at, accepted_terms_at, last_seen_at`, and extend the comment line with: `The runtime role may INSERT/DELETE rows and UPDATE only status, accepted_terms_at, last_seen_at, invited_at: it cannot change id, email, or role.`
2. §5 API table: add these rows after the `/chat` row:

   ````markdown
   | GET | `/me` | — | The caller's own id, email, role, status, `accepted_terms_at`; allowed for invited and active users |
   | POST | `/me/accept` | `{accept_terms: true}` | Records terms acceptance and activates an invited user (idempotent) |
   | GET | `/admin/users?status=` | — | **Admin only.** List users (access data only: never portfolios, recommendations, or chats); `invite_expires_at` is a display hint |
   | POST | `/admin/users/invite` | `{email}` | **Admin only.** Supabase invite (24 h link) and an `app_users` row with status `invited`; an already-invited address is re-sent |
   | POST | `/admin/users/{id}/resend` | — | **Admin only.** Re-send an invitation (invited users) |
   | POST | `/admin/users/{id}/revoke` | — | **Admin only.** Delete a pending invitation |
   | POST | `/admin/users/{id}/disable` , `/enable` | — | **Admin only.** Ban/unban in Supabase and set status; disabling takes effect on the next request |
   | DELETE | `/admin/users/{id}` | `{confirm_email}` | **Admin only.** Permanent removal: disables, deletes the user's rows (through their own RLS scope), the Supabase user, then the `app_users` row; retryable |
   ````
   And after the existing "Every route except `/health`…" paragraph add: "Admin routes return `403` to non-admins; `409` for an invalid state or acting on yourself; `502` (generic message) when Supabase cannot be reached; `503` when `SUPABASE_URL` or `SUPABASE_SECRET_KEY` is unset. An invited user can call only `/me` and `/me/accept`; every other route stays `403` until they accept."
3. §11 config block: add lines
   `SUPABASE_SECRET_KEY=                        # backend only; Supabase Auth admin calls (invite, ban, delete)`,
   `INVITE_REDIRECT_URL=                        # where the emailed link lands (the frontend accept page)`,
   `INVITE_LINK_HOURS=24                        # display hint only; Supabase enforces the real expiry`.
4. §13: replace the final bullet "Invitations, the admin API, per-user limits, and export/delete are built in later cycles (see the auth and multi-user specs under `docs/superpowers/specs/`)." with:

   ````markdown
   - **Invitations (admin API).** The admin invites by email through Supabase's invite API:
     the backend calls it with `SUPABASE_SECRET_KEY` and records an `invited` row in
     `app_users`; the invitee's emailed link signs them in at `INVITE_REDIRECT_URL`, they set a
     password with Supabase's client, then the frontend calls `POST /me/accept`.
     The link lifetime is the project's **Email OTP expiration**, shared with password-reset and
     other email links; set it to 86400 seconds (24 hours). Supabase discourages longer, so an
     expired invitation is handled by Resend. The built-in mailer is 2 emails per hour and for
     testing only: configure **custom SMTP** (Authentication, Emails, SMTP Settings). The
     redirect URL must be in the project's allowed redirect URLs, or Supabase silently sends the
     link to the Site URL. `SUPABASE_SECRET_KEY` bypasses Row Level Security on Supabase's own
     tables: keep it in the backend environment only.
   - Per-user limits, usage, and the user's own export/delete are built in the next cycle
     (see the specs under `docs/superpowers/specs/`).
   ````
5. §16: add under "Data model & security": `- [x] Invitation flow, admin user management, and narrowed \`app_users\` grants (sub-project 2b)`.

- [ ] **Step 2: Correct the invitation-lifetime copy**

In `docs/superpowers/specs/2026-09-28-frontend-design-direction-design.md` (Admin section) replace `an amber "expires tomorrow"` with `an amber "expires soon"` and `7-day link validity` with `24-hour link validity`.

In `docs/design/mockups/auth-and-admin.html` make these text-only replacements (search for each exact string):
- `This link expires in 5 days.` becomes `This link expires in 24 hours.`
- `Expires in 5 days` becomes `Expires in 18 hours`
- `Expires tomorrow` becomes `Expires in 2 hours`
- `The invitation link is valid for 7 days.` becomes `The invitation link is valid for 24 hours.`
- `Invited &middot; expires in 5 days` becomes `Invited &middot; expires in 18 hours`
- `Invited &middot; expires tomorrow` becomes `Invited &middot; expires in 2 hours`

- [ ] **Step 3: Full check and commit**

Run the full check from "Environment notes" (docs-only, but confirm nothing else moved). Expected: green.

```bash
git add docs/ARCHITECTURE.md docs/superpowers/specs/2026-09-28-frontend-design-direction-design.md docs/design/mockups/auth-and-admin.html
git commit -m "docs: document the admin API and invitation flow, and correct the link lifetime copy

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Owner verification against Supabase (done by the project owner, not automated)**

This proves what unit tests cannot: the real Supabase HTTP behavior. Do these before merging and report the results.
1. Supabase: configure custom SMTP; set Email OTP expiration to 86400; add `INVITE_REDIRECT_URL` (a placeholder is fine for now) to Authentication, URL Configuration, allowed redirect URLs.
2. `backend/.env`: add `SUPABASE_SECRET_KEY` (Project Settings, API Keys, the `sb_secret_...` key), `INVITE_REDIRECT_URL`, optionally `INVITE_LINK_HOURS`. Never commit it.
3. Run the new migration: `uv run alembic upgrade head` (with `MIGRATION_DATABASE_URL` set). Then in the SQL editor confirm the narrowed grants: `select has_column_privilege('trading_agent_app','app_users','role','UPDATE');` must be `false`, and the same query for `status` must be `true`.
4. Start the API; as admin (your token) `POST /admin/users/invite {"email": "<an address you can read>"}` and expect 201 and an email. If it returns 502, look at the Supabase Auth logs: the likely causes are the secret-key header format or SMTP not configured.
5. Click the link; check `GET /me` with the invitee's token shows `"status":"invited"`; `POST /me/accept {"accept_terms": true}` and confirm `"active"`.
6. As admin: `GET /admin/users`, `POST .../disable` (then confirm the invitee's login is refused), `.../enable`, and `DELETE /admin/users/{id}` with `{"confirm_email": "..."}`; confirm the user disappears from both the API and Supabase's Users list.
