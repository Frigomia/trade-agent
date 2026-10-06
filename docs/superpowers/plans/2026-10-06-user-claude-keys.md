# Per-user Claude keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invited users bring their own Anthropic key (stored encrypted, never shown again); every Claude call made for them uses it; the admin keeps using the server key.

**Architecture:** A new `app/claude_keys.py` holds AES-256-GCM encryption (master secret in a Fly secret) and `resolve_client`, which picks the client for a request. A new table `user_api_keys` (row-level security like the other user tables) stores one encrypted key per user, mirrored by a plain status column on `app_users` so the admin screen can show "connected" without reading anyone's key. Three routes under `/me/claude-key` save (after one free validation call to Anthropic), report and delete it. Chat and analysis resolve the caller's client at the start of the request or job and pass it down; a user with no key gets a `409 claude_key_required`.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic (hand-written migration), `cryptography` (already installed), `anthropic` SDK, pytest on Postgres; Next.js 16 + MUI + SWR + Vitest for the frontend part.

**Spec:** `docs/superpowers/specs/2026-10-06-user-claude-keys-design.md` (a few details are corrected in Task 0 below).

## Global Constraints

- The system never places a trade; no code calls a broker (repo rule).
- A saved key is never returned by any route, never logged, never in an exception message, never put in Redis or job state, and never cached in a module global. Decrypted keys live only for one request or job.
- Row-level security: `user_api_keys` has a `user_id` column, so it must be in `app/rls.py` `USER_TABLES` (a test enforces this) and gets the same forced owner-only policy as the other user tables.
- Migrations are never hand-edited once created, and generated ones are never edited; this plan adds one new hand-written migration file (new files are allowed).
- Python 3.12, ruff line length 100, mypy clean (`uv run mypy app`), `uv run python -m pytest tests -q` green before every commit that touches backend code. Run them from `backend/`.
- Frontend: `npx eslint .`, `npx tsc --noEmit` and `npx vitest run` green, from `frontend/`.
- Commit trailer exactly `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never skip hooks or signing; Conventional Commits; branch `feature/user-claude-keys` for the code.
- Test database note: if a test run is interrupted, the test database can be left dirty ("policy ... already exists"); fix with `docker exec backend-postgres-1 psql -U trading_agent -d postgres -c "DROP DATABASE IF EXISTS trading_agent_test WITH (FORCE)"`.
- Before the pull request, the `security-reviewer` subagent reviews the full diff (Task 13). Before any frontend code, the design step (Task 7) runs with the `huashu-design` and `impeccable` skills and the user picks a direction (project memory: design-fe-flows-before-coding).

## Review Focus

Inputs and conditions the spec implies but its tasks do not name; each has a test in the task that owns the code.

1. **A 422 body can echo the submitted key.** FastAPI's validation errors include the offending `input`; the save route therefore validates the key's shape itself and returns a fixed message. Test in Task 3 (the body of a rejected save never contains the key).
2. **Whitespace or a trailing newline pasted with the key.** Pasted keys often carry a newline; the route strips it and rejects internal whitespace. Test in Task 3.
3. **Saving a second key.** Replaces the first, one row only, status back to `ok`, last four updated. Test in Task 3.
4. **Admin with a personal key flagged `needs_attention`.** Does not silently fall back to the server key; the reconnect message shows, and removing the personal key restores the server key. Test in Task 4.
5. **A revoked key discovered by the news agent (analysis).** The second opinion fails quietly today; the key status must still flip to `needs_attention`. Test in Task 4.
6. **Deleting a user's data / removing a user.** The key row goes with the rest (`USER_TABLES` loop); a test in Task 2 already iterates every user table.
7. **Lost or rotated master secret.** Decrypting fails with `KeyEncryptionError`, never a 500 with key material; the chat route turns it into the reconnect message. Test in Task 4.

---

### Task 0: Correct the specs

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-user-claude-keys-design.md`
- Modify: `docs/superpowers/specs/2026-10-06-scheduled-analysis-design.md`

**Interfaces:**
- Produces: specs that match what the plan builds (later tasks and reviewers read them).

Findings from reading the code that change the spec text (decisions unchanged):
- `user_api_keys` follows the other user tables: an integer `id` primary key plus a unique `user_id`, because `rls.grant_table_sql` grants the `<table>_id_seq` sequence for every user table.
- The admin screen cannot read `user_api_keys` (row-level security is owner-only), so a plain `claude_key_state` column (`none`, `ok`, `needs_attention`) on `app_users` mirrors it; the runtime role is allowed to update that column.
- The master-secret check is a web start-up check like the runtime-role check, not a `Settings` validator, so the release command and the jobs are not affected; decrypting without the secret in production raises `KeyEncryptionError`.
- The data export does not include the key and does not add a field (it is simply not part of the export).
- Scheduled analysis spec: the `SUPERSEDED` status already exists (`app/agents/jobs.py` already marks an older pending call `SUPERSEDED` when a new one is created), so only the `source` column is new.

- [ ] **Step 1: Edit the keys spec**

In the "Storage and encryption" section replace the first bullet with:

```markdown
- New table `user_api_keys`: `id` (integer primary key, like every user table), `user_id` (unique), `ciphertext`, `key_version`, `last4`, `status` (`ok` or `needs_attention`), `created_at`, `updated_at`. One key per user. It is added to `USER_TABLES` and `RUNTIME_TABLES`, so it gets the same forced owner-only policy as the other user tables. The admin API never selects from it. Because the admin cannot read it either (the policy is owner-only), `app_users` gets a plain `claude_key_state` column (`none`, `ok` or `needs_attention`), updated in the same transaction as every save, delete or status change; the admin Users screen reads that.
```

Replace the sentence "With `APP_ENV=production` the app refuses to start without it, the same pattern as the TLS guard (the message names the setting and never prints a value)." with:

```markdown
With `APP_ENV=production` the web process refuses to start without a valid secret, the same pattern as the runtime-role start-up check (the message names the setting and never prints a value); the release command and the one-off jobs are not blocked, but decrypting without the secret raises an error that names the setting.
```

In "Other effects" replace the first bullet with:

```markdown
- Deleting someone's data (or removing the user) deletes their key row, because every user table is cleared. The data export does not include the key.
```

- [ ] **Step 2: Edit the scheduled-analysis spec**

In "Data change" replace the second bullet with:

```markdown
- `recommendations` gets a `source` column (`manual` or `scheduled`), so the screen can label automatic calls. The `SUPERSEDED` status already exists: `app/agents/jobs.py` already marks an older PENDING call of the same ticker `SUPERSEDED` when a new one is created, so the scheduled step reuses that and only adds the rule that a pending call younger than 3 days is skipped. The migration for the new column is hand-written.
```

In "Open points to confirm during implementation" delete the second bullet (about `SUPERSEDED` needing a constraint).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs
git commit -m "docs: align the Claude keys and scheduled analysis specs with the code

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Encryption, the master secret and the start-up check

**Files:**
- Create: `backend/app/claude_keys.py`
- Modify: `backend/app/config.py` (one new setting)
- Modify: `backend/app/main.py` (start-up check)
- Test: `backend/tests/test_claude_keys_crypto.py`
- Test: `backend/tests/test_main_startup.py` (two new tests)

**Interfaces:**
- Produces (used by every later task):
  - `settings.key_encryption_secret: str | None`
  - `class KeyEncryptionError(Exception)`
  - `KEY_VERSION: int = 1`
  - `encrypt_key(user_id: uuid.UUID, api_key: str) -> bytes`
  - `decrypt_key(user_id: uuid.UUID, blob: bytes) -> str`
  - `check_master_secret() -> None`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_claude_keys_crypto.py`:

```python
import base64
import uuid

import pytest

from app.claude_keys import KeyEncryptionError, check_master_secret, decrypt_key, encrypt_key
from app.config import settings

USER = uuid.UUID("00000000-0000-0000-0000-000000000001")
OTHER = uuid.UUID("00000000-0000-0000-0000-000000000002")
KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"
GOOD_SECRET = base64.b64encode(bytes(range(32))).decode()


def test_round_trip():
    assert decrypt_key(USER, encrypt_key(USER, KEY)) == KEY


def test_the_ciphertext_does_not_contain_the_key():
    blob = encrypt_key(USER, KEY)

    assert KEY.encode() not in blob
    assert b"sk-ant" not in blob


def test_every_save_uses_a_new_nonce():
    assert encrypt_key(USER, KEY) != encrypt_key(USER, KEY)


def test_another_users_id_cannot_decrypt_it():
    blob = encrypt_key(USER, KEY)

    with pytest.raises(KeyEncryptionError):
        decrypt_key(OTHER, blob)


def test_a_tampered_ciphertext_fails():
    blob = bytearray(encrypt_key(USER, KEY))
    blob[-1] ^= 1

    with pytest.raises(KeyEncryptionError):
        decrypt_key(USER, bytes(blob))


def test_a_failure_message_carries_no_key_material():
    blob = bytearray(encrypt_key(USER, KEY))
    blob[-1] ^= 1

    with pytest.raises(KeyEncryptionError) as excinfo:
        decrypt_key(USER, bytes(blob))

    assert KEY not in str(excinfo.value)
    assert excinfo.value.__cause__ is None


def test_a_different_master_secret_cannot_decrypt(monkeypatch):
    blob = encrypt_key(USER, KEY)
    monkeypatch.setattr(settings, "key_encryption_secret", GOOD_SECRET)

    with pytest.raises(KeyEncryptionError):
        decrypt_key(USER, blob)


def test_development_works_without_any_configuration(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "key_encryption_secret", None)

    assert decrypt_key(USER, encrypt_key(USER, KEY)) == KEY


def test_production_without_a_secret_refuses_to_encrypt_and_to_start(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "key_encryption_secret", None)

    with pytest.raises(KeyEncryptionError, match="KEY_ENCRYPTION_SECRET"):
        encrypt_key(USER, KEY)
    with pytest.raises(KeyEncryptionError, match="KEY_ENCRYPTION_SECRET"):
        check_master_secret()


@pytest.mark.parametrize(
    "secret",
    ["not base64 !!!", base64.b64encode(b"too short").decode()],
    ids=["not-base64", "wrong-length"],
)
def test_production_rejects_a_malformed_secret_without_printing_it(monkeypatch, secret):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "key_encryption_secret", secret)

    with pytest.raises(KeyEncryptionError) as excinfo:
        check_master_secret()

    assert secret not in str(excinfo.value)


def test_production_accepts_a_valid_secret(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "key_encryption_secret", GOOD_SECRET)

    check_master_secret()
    assert decrypt_key(USER, encrypt_key(USER, KEY)) == KEY
```

Append to `backend/tests/test_main_startup.py` (after the existing tests; it already imports `main`, `MagicMock`, `pytest`, and defines `_run_lifespan`):

```python
def test_startup_checks_the_key_secret_in_production(monkeypatch):
    check = MagicMock()
    monkeypatch.setattr(main, "check_runtime_role", MagicMock())
    monkeypatch.setattr(main, "check_master_secret", check)
    monkeypatch.setattr(main.settings, "app_env", "production")
    monkeypatch.setattr(main, "engine", MagicMock())
    _run_lifespan()
    check.assert_called_once()


def test_startup_refuses_without_the_key_secret_in_production(monkeypatch):
    monkeypatch.setattr(main, "check_runtime_role", MagicMock())
    monkeypatch.setattr(
        main, "check_master_secret", MagicMock(side_effect=main.KeyEncryptionError("x"))
    )
    monkeypatch.setattr(main.settings, "app_env", "production")
    monkeypatch.setattr(main, "engine", MagicMock())
    with pytest.raises(main.KeyEncryptionError):
        _run_lifespan()


def test_startup_skips_the_key_secret_check_outside_production(monkeypatch):
    check = MagicMock()
    monkeypatch.setattr(main, "check_master_secret", check)
    _run_lifespan()
    check.assert_not_called()
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && uv run python -m pytest tests/test_claude_keys_crypto.py tests/test_main_startup.py -q`
Expected: collection error (`app.claude_keys` does not exist).

- [ ] **Step 3: Implement**

Create `backend/app/claude_keys.py`:

```python
"""Per-user Claude API keys: encryption at rest, and (later in this file) which client a request uses."""

import base64
import binascii
import os
import uuid

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings

KEY_VERSION = 1
_NONCE_BYTES = 12
_SECRET_BYTES = 32
# Used outside production only, so local runs and tests need no configuration. Production refuses to
# start without the real secret (check_master_secret), so this value never encrypts a real key.
_DEV_SECRET = base64.b64encode(b"dev-only-secret-not-for-prod-123").decode()


class KeyEncryptionError(Exception):
    """The master secret is missing or malformed, or stored key material cannot be decrypted.
    Messages name the setting and never carry key material or the secret itself."""


def _master_key() -> bytes:
    secret = settings.key_encryption_secret
    if not secret:
        if settings.app_env == "production":
            raise KeyEncryptionError("KEY_ENCRYPTION_SECRET is not set")
        secret = _DEV_SECRET
    try:
        raw = base64.b64decode(secret, validate=True)
    except (binascii.Error, ValueError):
        raise KeyEncryptionError("KEY_ENCRYPTION_SECRET is not valid base64") from None
    if len(raw) != _SECRET_BYTES:
        raise KeyEncryptionError("KEY_ENCRYPTION_SECRET must decode to 32 bytes")
    return raw


def check_master_secret() -> None:
    """Raises KeyEncryptionError when the secret is missing or malformed (web start-up, production)."""
    _master_key()


def encrypt_key(user_id: uuid.UUID, api_key: str) -> bytes:
    """`nonce || ciphertext+tag`, with the user's id bound in as associated data so a ciphertext
    copied to another user's row fails to decrypt."""
    nonce = os.urandom(_NONCE_BYTES)
    return nonce + AESGCM(_master_key()).encrypt(nonce, api_key.encode(), user_id.bytes)


def decrypt_key(user_id: uuid.UUID, blob: bytes) -> str:
    try:
        plain = AESGCM(_master_key()).decrypt(
            blob[:_NONCE_BYTES], blob[_NONCE_BYTES:], user_id.bytes
        )
    except KeyEncryptionError:
        raise
    except Exception:
        # `from None`: the underlying error text must not travel with this one.
        raise KeyEncryptionError("stored key could not be decrypted") from None
    return plain.decode()
```

In `backend/app/config.py`, add the setting next to the other secrets (after `supabase_secret_key`):

```python
    key_encryption_secret: str | None = None  # base64 of 32 random bytes; encrypts users' Claude keys
```

In `backend/app/main.py` add the import and the check. Add near the other app imports:

```python
from app.claude_keys import KeyEncryptionError, check_master_secret
```

and change the lifespan to:

```python
@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Web process only: the release command and the one-off job never go through this startup.
    if settings.app_env == "production":
        with engine.connect() as conn:
            check_runtime_role(conn)
        check_master_secret()
    yield
```

(`KeyEncryptionError` is imported so the startup test can reference `main.KeyEncryptionError`; ruff keeps it because the test uses it through `main`. If ruff reports it unused, add `# noqa: F401`.)

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run ruff check --fix . && uv run ruff format . && uv run mypy app && uv run python -m pytest tests/test_claude_keys_crypto.py tests/test_main_startup.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/claude_keys.py backend/app/config.py backend/app/main.py backend/tests/test_claude_keys_crypto.py backend/tests/test_main_startup.py
git commit -m "feat: encrypt per-user Claude keys at rest and check the master secret at start-up

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The table, its row-level security and the admin-visible state

**Files:**
- Modify: `backend/app/models.py` (new `UserApiKey`, new `AppUser.claude_key_state`)
- Modify: `backend/app/rls.py` (`USER_TABLES`, `APP_USERS_UPDATABLE_COLUMNS`)
- Create: `backend/migrations/versions/f4a1c8d27b90_add_user_api_keys.py`
- Modify: `backend/tests/auth_support.py` (a row factory)
- Modify: `backend/tests/test_me_router.py` (export test), `backend/tests/test_app_users_privileges.py` (updatable column)
- Test: `backend/tests/test_user_api_keys_migration.py`, plus the existing `tests/test_rls.py` (it parametrizes over `USER_TABLES`)

**Interfaces:**
- Consumes: `app.db.Base`, the model column style in `app/models.py` (`Mapped[...] = mapped_column(...)`).
- Produces:
  - `models.UserApiKey(id, user_id, ciphertext: bytes, key_version: int, last4: str, status: str, created_at, updated_at)`
  - `models.AppUser.claude_key_state: str` (`"none"` default)
  - `rls.USER_TABLES` now includes `"user_api_keys"`; `rls.APP_USERS_UPDATABLE_COLUMNS` includes `"claude_key_state"`.

- [ ] **Step 1: Write the failing tests**

Add the factory to `backend/tests/auth_support.py`. Add `UserApiKey` to the `from app.models import (...)` list, then add this entry to `ROW_FACTORIES` (before the closing brace):

```python
    "user_api_keys": lambda uid: UserApiKey(
        user_id=uid, ciphertext=b"x" * 40, key_version=1, last4="abcd", status="ok"
    ),
```

In `backend/tests/test_app_users_privileges.py`, add `"claude_key_state",` to the parametrize list of updatable columns (after `"monthly_chat_limit",`).

In `backend/tests/test_me_router.py`, in `test_export_returns_only_the_callers_own_rows`, add the key table to the excluded set and assert the export never includes it:

```python
    rows_with_user_id = set(rls.USER_TABLES) - {
        "investment_preferences",
        "chat_messages",
        "portfolio_snapshots",
        "user_api_keys",
    }
```

and after `assert body["profile"]["id"] == str(USER_ID)` add:

```python
    assert "user_api_keys" not in body
```

(the export loop above it seeds a row for every `USER_TABLES` entry, so the key table's row is present in the database and must still stay out of the export.)

Create `backend/tests/test_user_api_keys_migration.py`:

```python
import importlib.util
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parent.parent


def _migration():
    path = next((BACKEND / "migrations" / "versions").glob("*_add_user_api_keys.py"))
    spec = importlib.util.spec_from_file_location("add_user_api_keys", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_is_the_single_head_after_the_api_role_revoke():
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()

    migration = _migration()
    assert heads == [migration.revision]
    assert migration.down_revision == "a7c3e91d5b20"
```

- [ ] **Step 2: Run to see failures**

Run: `cd backend && uv run python -m pytest tests/test_user_api_keys_migration.py tests/test_rls.py tests/test_app_users_privileges.py tests/test_me_router.py -q`
Expected: failures (`UserApiKey` does not exist, migration file missing).

- [ ] **Step 3: Implement the model**

In `backend/app/models.py`, add `LargeBinary` to the `sqlalchemy` import list at the top, then add after the `InvestmentPreferences` class:

```python
class UserApiKey(Base):
    """A user's own Claude API key, encrypted by the application (see app.claude_keys). The
    plaintext never reaches this table; `last4` is the only readable part."""

    __tablename__ = "user_api_keys"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, index=True)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[int] = mapped_column(default=1)
    last4: Mapped[str] = mapped_column(String(4))
    status: Mapped[str] = mapped_column(String(20), default="ok")  # "ok" | "needs_attention"
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
```

In the `AppUser` class, after `monthly_chat_limit`, add:

```python
    # Mirrors user_api_keys (which the admin cannot read: it is row-level secured): "none" | "ok"
    # | "needs_attention". Written in the same transaction as every change to the key row.
    claude_key_state: Mapped[str] = mapped_column(String(20), default="none", server_default="none")
```

In `backend/app/rls.py`, add `"user_api_keys",` as the last entry of `USER_TABLES` (after `"portfolio_snapshots",`) and add `"claude_key_state",` as the last entry of `APP_USERS_UPDATABLE_COLUMNS`.

- [ ] **Step 4: Write the migration**

Create `backend/migrations/versions/f4a1c8d27b90_add_user_api_keys.py`:

```python
"""add user_api_keys and app_users.claude_key_state

Revision ID: f4a1c8d27b90
Revises: a7c3e91d5b20
Create Date: 2026-10-06 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app import rls

# revision identifiers, used by Alembic.
revision: str = 'f4a1c8d27b90'
down_revision: Union[str, Sequence[str], None] = 'a7c3e91d5b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "user_api_keys"
# app_users as it is after this revision: the column the app may update now includes the key state.
UPDATABLE = (
    "status, accepted_terms_at, last_seen_at, invited_at, "
    "monthly_analysis_limit, monthly_chat_limit, claude_key_state"
)
PREVIOUS_UPDATABLE = (
    "status, accepted_terms_at, last_seen_at, invited_at, "
    "monthly_analysis_limit, monthly_chat_limit"
)


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("key_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last4", sa.String(length=4), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="ok"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_user_api_keys_user_id"), TABLE, ["user_id"], unique=True)
    op.add_column(
        "app_users",
        sa.Column("claude_key_state", sa.String(length=20), nullable=False, server_default="none"),
    )
    # Same grants and forced owner-only policy as every other user table.
    for statement in rls.grant_table_sql(TABLE):
        op.execute(statement)
    for statement in rls.policy_sql(TABLE):
        op.execute(statement)
    op.execute(f"REVOKE UPDATE ON app_users FROM {rls.RUNTIME_ROLE}")
    op.execute(f"GRANT UPDATE ({UPDATABLE}) ON app_users TO {rls.RUNTIME_ROLE}")


def downgrade() -> None:
    op.execute(f"REVOKE UPDATE ON app_users FROM {rls.RUNTIME_ROLE}")
    op.execute(f"GRANT UPDATE ({PREVIOUS_UPDATABLE}) ON app_users TO {rls.RUNTIME_ROLE}")
    op.drop_column("app_users", "claude_key_state")
    op.execute(f"DROP POLICY IF EXISTS {TABLE}_owner ON {TABLE}")
    op.drop_index(op.f("ix_user_api_keys_user_id"), table_name=TABLE)
    op.drop_table(TABLE)
```

- [ ] **Step 5: Run the tests and verify the migration on a real database**

Run:
```bash
cd backend && uv run ruff check --fix . && uv run ruff format . && uv run mypy app
uv run python -m pytest tests/test_user_api_keys_migration.py tests/test_rls.py tests/test_app_users_privileges.py tests/test_me_router.py tests/test_admin_lifecycle.py tests/test_models.py -q
```
Expected: all pass (the RLS tests now also cover `user_api_keys` through `USER_TABLES` and the new row factory).

Then prove the migration itself against a scratch database (this repeats what a deploy does; it must succeed upgrade, downgrade, upgrade):

```bash
docker exec backend-postgres-1 psql -U trading_agent -d postgres -c "DROP DATABASE IF EXISTS migration_check WITH (FORCE)" -c "CREATE DATABASE migration_check"
docker exec backend-postgres-1 psql -U trading_agent -d migration_check -c "CREATE EXTENSION IF NOT EXISTS vector"
cd backend
MIGRATION_DATABASE_URL=postgresql+psycopg://trading_agent:trading_agent@localhost:5432/migration_check uv run alembic upgrade head
MIGRATION_DATABASE_URL=postgresql+psycopg://trading_agent:trading_agent@localhost:5432/migration_check uv run alembic downgrade -1
MIGRATION_DATABASE_URL=postgresql+psycopg://trading_agent:trading_agent@localhost:5432/migration_check uv run alembic upgrade head
docker exec backend-postgres-1 psql -U trading_agent -d postgres -c "DROP DATABASE migration_check WITH (FORCE)"
```
Expected: each alembic command finishes without error (`MIGRATION_DATABASE_URL` is read by `migrations/env.py`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/rls.py backend/migrations/versions/f4a1c8d27b90_add_user_api_keys.py backend/tests/auth_support.py backend/tests/test_me_router.py backend/tests/test_app_users_privileges.py backend/tests/test_user_api_keys_migration.py
git commit -m "feat: user_api_keys table with row-level security and an admin-visible key state

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The save, report and remove routes

**Files:**
- Modify: `backend/app/claude_keys.py` (validation against Anthropic)
- Create: `backend/app/routers/claude_key.py`
- Modify: `backend/app/main.py` (include the router)
- Test: `backend/tests/test_claude_key_router.py`

**Interfaces:**
- Consumes: `encrypt_key`, `KEY_VERSION` (Task 1); `models.UserApiKey`, `AppUser.claude_key_state` (Task 2); `get_current_user`, `get_user_db`, `rate_limiter`.
- Produces:
  - `claude_keys.ClaudeKeyRejected(code: str, message: str, http_status: int)`
  - `claude_keys.verify_key(api_key: str) -> None` (async; raises `ClaudeKeyRejected`)
  - routes `GET|PUT|DELETE /me/claude-key`; response model `ClaudeKeyOut {connected: bool, last4: str | None, needs_attention: bool}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_claude_key_router.py`:

```python
import logging
from unittest.mock import MagicMock, patch

import anthropic
import httpx
import pytest

from app.models import AppUser, UserApiKey
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user, auth_headers

KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"
OTHER_KEY = "sk-ant-api03-zyxwvutsrqponmlkjihgfedcba9876543210"


def _status_error(cls, status: int):
    request = httpx.Request("GET", "https://api.anthropic.com/v1/models")
    return cls("nope", response=httpx.Response(status, request=request), body=None)


@pytest.fixture()
def anthropic_ok():
    """Anthropic accepts every key; yields the constructor mock so tests can see what it was given."""
    with patch("app.claude_keys.Anthropic") as constructor:
        constructor.return_value = MagicMock()
        yield constructor


def _put(client, key=KEY, **kwargs):
    return client.put("/me/claude-key", json={"api_key": key}, **kwargs)


def test_nothing_is_connected_at_first(client_no_key):
    response = client_no_key.get("/me/claude-key")

    assert response.status_code == 200
    assert response.json() == {"connected": False, "last4": None, "needs_attention": False}


def test_saving_a_key_stores_only_ciphertext_and_reports_the_last_four(
    client_no_key, db_session, anthropic_ok
):
    response = _put(client_no_key)

    assert response.status_code == 200
    assert response.json() == {"connected": True, "last4": KEY[-4:], "needs_attention": False}
    assert KEY not in response.text
    anthropic_ok.assert_called_once()
    assert anthropic_ok.call_args.kwargs["api_key"] == KEY
    row = db_session.query(UserApiKey).one()
    assert row.user_id == USER_ID
    assert KEY.encode() not in row.ciphertext
    assert row.last4 == KEY[-4:]
    assert row.status == "ok"
    assert db_session.get(AppUser, USER_ID).claude_key_state == "ok"


def test_the_key_is_checked_with_one_free_call_before_it_is_stored(client_no_key, anthropic_ok):
    _put(client_no_key)

    anthropic_ok.return_value.models.list.assert_called_once_with(limit=1)


def test_pasted_whitespace_around_the_key_is_stripped(client_no_key, db_session, anthropic_ok):
    response = _put(client_no_key, key=f"  {KEY}\n")

    assert response.status_code == 200
    assert anthropic_ok.call_args.kwargs["api_key"] == KEY


@pytest.mark.parametrize(
    "bad",
    ["", "hello", "sk-ant-short", "sk-ant-" + "a" * 400, "sk-ant-api03-abc def" + "x" * 30],
    ids=["empty", "no-prefix", "too-short", "too-long", "inner-space"],
)
def test_a_badly_shaped_key_is_rejected_without_echoing_it_or_calling_anthropic(
    client_no_key, db_session, anthropic_ok, bad
):
    response = _put(client_no_key, key=bad)

    assert response.status_code == 422
    if len(bad) > 8:
        assert bad not in response.text
    anthropic_ok.assert_not_called()
    assert db_session.query(UserApiKey).count() == 0


def test_a_key_anthropic_rejects_is_not_stored(client_no_key, db_session, anthropic_ok):
    anthropic_ok.return_value.models.list.side_effect = _status_error(
        anthropic.AuthenticationError, 401
    )

    response = _put(client_no_key)

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_key"
    assert KEY not in response.text
    assert db_session.query(UserApiKey).count() == 0
    assert db_session.get(AppUser, USER_ID).claude_key_state == "none"


def test_a_key_without_access_is_reported_calmly(client_no_key, db_session, anthropic_ok):
    anthropic_ok.return_value.models.list.side_effect = _status_error(
        anthropic.PermissionDeniedError, 403
    )

    response = _put(client_no_key)

    assert response.status_code == 422
    assert response.json()["code"] == "key_not_usable"
    assert db_session.query(UserApiKey).count() == 0


def test_anthropic_being_unreachable_is_a_502_and_stores_nothing(
    client_no_key, db_session, anthropic_ok
):
    anthropic_ok.return_value.models.list.side_effect = anthropic.APIConnectionError(
        request=httpx.Request("GET", "https://api.anthropic.com/v1/models")
    )

    response = _put(client_no_key)

    assert response.status_code == 502
    assert response.json()["code"] == "anthropic_unreachable"
    assert db_session.query(UserApiKey).count() == 0


def test_saving_again_replaces_the_key(client_no_key, db_session, anthropic_ok):
    _put(client_no_key)
    db_session.query(UserApiKey).update({"status": "needs_attention"})
    db_session.query(AppUser).update({"claude_key_state": "needs_attention"})
    db_session.commit()

    response = _put(client_no_key, key=OTHER_KEY)

    assert response.json() == {"connected": True, "last4": OTHER_KEY[-4:], "needs_attention": False}
    db_session.expire_all()
    assert db_session.query(UserApiKey).count() == 1
    assert db_session.query(UserApiKey).one().status == "ok"
    assert db_session.get(AppUser, USER_ID).claude_key_state == "ok"


def test_a_flagged_key_reports_needs_attention(client_no_key, db_session, anthropic_ok):
    _put(client_no_key)
    db_session.query(UserApiKey).update({"status": "needs_attention"})
    db_session.commit()

    response = client_no_key.get("/me/claude-key")

    assert response.json() == {"connected": True, "last4": KEY[-4:], "needs_attention": True}


def test_removing_the_key_deletes_it_and_is_safe_to_repeat(
    client_no_key, db_session, anthropic_ok
):
    _put(client_no_key)

    assert client_no_key.delete("/me/claude-key").status_code == 204
    assert client_no_key.delete("/me/claude-key").status_code == 204

    assert db_session.query(UserApiKey).count() == 0
    db_session.expire_all()
    assert db_session.get(AppUser, USER_ID).claude_key_state == "none"
    assert client_no_key.get("/me/claude-key").json()["connected"] is False


def test_another_user_cannot_see_the_key(client_no_key, db_session, anthropic_ok):
    add_app_user(db_session, OTHER_USER_ID)
    _put(client_no_key)

    other = client_no_key.get("/me/claude-key", headers=auth_headers(OTHER_USER_ID))

    assert other.json() == {"connected": False, "last4": None, "needs_attention": False}


def test_another_user_deleting_does_not_touch_the_row(client_no_key, db_session, anthropic_ok):
    add_app_user(db_session, OTHER_USER_ID)
    _put(client_no_key)

    client_no_key.delete("/me/claude-key", headers=auth_headers(OTHER_USER_ID))

    assert db_session.query(UserApiKey).count() == 1


def test_saving_is_limited_to_ten_a_minute(client_no_key, anthropic_ok):
    for _ in range(10):
        assert _put(client_no_key, key="bad").status_code == 422

    assert _put(client_no_key, key="bad").status_code == 429


def test_the_routes_require_authentication(anon_client):
    assert anon_client.get("/me/claude-key").status_code == 401
    assert anon_client.put("/me/claude-key", json={"api_key": KEY}).status_code == 401
    assert anon_client.delete("/me/claude-key").status_code == 401


def test_the_key_never_appears_in_the_logs(client_no_key, anthropic_ok, caplog):
    caplog.set_level(logging.DEBUG)

    _put(client_no_key)
    anthropic_ok.return_value.models.list.side_effect = _status_error(
        anthropic.AuthenticationError, 401
    )
    _put(client_no_key, key=OTHER_KEY)
    client_no_key.delete("/me/claude-key")

    assert KEY not in caplog.text
    assert OTHER_KEY not in caplog.text
```

The tests use a `client_no_key` fixture and the regular `client` fixture will also give the user a saved key (so every existing chat and analysis test keeps passing in Task 4). Add both to `backend/tests/conftest.py`. First add to the imports at the top: `from app.claude_keys import encrypt_key` and add `UserApiKey` to the existing `from app.models import ...` line. Then replace the `client` fixture and add `client_no_key` after it:

```python
@pytest.fixture()
def client_no_key(engine: Engine, app_engine: Engine) -> Generator[TestClient, None, None]:
    """Authenticated as USER_ID (an active AppUser) who has NOT connected a Claude key yet."""
    with sessionmaker(bind=engine)() as setup:
        setup.add(AppUser(id=USER_ID, email="user@example.com", role="user", status="active"))
        setup.commit()
    _install_overrides(app_engine)
    with TestClient(app, headers=auth_headers(USER_ID)) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def client(engine: Engine, app_engine: Engine) -> Generator[TestClient, None, None]:
    """Authenticated as USER_ID, an active AppUser who has connected a Claude key (so the Claude-
    backed routes work), served through the restricted DB role."""
    with sessionmaker(bind=engine)() as setup:
        setup.add(
            AppUser(
                id=USER_ID,
                email="user@example.com",
                role="user",
                status="active",
                claude_key_state="ok",
            )
        )
        setup.add(
            UserApiKey(
                user_id=USER_ID,
                ciphertext=encrypt_key(USER_ID, "sk-ant-test-key-0000"),
                key_version=1,
                last4="0000",
                status="ok",
            )
        )
        setup.commit()
    _install_overrides(app_engine)
    with TestClient(app, headers=auth_headers(USER_ID)) as test_client:
        yield test_client
    app.dependency_overrides.clear()
```

(Delete the old `client` fixture body; `anon_client`, `admin_client` and the rest stay as they are. The two new fixtures share their wiring on purpose: one is the old `client`, plus a key.)

- [ ] **Step 2: Run to see failures**

Run: `cd backend && uv run python -m pytest tests/test_claude_key_router.py -q`
Expected: failures (the route does not exist: 404 and a missing `verify_key`).

- [ ] **Step 3: Implement the validation call**

Append to `backend/app/claude_keys.py` (add `import asyncio` at the top and `import anthropic` plus `from anthropic import Anthropic` to the imports):

```python
class ClaudeKeyRejected(Exception):
    """Anthropic would not accept the key right now. `code` is stable for the frontend; `message`
    is shown to the user; neither carries the key or Anthropic's raw response."""

    def __init__(self, code: str, message: str, http_status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


async def verify_key(api_key: str) -> None:
    """One free call (listing models costs no tokens) with the key; raises ClaudeKeyRejected."""

    def _check() -> None:
        Anthropic(api_key=api_key, max_retries=0, timeout=10.0).models.list(limit=1)

    try:
        await asyncio.to_thread(_check)
    except anthropic.AuthenticationError:
        raise ClaudeKeyRejected(
            "invalid_key", "Anthropic did not accept that key. Check that you copied all of it."
        ) from None
    except (anthropic.PermissionDeniedError, anthropic.BadRequestError):
        raise ClaudeKeyRejected(
            "key_not_usable",
            "That key cannot be used right now. Check that the account has credit and that "
            "the key is allowed to make requests.",
        ) from None
    except anthropic.APIConnectionError:
        raise ClaudeKeyRejected(
            "anthropic_unreachable", "Could not reach Anthropic. Try again in a moment.", 502
        ) from None
    except anthropic.APIStatusError:
        raise ClaudeKeyRejected(
            "anthropic_unavailable", "Anthropic is busy right now. Try again in a moment.", 502
        ) from None
```

(`anthropic.APITimeoutError` is a subclass of `APIConnectionError`, so a timeout lands in the third branch. Order matters: the specific status errors come before `APIStatusError`.)

- [ ] **Step 4: Implement the routes**

Create `backend/app/routers/claude_key.py`:

```python
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import claude_keys
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.models import AppUser, UserApiKey
from app.rate_limit import rate_limiter

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/me/claude-key", tags=["claude-key"], dependencies=[Depends(get_current_user)]
)

SAVE_LIMIT_PER_MINUTE = 10  # the save route must not become a way to test stolen keys
KEY_PREFIX = "sk-ant-"
KEY_MIN_LENGTH = 20
KEY_MAX_LENGTH = 300
BAD_FORMAT = (
    "That does not look like an Anthropic API key. It starts with sk-ant- and has no spaces."
)


class ClaudeKeyIn(BaseModel):
    # No length or pattern constraints here: a failed pydantic check echoes the input in the 422
    # body, and this input is a secret. The shape is checked by hand below.
    api_key: str


class ClaudeKeyOut(BaseModel):
    connected: bool
    last4: str | None
    needs_attention: bool


def _out(row: UserApiKey | None) -> ClaudeKeyOut:
    if row is None:
        return ClaudeKeyOut(connected=False, last4=None, needs_attention=False)
    return ClaudeKeyOut(
        connected=True, last4=row.last4, needs_attention=row.status == "needs_attention"
    )


@router.get("", response_model=ClaudeKeyOut)
def get_key(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> ClaudeKeyOut:
    return _out(db.query(UserApiKey).filter_by(user_id=user.id).one_or_none())


@router.put(
    "",
    response_model=ClaudeKeyOut,
    dependencies=[Depends(rate_limiter("claude_key_save", limit=SAVE_LIMIT_PER_MINUTE))],
)
async def save_key(
    payload: ClaudeKeyIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> ClaudeKeyOut:
    api_key = payload.api_key.strip()
    well_formed = (
        KEY_MIN_LENGTH <= len(api_key) <= KEY_MAX_LENGTH
        and api_key.startswith(KEY_PREFIX)
        and api_key.isascii()
        and api_key.isprintable()
        and " " not in api_key
    )
    if not well_formed:
        raise HTTPException(status_code=422, detail=BAD_FORMAT)
    try:
        await claude_keys.verify_key(api_key)
    except claude_keys.ClaudeKeyRejected as rejected:
        raise HTTPException(
            status_code=rejected.http_status,
            detail={"message": rejected.message, "code": rejected.code},
        ) from None
    row = await run_in_threadpool(_store, db, user.id, api_key)
    logger.info("Claude key saved for user %s", user.id)
    return _out(row)


def _store(db: Session, user_id: uuid.UUID, api_key: str) -> UserApiKey:
    blob = claude_keys.encrypt_key(user_id, api_key)
    row = db.query(UserApiKey).filter_by(user_id=user_id).one_or_none()
    if row is None:
        row = UserApiKey(user_id=user_id, ciphertext=blob, key_version=claude_keys.KEY_VERSION)
        db.add(row)
    row.ciphertext = blob
    row.key_version = claude_keys.KEY_VERSION
    row.last4 = api_key[-4:]
    row.status = "ok"
    db.query(AppUser).filter_by(id=user_id).update({"claude_key_state": "ok"})
    db.commit()
    db.refresh(row)
    return row


@router.delete("", status_code=204)
def delete_key(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> None:
    db.query(UserApiKey).filter_by(user_id=user.id).delete()
    db.query(AppUser).filter_by(id=user.id).update({"claude_key_state": "none"})
    db.commit()
    logger.info("Claude key removed for user %s", user.id)
```

The error body for the two rejected cases is `{"detail": {"message", "code"}}`; the tests read `response.json()["code"]`, so add one small handler (see Step 5) that lifts it to the top level, or change the tests to `response.json()["detail"]["code"]`. Use the handler: in `main.py` the app already has handlers for `AdminError` and friends; the frontend gets a consistent shape (`{detail, code}`) for every Claude-key error, which Task 4's `409` also uses.

- [ ] **Step 5: Wire the router and the error shape**

In `backend/app/main.py`, import the router module with the others (`claude_key` in the `from app.routers import (...)` list, in alphabetical order after `chat`) and include it next to the other `me` routers:

```python
app.include_router(claude_key.router)
```

Add this handler beside the existing exception handlers in `main.py` (use the same decorator style they use; the body is what matters):

```python
@app.exception_handler(HTTPException)
async def _http_exception_with_code(_request: Request, exc: HTTPException) -> JSONResponse:
    """A detail given as {"message", "code"} is returned as {"detail": message, "code": code}, so
    the frontend can branch on `code` for the Claude-key errors; every other HTTPException keeps
    FastAPI's usual shape."""
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        body = {"detail": exc.detail["message"], "code": exc.detail["code"]}
    else:
        body = {"detail": exc.detail}
    return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)
```

(Import `Request` and `HTTPException` from `fastapi` and `JSONResponse` from `fastapi.responses` if they are not imported yet; `main.py` already imports `JSONResponse`.) If a handler for `HTTPException` already exists in `main.py`, extend it instead of adding a second one.

- [ ] **Step 6: Run the tests**

Run: `cd backend && uv run ruff check --fix . && uv run ruff format . && uv run mypy app && uv run python -m pytest tests -q`
Expected: the whole suite passes, including the new file. (The full suite takes about two minutes.)

- [ ] **Step 7: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat: save, show and remove a Claude key under /me/claude-key

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Use each user's own key for chat and analysis

**Files:**
- Modify: `backend/app/claude_keys.py` (`ClaudeKeyRequired`, `resolve_client`, `mark_needs_attention`)
- Modify: `backend/app/agents/chat.py`, `backend/app/agents/news.py` (accept a client)
- Modify: `backend/app/agents/graph.py`, `backend/app/agents/jobs.py` (carry the client)
- Modify: `backend/app/routers/chat.py`, `backend/app/routers/analysis.py` (resolve and pass it)
- Modify: `backend/app/main.py` (the `409` handler)
- Modify tests: `backend/tests/test_chat_router.py`, `backend/tests/test_agents_jobs.py`, `backend/tests/test_agents_graph.py`
- Test: `backend/tests/test_claude_keys_resolve.py`, new cases in `backend/tests/test_chat_router.py` and `backend/tests/test_analysis_router.py`, `backend/tests/test_agents_graph.py`

**Interfaces:**
- Consumes: `decrypt_key`, `KeyEncryptionError`, `ClaudeKeyRejected` (Tasks 1, 3); `UserApiKey`, `AppUser.claude_key_state`; `app.db.scoped_session`.
- Produces:
  - `claude_keys.ClaudeKeyRequired(needs_attention: bool = False)` with a fixed user-facing message; a global handler returns `409 {"detail": <message>, "code": "claude_key_required"}`
  - `claude_keys.resolve_client(db: Session, user_id: uuid.UUID, role: str) -> Anthropic | None` — the user's own client; `None` means "use the server key" (admins only); raises `ClaudeKeyRequired`
  - `claude_keys.mark_needs_attention(user_id: uuid.UUID) -> None` (own scoped session; sync)
  - agents: `run_chat(..., client: Anthropic | None = None)`, `news.run_news_agent(..., client: Anthropic | None = None)`, `run_graph_for_ticker(user_id, ticker, asset_type, is_held, client=None)`, `run_job(job_id, user_id, tickers, client=None)`, `_process_ticker(..., client=None)`; `AnalysisState` gains `client: Anthropic | None`

- [ ] **Step 1: Write the failing tests for the resolver**

Create `backend/tests/test_claude_keys_resolve.py`:

```python
from unittest.mock import patch

import pytest

from app import claude_keys
from app.claude_keys import ClaudeKeyRequired, encrypt_key, mark_needs_attention, resolve_client
from app.config import settings
from app.models import AppUser, UserApiKey
from tests.auth_support import USER_ID, add_app_user

KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"


def _give_key(db, user_id=USER_ID, status="ok"):
    db.add(
        UserApiKey(
            user_id=user_id,
            ciphertext=encrypt_key(user_id, KEY),
            key_version=1,
            last4=KEY[-4:],
            status=status,
        )
    )
    db.commit()


def test_a_user_with_a_key_gets_a_client_built_from_it(db_session):
    add_app_user(db_session, USER_ID, role="user")
    _give_key(db_session)

    with patch("app.claude_keys.Anthropic") as constructor:
        client = resolve_client(db_session, USER_ID, "user")

    constructor.assert_called_once_with(api_key=KEY)
    assert client is constructor.return_value


def test_a_user_without_a_key_must_connect_one(db_session):
    add_app_user(db_session, USER_ID, role="user")

    with pytest.raises(ClaudeKeyRequired) as excinfo:
        resolve_client(db_session, USER_ID, "user")

    assert excinfo.value.needs_attention is False


def test_a_user_never_falls_back_to_the_server_key(db_session, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-the-servers-own-key")
    add_app_user(db_session, USER_ID, role="user")

    with pytest.raises(ClaudeKeyRequired):
        resolve_client(db_session, USER_ID, "user")


def test_an_admin_without_a_personal_key_uses_the_server_key(db_session):
    add_app_user(db_session, USER_ID, role="admin")

    assert resolve_client(db_session, USER_ID, "admin") is None  # None: the server's own client


def test_an_admins_personal_key_takes_precedence(db_session):
    add_app_user(db_session, USER_ID, role="admin")
    _give_key(db_session)

    with patch("app.claude_keys.Anthropic") as constructor:
        client = resolve_client(db_session, USER_ID, "admin")

    assert client is constructor.return_value


@pytest.mark.parametrize("role", ["user", "admin"])
def test_a_flagged_key_asks_for_a_reconnect_and_never_falls_back(db_session, role):
    add_app_user(db_session, USER_ID, role=role)
    _give_key(db_session, status="needs_attention")

    with pytest.raises(ClaudeKeyRequired) as excinfo:
        resolve_client(db_session, USER_ID, role)

    assert excinfo.value.needs_attention is True


def test_a_key_that_cannot_be_decrypted_asks_for_a_reconnect(db_session):
    add_app_user(db_session, USER_ID, role="user")
    _give_key(db_session)
    db_session.query(UserApiKey).update({"ciphertext": b"not a real ciphertext at all......"})
    db_session.commit()

    with pytest.raises(ClaudeKeyRequired) as excinfo:
        resolve_client(db_session, USER_ID, "user")

    assert excinfo.value.needs_attention is True


def test_mark_needs_attention_flips_the_row_and_the_admin_visible_state(
    db_session, app_session_local
):
    add_app_user(db_session, USER_ID, role="user")
    db_session.query(AppUser).update({"claude_key_state": "ok"})
    _give_key(db_session)

    with patch("app.db.SessionLocal", app_session_local):
        mark_needs_attention(USER_ID)

    db_session.expire_all()
    assert db_session.query(UserApiKey).one().status == "needs_attention"
    assert db_session.get(AppUser, USER_ID).claude_key_state == "needs_attention"


def test_mark_needs_attention_is_harmless_without_a_key(db_session, app_session_local):
    add_app_user(db_session, USER_ID, role="user")

    with patch("app.db.SessionLocal", app_session_local):
        mark_needs_attention(USER_ID)

    assert db_session.get(AppUser, USER_ID).claude_key_state == "none"


def test_the_decrypted_key_is_not_kept_in_a_module_global(db_session):
    add_app_user(db_session, USER_ID, role="user")
    _give_key(db_session)

    with patch("app.claude_keys.Anthropic"):
        resolve_client(db_session, USER_ID, "user")

    for name, value in vars(claude_keys).items():
        assert not (isinstance(value, str) and KEY in value), name
        assert not (isinstance(value, bytes) and KEY.encode() in value), name


def test_the_error_message_is_fixed_text():
    assert "Connect Claude" in str(ClaudeKeyRequired())
    assert "reconnect" in str(ClaudeKeyRequired(needs_attention=True)).lower()
```

- [ ] **Step 2: Run to see failures**

Run: `cd backend && uv run python -m pytest tests/test_claude_keys_resolve.py -q`
Expected: failures (`resolve_client` and friends do not exist).

- [ ] **Step 3: Implement the resolver**

Append to `backend/app/claude_keys.py` (add to its imports: `import logging`, `from sqlalchemy.orm import Session`, `from app.db import scoped_session`, `from app.models import AppUser, UserApiKey`; define `logger = logging.getLogger(__name__)` after the imports):

```python
class ClaudeKeyRequired(Exception):
    """The caller has no usable Claude key. Turned into a 409 with the stable code
    `claude_key_required` (see main.py). The message is fixed text: no ids, no key material."""

    def __init__(self, needs_attention: bool = False) -> None:
        self.needs_attention = needs_attention
        super().__init__(
            "Your Claude key was rejected. Reconnect it in Account to keep using this."
            if needs_attention
            else "Connect Claude to use this."
        )


def _usable_key_row(db: Session, user_id: uuid.UUID, role: str) -> UserApiKey | None:
    """The user's saved key row, or None for an admin who uses the server key. Raises
    ClaudeKeyRequired for a user with no key, and for a flagged key (never a silent fallback)."""
    row = db.query(UserApiKey).filter_by(user_id=user_id).one_or_none()
    if row is not None:
        if row.status != "ok":
            raise ClaudeKeyRequired(needs_attention=True)
        return row
    if role == "admin":
        return None
    raise ClaudeKeyRequired()


def resolve_client(db: Session, user_id: uuid.UUID, role: str) -> Anthropic | None:
    """The Claude client for a request made by this user.

    A user's own saved key always wins. With none: an admin gets None, meaning "use the server's
    own key"; everyone else must connect one. A key flagged needs_attention (or one that cannot be
    decrypted, for example after the master secret changed) never silently falls back: the person
    is asked to reconnect. The decrypted key lives only inside the returned client.
    """
    row = _usable_key_row(db, user_id, role)
    if row is None:
        return None
    try:
        return Anthropic(api_key=decrypt_key(user_id, row.ciphertext))
    except KeyEncryptionError:
        logger.warning("A saved Claude key for user %s could not be decrypted", user_id)
        raise ClaudeKeyRequired(needs_attention=True) from None


def mark_needs_attention(user_id: uuid.UUID) -> None:
    """Flags the user's key as rejected by Anthropic (revoked or invalid), in its own session so it
    works from a background job. Does nothing when the user has no saved key."""
    with scoped_session(user_id) as db:
        flagged = (
            db.query(UserApiKey)
            .filter_by(user_id=user_id)
            .update({"status": "needs_attention"})
        )
        if flagged:
            db.query(AppUser).filter_by(id=user_id).update({"claude_key_state": "needs_attention"})
        db.commit()
    if flagged:
        logger.warning("Claude key for user %s was rejected by Anthropic", user_id)
```

- [ ] **Step 4: Run the resolver tests**

Run: `cd backend && uv run python -m pytest tests/test_claude_keys_resolve.py -q`
Expected: pass.

- [ ] **Step 5: Write the failing route and agent tests**

Add to `backend/tests/test_chat_router.py` (it already imports `AsyncMock`, `patch`, `settings`, `add_app_user`, `auth_headers`, `USER_ID`):

```python
def test_chat_without_a_connected_key_is_a_409_with_a_stable_code(client_no_key):
    response = client_no_key.post("/chat", json={"session_id": "s1", "message": "hi"})

    assert response.status_code == 409
    assert response.json()["code"] == "claude_key_required"
    assert "Connect Claude" in response.json()["detail"]


def test_chat_stores_nothing_when_the_key_is_missing(client_no_key, db_session):
    client_no_key.post("/chat", json={"session_id": "s1", "message": "hi"})

    assert db_session.query(ChatMessage).count() == 0


def test_chat_uses_the_callers_own_key(client, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-the-servers-own-key")

    with (
        patch("app.claude_keys.Anthropic") as constructor,
        patch("app.routers.chat.run_chat", AsyncMock(return_value="ok")) as mock_run,
    ):
        response = client.post("/chat", json={"session_id": "s1", "message": "hi"})

    assert response.status_code == 200
    constructor.assert_called_once_with(api_key="sk-ant-test-key-0000")
    assert mock_run.call_args.kwargs["client"] is constructor.return_value


def test_chat_for_an_admin_without_a_key_uses_the_server_key(admin_client, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-the-servers-own-key")

    with patch("app.routers.chat.run_chat", AsyncMock(return_value="ok")) as mock_run:
        response = admin_client.post("/chat", json={"session_id": "s1", "message": "hi"})

    assert response.status_code == 200
    assert mock_run.call_args.kwargs["client"] is None


def test_chat_for_an_admin_with_no_key_at_all_is_503(admin_client, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", None)

    response = admin_client.post("/chat", json={"session_id": "s1", "message": "hi"})

    assert response.status_code == 503


def test_a_key_anthropic_rejects_mid_chat_asks_for_a_reconnect(client, db_session):
    import anthropic
    import httpx

    rejected = anthropic.AuthenticationError(
        "nope",
        response=httpx.Response(401, request=httpx.Request("POST", "https://api.anthropic.com")),
        body=None,
    )
    with patch("app.routers.chat.run_chat", AsyncMock(side_effect=rejected)):
        response = client.post("/chat", json={"session_id": "s1", "message": "hi"})

    assert response.status_code == 409
    assert response.json()["code"] == "claude_key_required"
    assert "reconnect" in response.json()["detail"].lower()
    from app.models import UserApiKey

    db_session.expire_all()
    assert db_session.query(UserApiKey).one().status == "needs_attention"
    assert db_session.get(AppUser, USER_ID).claude_key_state == "needs_attention"
```

Change the one existing test that expected a 503 for a normal user: in `test_chat_without_api_key_returns_503` replace the fixture `client` with `admin_client` and keep the body (an admin with neither key still gets 503). In the two rate-limit tests of that file that say `# fast 503 per call, no mocking` (they set `settings.anthropic_api_key` to `None` and expect 503s), replace the fixture `client` with `admin_client` too (the route is the same; only an admin can reach the 503 path now).

Add to `backend/tests/test_analysis_router.py`:

```python
def test_run_analysis_without_a_connected_key_is_a_409(client_no_key):
    response = client_no_key.post("/analysis/run", json={})

    assert response.status_code == 409
    assert response.json()["code"] == "claude_key_required"


def test_run_analysis_does_not_count_a_run_when_the_key_is_missing(client_no_key):
    from app import usage

    client_no_key.post("/analysis/run", json={})

    import asyncio

    assert asyncio.run(usage.get_usage("analysis_run", str(USER_ID))) == 0


def test_run_analysis_gives_the_job_the_callers_own_client(client, db_session):
    db_session.add(Holding(user_id=USER_ID, ticker="AAPL", name="Apple", asset_type="STOCK",
                           shares=1, cost_basis=1, first_purchase_date=date(2024, 1, 1)))
    db_session.commit()

    with (
        patch("app.claude_keys.Anthropic") as constructor,
        patch("app.routers.analysis.create_job", AsyncMock(return_value="job-1")),
        patch("app.routers.analysis.run_job", AsyncMock()) as mock_run_job,
        patch("app.routers.analysis.asyncio.create_task", side_effect=_close_coro),
    ):
        response = client.post("/analysis/run", json={})

    assert response.status_code == 202
    assert mock_run_job.call_args.kwargs["client"] is constructor.return_value
```

(Use the file's existing imports; `Holding`, `date`, `patch`, `AsyncMock`, `USER_ID` and `_close_coro` are already defined or imported there; add any that are missing.)

Add to `backend/tests/test_agents_graph.py` (reuse the file's helpers for patching `market_data` and `context`; mirror the structure of its existing news test):

```python
def test_the_news_agent_receives_the_callers_client_and_a_rejected_key_is_flagged():
    import anthropic
    import httpx
    from unittest.mock import MagicMock

    client = MagicMock()
    rejected = anthropic.AuthenticationError(
        "nope",
        response=httpx.Response(401, request=httpx.Request("POST", "https://api.anthropic.com")),
        body=None,
    )
    closes = [100.0 - i for i in range(60)]  # a steady fall: OVERSOLD
    with (
        patch("app.agents.market_data.fetch_quote_and_history",
              AsyncMock(return_value={"price": closes[-1], "closes": closes})),
        patch("app.agents.market_data.fetch_fundamentals", AsyncMock(return_value={})),
        patch("app.agents.context.build_context", AsyncMock(return_value=None)),
        patch("app.agents.news.run_news_agent", AsyncMock(side_effect=rejected)) as mock_news,
        patch("app.agents.graph.mark_needs_attention") as mark,
    ):
        result = asyncio.run(
            run_graph_for_ticker(USER_ID, "VWCE", "ETF", is_held=False, client=client)
        )

    assert mock_news.call_args.kwargs["client"] is client
    mark.assert_called_once_with(USER_ID)
    assert result["ai_analysis"] is None  # the recommendation itself still comes through


def test_an_admins_server_client_rejection_is_not_flagged():
    import anthropic
    import httpx

    rejected = anthropic.AuthenticationError(
        "nope",
        response=httpx.Response(401, request=httpx.Request("POST", "https://api.anthropic.com")),
        body=None,
    )
    closes = [100.0 - i for i in range(60)]
    with (
        patch("app.agents.market_data.fetch_quote_and_history",
              AsyncMock(return_value={"price": closes[-1], "closes": closes})),
        patch("app.agents.market_data.fetch_fundamentals", AsyncMock(return_value={})),
        patch("app.agents.context.build_context", AsyncMock(return_value=None)),
        patch("app.agents.news.run_news_agent", AsyncMock(side_effect=rejected)),
        patch("app.agents.graph.mark_needs_attention") as mark,
    ):
        asyncio.run(run_graph_for_ticker(USER_ID, "VWCE", "ETF", is_held=False, client=None))

    mark.assert_not_called()
```

(If the steady-fall closes do not produce a non-HOLD action for an ETF with these inputs, copy the exact inputs from the existing test in that file that reaches `mock_news` with `AsyncMock(return_value="Qualitative color")`; the point of both tests is that the news call is reached.)

Update the two fakes in `backend/tests/test_agents_jobs.py` to accept the new argument (both are defined as `_fake_run_graph(user_id, ticker, asset_type, is_held)`): change each signature to `(user_id, ticker: str, asset_type: str, is_held: bool, client=None)`, and add this assertion test:

```python
def test_the_job_hands_the_same_client_to_every_ticker(session_local, app_session_local):
    seen: list[object] = []

    async def _fake_run_graph(user_id, ticker, asset_type, is_held, client=None) -> dict:
        seen.append(client)
        return FAKE_STATE_SKIP

    sentinel = object()

    async def _run() -> None:
        tickers = [
            {"ticker": "AAPL", "asset_type": "STOCK", "is_held": False},
            {"ticker": "MSFT", "asset_type": "STOCK", "is_held": False},
        ]
        job_id = await create_job(OTHER_USER_ID, tickers)
        with (
            patch("app.agents.jobs.run_graph_for_ticker", AsyncMock(side_effect=_fake_run_graph)),
            patch("app.db.SessionLocal", app_session_local),
        ):
            await run_job(job_id, OTHER_USER_ID, tickers, client=sentinel)

    asyncio.run(_run())

    assert seen == [sentinel, sentinel]
```

(Mirror the imports and the `asyncio.run` structure of the other tests in that file.)

- [ ] **Step 6: Run to see failures**

Run: `cd backend && uv run python -m pytest tests/test_chat_router.py tests/test_analysis_router.py tests/test_agents_graph.py tests/test_agents_jobs.py -q`
Expected: the new tests fail (and the 503-to-`admin_client` edits pass already).

- [ ] **Step 7: Implement**

`backend/app/agents/news.py`: change the signature and the client choice (add `from anthropic import Anthropic` already imported; keep `_get_client`):

```python
async def run_news_agent(
    ticker: str,
    action: str,
    reasoning: list[str],
    context: str | None = None,
    client: Anthropic | None = None,
) -> str | None:
    # An explicit client is the caller's own; None means the server key (admins, and older callers).
    client = client or _get_client()
    if client is None:
        return None
```

`backend/app/agents/chat.py`:

```python
async def run_chat(
    db: Session,
    user_id: uuid.UUID,
    session_id: str,
    message: str,
    history: list[ChatMessage],
    client: Anthropic | None = None,
) -> str:
    client = client or _get_client()
    portfolio_context = await build_portfolio_context(db, user_id)
```

(The rest of the function is unchanged; make sure the line `client = _get_client()` is the one replaced.)

`backend/app/agents/graph.py`: import `Anthropic` (`from anthropic import Anthropic`), `import anthropic`, `from starlette.concurrency import run_in_threadpool`, and `from app.claude_keys import mark_needs_attention`; add `client: Anthropic | None` to `AnalysisState`; change the news node and `run_graph_for_ticker`:

```python
async def news_agent(state: AnalysisState) -> dict[str, Any]:
    if state["action"] is None or state["action"] == "HOLD":
        return {"ai_analysis": None}
    # The web second opinion is optional colour on top of an already-computed recommendation, so a
    # failure here (billing, rate limit, outage) must not discard the whole ticker's result.
    try:
        ai_analysis = await news.run_news_agent(
            state["ticker"],
            state["action"],
            state["reasoning"],
            state["context"],
            client=state["client"],
        )
    except anthropic.AuthenticationError:
        # Anthropic rejected the caller's own key (revoked or invalid): flag it so the screen asks
        # for a reconnect. The server key (client is None) is never flagged.
        if state["client"] is not None:
            await run_in_threadpool(mark_needs_attention, state["user_id"])
        logger.warning("Claude key rejected for %s", state["ticker"])
        ai_analysis = None
    except Exception as exc:
        logger.warning("Web second opinion failed for %s: %s", state["ticker"], type(exc).__name__)
        ai_analysis = None
    return {"ai_analysis": ai_analysis}
```

```python
async def run_graph_for_ticker(
    user_id: uuid.UUID,
    ticker: str,
    asset_type: str,
    is_held: bool,
    client: Anthropic | None = None,
) -> AnalysisState:
    app_graph = build_graph()
    initial_state: AnalysisState = {
        "user_id": user_id,
        "client": client,
        # ... all the existing keys stay exactly as they are ...
    }
```

(Keep every existing key in `initial_state`; only add `"client": client`.)

`backend/app/agents/jobs.py`: add `from anthropic import Anthropic`; thread the client:

```python
async def _process_ticker(
    job_id: str,
    user_id: uuid.UUID,
    ticker_info: dict[str, Any],
    semaphore: asyncio.Semaphore,
    client: Anthropic | None = None,
) -> None:
    redis = get_redis()
    async with semaphore:
        try:
            state = await run_graph_for_ticker(
                user_id,
                ticker_info["ticker"],
                ticker_info["asset_type"],
                ticker_info["is_held"],
                client,
            )
```

and

```python
async def run_job(
    job_id: str,
    user_id: uuid.UUID,
    tickers: list[dict[str, Any]],
    client: Anthropic | None = None,
) -> None:
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_TICKERS)
    try:
        results = await asyncio.gather(
            *(_process_ticker(job_id, user_id, t, semaphore, client) for t in tickers),
            return_exceptions=True,
        )
```

(The test's fake receives `client` as the fifth positional argument, which matches `client=None` in its signature.)

`backend/app/routers/chat.py`: add `import anthropic`, `from app import claude_keys`; replace the first lines of the `chat` handler:

```python
    client = await run_in_threadpool(claude_keys.resolve_client, db, user.id, user.role)
    if client is None and not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="Chat not configured")

    # The database work is synchronous, so each step runs in a worker thread to keep the event
    # loop free. The same session is used one step at a time, never concurrently.
    history = await run_in_threadpool(_prepare_chat, db, user.id, payload)
    try:
        reply = await run_chat(
            db, user.id, payload.session_id, payload.message, history=history, client=client
        )
    except anthropic.AuthenticationError:
        if client is not None:
            await run_in_threadpool(claude_keys.mark_needs_attention, user.id)
            raise claude_keys.ClaudeKeyRequired(needs_attention=True) from None
        raise
    await run_in_threadpool(_save_reply, db, user.id, payload.session_id, reply)
    return ChatOut(session_id=payload.session_id, message=reply)
```

(The resolve call must come before `_prepare_chat`, so a user without a key leaves no stored message; `test_chat_stores_nothing_when_the_key_is_missing` checks that. `CurrentUser.role` already exists.)

`backend/app/routers/analysis.py`: add `from app import claude_keys` and change the start of `run_analysis`:

```python
    client = await run_in_threadpool(claude_keys.resolve_client, db, user.id, user.role)
    ticker_infos = await run_in_threadpool(_build_ticker_infos, db, user.id, payload.tickers)
    job_id = await create_job(user.id, ticker_infos)
    task = asyncio.create_task(run_job(job_id, user.id, ticker_infos, client=client))
```

The monthly counter is a dependency that runs before the handler, so a missing key would still count a run; make the order right by moving the key requirement into a dependency that runs first. Add to `backend/app/claude_keys.py`:

```python
def require_claude_key(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> None:
    """Dependency for routes that spend Claude money: fails with ClaudeKeyRequired before any usage is
    counted or anything is stored. It only checks that a usable key exists; it builds no client and
    decrypts nothing (the handler does that once, through resolve_client)."""
    _usable_key_row(db, user.id, user.role)
```

(imports: `from fastapi import Depends` and `from app.auth.deps import CurrentUser, get_current_user, get_user_db`; the module `app.auth.deps` does not import `claude_keys`, so there is no cycle.) Then put it first in the dependency lists, in both routes:

```python
    dependencies=[
        Depends(require_claude_key),
        Depends(rate_limiter("analysis_run", limit=5)),
        Depends(check_monthly_usage("analysis_run")),
    ],
```

and for chat:

```python
    dependencies=[
        Depends(require_claude_key),
        Depends(rate_limiter("chat", limit=20)),
        Depends(check_monthly_usage("chat")),
    ],
```

with `from app.claude_keys import require_claude_key` in each router. (The handler then calls `resolve_client` once to build the client, so exactly one `Anthropic` client is constructed per request, which `test_chat_uses_the_callers_own_key` asserts. The dependency and the handler each read the key row: two small queries.)

`backend/app/main.py`: add the `409` handler beside the others:

```python
@app.exception_handler(ClaudeKeyRequired)
async def _claude_key_required(_request: Request, exc: ClaudeKeyRequired) -> JSONResponse:
    return JSONResponse(
        status_code=409, content={"detail": str(exc), "code": "claude_key_required"}
    )
```

with `from app.claude_keys import ClaudeKeyRequired, KeyEncryptionError, check_master_secret` (extend the import added in Task 1).

- [ ] **Step 8: Run everything**

Run: `cd backend && uv run ruff check --fix . && uv run ruff format . && uv run mypy app && uv run python -m pytest tests -q`
Expected: all pass. If a test in `test_agents_graph.py` that asserts the exact arguments of `run_news_agent` fails because it now receives `client=None`, update that assertion to include `client=None`.

- [ ] **Step 9: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat: chat and analysis use the caller's own Claude key, and a rejected key asks for a reconnect

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The admin sees who is connected

**Files:**
- Modify: `backend/app/schemas.py` (`AdminUserOut`)
- Test: `backend/tests/test_admin_users.py`

**Interfaces:**
- Consumes: `AppUser.claude_key_state` (Task 2), set by every save, delete and flag (Tasks 3, 4).
- Produces: `GET /admin/users` rows carry `claude_key_state: "none" | "ok" | "needs_attention"`; nothing else about keys.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_admin_users.py` (it already uses `admin_client`, `db_session` and `add_app_user`):

```python
def test_the_users_list_shows_who_has_connected_claude(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="active", email="a@example.com")
    add_app_user(db_session, OTHER_USER_ID, status="active", email="b@example.com")
    db_session.query(AppUser).filter_by(id=USER_ID).update({"claude_key_state": "ok"})
    db_session.query(AppUser).filter_by(id=OTHER_USER_ID).update(
        {"claude_key_state": "needs_attention"}
    )
    db_session.commit()

    rows = {row["email"]: row for row in admin_client.get("/admin/users").json()}

    assert rows["a@example.com"]["claude_key_state"] == "ok"
    assert rows["b@example.com"]["claude_key_state"] == "needs_attention"
    assert rows["admin@example.com"]["claude_key_state"] == "none"


def test_the_users_list_exposes_no_key_material(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="active", email="a@example.com")
    db_session.add(
        UserApiKey(
            user_id=USER_ID, ciphertext=b"secret-ciphertext-bytes....", key_version=1,
            last4="9f3a", status="ok",
        )
    )
    db_session.commit()

    body = admin_client.get("/admin/users").text

    assert "9f3a" not in body
    assert "ciphertext" not in body
    assert "last4" not in body
```

(Add `UserApiKey` and `AppUser` to the file's model imports if they are missing, and `USER_ID`/`OTHER_USER_ID` from `tests.auth_support`.)

- [ ] **Step 2: Run to see it fail**

Run: `cd backend && uv run python -m pytest tests/test_admin_users.py -q`
Expected: the first test fails with a `KeyError` (`claude_key_state` is not in the response).

- [ ] **Step 3: Implement**

In `backend/app/schemas.py`, in `AdminUserOut`, after `accepted_terms_at`/`last_seen_at`, add:

```python
    claude_key_state: str = "none"  # "none" | "ok" | "needs_attention": never the key or its last digits
```

(`from_attributes=True` already fills it from the `AppUser` column.)

- [ ] **Step 4: Run the tests and the suite**

Run: `cd backend && uv run ruff check --fix . && uv run ruff format . && uv run mypy app && uv run python -m pytest tests -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/tests/test_admin_users.py
git commit -m "feat: show on the admin Users list who has connected Claude

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Documentation and the operational steps

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`
- Modify: `backend/.env.example`

**Interfaces:**
- Produces: the owner's instructions for the new secret, rotation and the loss scenario.

- [ ] **Step 1: ARCHITECTURE**

Find the data-model section and the API table (search for `app_settings` and `/me/export`) and add:
- the table `user_api_keys` (columns as in the migration; encrypted by the app; owner-only row-level security; never exported) and the `app_users.claude_key_state` column;
- the three API rows, in the same style as the neighbouring rows:

```markdown
| GET | `/me/claude-key` | — | `{connected, last4, needs_attention}`; never the key |
| PUT | `/me/claude-key` | `{api_key}` | Checks the shape, then one free call to Anthropic with the key (`422` with a `code` when it is invalid or unusable, `502` when Anthropic is unreachable); stores it encrypted (AES-256-GCM, `KEY_ENCRYPTION_SECRET`); 10 requests a minute per user |
| DELETE | `/me/claude-key` | — | Removes it (`204`, safe to repeat) |
```

- a sentence in the chat and analysis rows: "`409` with code `claude_key_required` when the caller has no usable Claude key (admins fall back to the server key)";
- in the production checklist: a ticked item "Per-user Claude keys: encrypted at rest, never returned or logged; `KEY_ENCRYPTION_SECRET` required in production".

- [ ] **Step 2: RUNBOOK**

In the secrets table add a row for `KEY_ENCRYPTION_SECRET` (Fly secret; "base64 of 32 random bytes; keep a copy in your password manager"; readable by the Fly app and the owner). Add a short section "Per-user Claude keys" with:

```markdown
### Create the secret (once, before the first deploy of this feature)

Generate it with `openssl rand -base64 32` and set it as a Fly secret in the dashboard (or
`fly secrets import` from a file kept outside the repo). Keep a copy in your password manager.
With `APP_ENV=production` the web process refuses to start without a valid secret.

### If the secret is lost or changed

Saved keys can no longer be decrypted. Nothing breaks loudly: each user sees "Reconnect Claude" and
saves their key again. Restoring the old value brings the saved keys back.

### Rotation

`user_api_keys.key_version` records which secret encrypted a row. Rotation (re-encrypting every row with a
new secret) is not built yet; if needed, it is a small one-off script.

### Checks after the first deploy

1. As an invited test user: Chat and Run analysis answer with "Connect Claude to use this."; save a key
   (Account); both work.
2. In the Supabase SQL editor: `SELECT user_id, last4, status FROM user_api_keys;` shows rows, and
   `SELECT convert_from(ciphertext, 'LATIN1') FROM user_api_keys LIMIT 1;` shows unreadable bytes, never
   `sk-ant-`.
3. Remove the key in Account: the row disappears and Chat is locked again.
```

- [ ] **Step 3: `.env.example`**

Add, under the other secrets, with a comment that development works without it:

```
# Encrypts users' saved Claude keys. Required in production: openssl rand -base64 32
KEY_ENCRYPTION_SECRET=
```

- [ ] **Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md docs/RUNBOOK.md backend/.env.example
git commit -m "docs: per-user Claude keys in the architecture notes and the runbook

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: STOP — design the frontend flow (huashu-design + impeccable)

The backend (Tasks 1-6) is complete and can be pushed on its own. No frontend code is written until this task is finished and the user has picked a direction.

**Files:**
- Create: `docs/design/claude-keys/` (draft HTML pages and screenshots; kept in the repo as the design reference once chosen)
- Create: `direction-approved.md` in that folder (the huashu gate file: what was shown, the screenshot paths, the user's exact choice)

- [ ] **Step 1: Run the design skills**

Invoke `huashu-design` (three real HTML directions with screenshots, using the app's tokens from `frontend/app/globals.css` and `DESIGN.md`) and `impeccable` (shape, then critique and polish of the chosen direction). The three directions must cover the same screens, each in dark and light and at phone width:
1. the **Connect Claude guide**: five numbered steps with a link each (account, credit, spend limit, create key, paste), the paste box, "Check and save", the saved state ("Connected" with the last four characters), and the reassurance note;
2. the **locked states**: the Chat input and the Run analysis button when no key is connected ("Connect Claude to use this", opening the guide), and the "needs reconnect" variant;
3. the **Today reminder card**;
4. the **Account panel** (status, Replace, Remove with confirmation);
5. the **admin Users row** showing connected / not connected / needs attention.

Use the real copy from the spec; no invented prices or limits; no emoji; no Buy/Sell wording.

- [ ] **Step 2: Present and stop**

Show the three directions (screenshots) and wait for the user's choice or mix. Do not start Task 8 until they answer.

- [ ] **Step 3: Record the decision**

Write `docs/design/claude-keys/direction-approved.md` with the shown directions, the screenshot paths and the user's choice in their words. Then write Part 2 of this plan (Tasks 8-12 below, with the chosen design's exact structure and copy filled in) and commit both.

---

## Part 2 — Frontend (written after the design pick)

These tasks are listed with their behaviour and tests now so nothing is lost; their component code is written after Task 7, from the chosen direction. Each follows the same rhythm (failing Vitest test, run, implement, run, `eslint`/`tsc`/full suite, commit) and uses `useAction`, SWR, `apiFetch` and the existing MUI components.

### Task 8: API types and the `useClaudeKey` hook

**Files:** `frontend/lib/claudeKey.ts` (types, `ClaudeKeyStatus`, helpers), `frontend/lib/claudeKey.test.ts`; touches `frontend/lib/api/client.ts` only to expose the `code` field of an error body on `ApiError` (test in `client.test.ts`).

Behaviour to test: `useClaudeKey()` returns `{status, save(key), remove()}` from `GET /me/claude-key`; `save` sends `PUT /me/claude-key` with `{api_key}` and revalidates; a `422` with `code: "invalid_key"` surfaces its message; `isClaudeKeyRequired(error)` is true exactly for `409` with `code: "claude_key_required"`; the key string is never kept in state after a save (the hook holds only the response).

### Task 9: The Connect Claude guide component

**Files:** `frontend/components/claude/ConnectClaudeGuide.tsx` and its test.

Behaviour to test: the five steps render with their links (`target="_blank"`, `rel="noopener noreferrer"`); the paste box is a password-type field with `autoComplete="off"`; "Check and save" is disabled until the field has content, shows a progress state, and on success shows "Connected" with the last four characters and clears the field; each rejection message from the backend is shown inline without echoing the key; a transient failure keeps what was typed.

### Task 10: Locked states and the Today reminder

**Files:** `frontend/components/claude/ClaudeRequired.tsx` (the card), edits to `frontend/app/(shell)/chat/page.tsx`, `frontend/app/(shell)/today/page.tsx` and its Run analysis button, with tests in the existing page tests.

Behaviour to test: without a connected key Chat shows the card instead of the composer, Run analysis is disabled with the card or message, and Today shows the reminder; with a connected key none of them show; a `409 claude_key_required` response from `/chat` or `/analysis/run` (for example a key revoked mid-session) turns the screen into the reconnect variant without a generic error; other screens (Portfolio, Watchlist, Track record, Backtests, Preferences) are unaffected.

### Task 11: The Account panel

**Files:** `frontend/components/account/ClaudeKeyPanel.tsx`, mounted in `frontend/app/(shell)/more/account/page.tsx`, with a test.

Behaviour to test: not connected shows the guide; connected shows "Connected" and `sk-ant-…<last4>` with Replace (opens the guide) and Remove (a confirmation dialog, then `DELETE`); `needs_attention` shows the reconnect prompt; removing refreshes the status and re-locks Chat.

### Task 12: Admin Users row

**Files:** `frontend/lib/api/admin-types.ts` (`claude_key_state`), the Users page row and detail sheet, with tests in the existing admin tests.

Behaviour to test: each row shows connected / not connected / needs attention from `claude_key_state`; nothing else about keys is displayed; the phone layout does not overflow.

---

### Task 13: Security review and the pull request

- [ ] **Step 1:** Run the full backend and frontend checks (`uv run ruff check . && uv run mypy app && uv run python -m pytest tests -q`; `npx eslint . && npx tsc --noEmit && npx vitest run`).
- [ ] **Step 2:** Dispatch the `security-reviewer` subagent on `git diff master...HEAD` with this brief: the key must never appear in a response, a log line, an exception message, Redis, job state or a module global; no code path returns the ciphertext; the associated-data binding; the production start-up guard; the rate limit on saving; the `422` bodies never echo the key; row-level security isolation of `user_api_keys`; the `app_users.claude_key_state` mirror cannot be used to learn anything but the state; the migration grants. Fix every finding it confirms in one pass, then re-run the checks.
- [ ] **Step 3:** Push the branch and open the pull request. In the description list the one-off owner steps: generate and set `KEY_ENCRYPTION_SECRET` before merging (the web process refuses to start in production without it), then follow the RUNBOOK checks after the deploy.
