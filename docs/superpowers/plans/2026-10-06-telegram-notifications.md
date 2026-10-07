# Telegram notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person who connects Telegram gets one short message on weekday mornings with the new recommendations from the automatic analysis and any of their tickers that moved more than their threshold.

**Architecture:** A shared Telegram bot (token in Fly secrets). The FastAPI app gets a webhook that only handles `/start <code>` (link) and `/stop` (unlink), plus `/me/telegram` settings routes and a `telegram_links` table with owner-only row security. The weekday job gets a final `notify` step that builds each person's message inside their own scoped session and sends it through a small Bot API client. A per-user per-day Redis marker makes a re-run send nothing twice. Telegram problems never turn the job red.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic (hand-written migration), Redis, httpx, pytest; Next.js 16, MUI 9, SWR, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-telegram-notifications-design.md`

## Global Constraints

- The system never places a trade. A message only points back to the app and ends with the line "Advisory only. Nothing is sent to a broker."
- Message content: tickers, actions and percentages only. No amounts, no reasoning text, no portfolio value. Plain text, no formatting mode.
- One shared bot owned by the admin. Linking a chat is the opt-in. Two switches (`digest_enabled`, `moves_enabled`, both default on) and `move_threshold_pct` (default 5.0, allowed 1 to 50).
- A chat belongs to at most one user and a user has at most one chat (unique `user_id`, unique `chat_id`).
- Link codes: `secrets.token_urlsafe(16)` (22 characters), stored in Redis for 600 seconds, used once (atomic `GETDEL`), never logged.
- The webhook accepts only requests with the header `X-Telegram-Bot-Api-Secret-Token` equal to `TELEGRAM_WEBHOOK_SECRET` (`hmac.compare_digest`) and answers 401 otherwise, including when the secret is not configured. It handles private chats only and the commands `/start <code>`, `/start` and `/stop`.
- The bot token never appears in a log, a response or an exception message. httpx exception text contains the request URL (and so the token): never let it travel; raise fixed-text errors `from None`. Errors log the exception class name only.
- Weekdays only (UTC) for the `notify` step. Nothing to say means nothing is sent. At most one message per person per UTC day (marker `telegram:sent:{user_id}:{YYYY-MM-DD}`, `SET NX EX 90000`; cleared when nothing was delivered).
- A Telegram outage or bad token never changes the job's exit code. Summary counters: `notify_sent`, `notify_skipped`, `notify_failures`.
- Hand-written migration only (a new file; existing ones are never edited). Alembic head before this work: `b3d9e5a17c42`.
- Frontend copy: the Account panel title "Telegram"; button "Connect Telegram"; the blocked state "Telegram stopped receiving messages. Reconnect to get them again."; a note "Messages list tickers and actions only, never amounts or reasoning. Advisory only." No emoji, no Buy/Sell wording.
- Conventional Commits; never skip hooks or GPG signing; branch `feature/telegram-notifications`.

## Review Focus

Failure modes the spec implies that no single task's happy path exercises (each pinned by a test in the task named in brackets):

1. **Codes:** an unknown, expired or already-used code never links; a chat already linked to another account is refused (and the code is consumed); a second `/start` from the same user replaces their chat. [Task 4]
2. **Blocked bot:** a 403 or "chat not found" marks the link `blocked`, sends nothing more, burns no marker, and a later reconnect resets it to `ok`. [Tasks 2, 5]
3. **Re-run the same day:** a second `notify` the same day sends nothing; a failed send (nothing delivered) clears the marker so a retry can still send. [Task 5]
4. **Token hygiene:** the token never appears in logs or exceptions even when httpx raises (URL in its message). [Task 2]
5. **Isolation:** each message is built from one user's scoped session only; a user's message never contains another's tickers; an unlinked or `blocked` or disabled user gets nothing. [Task 5]
6. **Webhook hardening:** missing or wrong secret (and an unset secret) gives 401; non-JSON, empty, group-chat and non-text updates return 200 without crashing; `/stop` from a chat the app does not know answers politely. [Task 4]
7. **Quotes failing:** if price lookups fail the digest part is still sent; if both parts are empty nothing is sent. [Task 5]

---

## File Structure

- Create `backend/migrations/versions/c8e2f6a41d37_add_telegram_links.py` — the table.
- Modify `backend/app/models.py` (`TelegramLink`), `backend/app/rls.py` (`USER_TABLES`), `backend/app/config.py` (four settings), `backend/app/schemas.py` (`ExportOut.telegram`, Telegram request and response models), `backend/app/main.py` (routers), `backend/app/routers/me.py` (export), `backend/app/scheduled.py` (counters, `notify` command), `backend/.env.example`.
- Create `backend/app/telegram.py` — Bot API client, `get_bot`, link-code helpers, the `set-webhook` command.
- Create `backend/app/routers/telegram.py` — `/me/telegram` routes and the webhook.
- Create `backend/app/notify.py` — `build_message`, price moves, `notify_user`.
- Tests: `backend/tests/test_telegram_migration.py`, `test_telegram_client.py`, `test_telegram_router.py`, `test_telegram_webhook.py`, `test_notify.py`, plus edits to `test_auto_analysis_migration.py`, `test_scheduled.py`, `test_me_router.py`, `tests/auth_support.py` (`ROW_FACTORIES`), `tests/conftest.py` (Redis flush patterns).
- Docs: `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `PRODUCT.md`.
- Frontend (Part 2): `frontend/lib/telegram.ts`, `frontend/components/account/TelegramPanel.tsx`, the Account page.

---

## Part 1 — Backend

### Task 1: The `telegram_links` table and the settings

**Files:**
- Create: `backend/migrations/versions/c8e2f6a41d37_add_telegram_links.py`
- Modify: `backend/app/models.py`, `backend/app/rls.py:10-20`, `backend/app/config.py`, `backend/.env.example`, `backend/tests/auth_support.py` (`ROW_FACTORIES`), `backend/tests/test_auto_analysis_migration.py` (its head assertion)
- Test: new `backend/tests/test_telegram_migration.py`, `backend/tests/test_models.py`

**Interfaces:**
- Produces: model `TelegramLink(id, user_id unique, chat_id BigInteger unique, status "ok"|"blocked", digest_enabled, moves_enabled, move_threshold_pct Numeric(4,1), linked_at, updated_at)`; `"telegram_links"` in `rls.USER_TABLES`; settings `telegram_bot_token`, `telegram_webhook_secret`, `telegram_bot_username`, `app_url` (all `str | None = None`).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_telegram_migration.py` (same pattern as `test_auto_analysis_migration.py`):

```python
import importlib.util
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parent.parent


def _migration():
    path = next((BACKEND / "migrations" / "versions").glob("*_add_telegram_links.py"))
    spec = importlib.util.spec_from_file_location("add_telegram_links", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_is_the_single_head_on_top_of_the_auto_analysis_revision():
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()

    migration = _migration()
    assert heads == [migration.revision]
    assert migration.down_revision == "b3d9e5a17c42"
```

In `backend/tests/test_auto_analysis_migration.py` replace the `heads == [migration.revision]` assertion with `assert len(heads) == 1` (the new test pins the real head), keeping the `down_revision` assertion.

Append to `backend/tests/test_models.py` (use the file's session fixture):

```python
def test_telegram_link_defaults(session):
    link = TelegramLink(user_id=uuid.uuid4(), chat_id=123456789)
    session.add(link)
    session.commit()
    session.refresh(link)
    assert (link.status, link.digest_enabled, link.moves_enabled) == ("ok", True, True)
    assert float(link.move_threshold_pct) == 5.0
```

- [ ] **Step 2: Run to verify they fail**

Run (from `backend/`): `uv run --system-certs pytest tests/test_telegram_migration.py tests/test_models.py -q`
Expected: FAIL (`StopIteration`, `ImportError: TelegramLink`).

- [ ] **Step 3: Write the migration**

Use `backend/migrations/versions/f4a1c8d27b90_add_user_api_keys.py` as the template for the grants and policy lines.

```python
"""add telegram_links

Revision ID: c8e2f6a41d37
Revises: b3d9e5a17c42
Create Date: 2026-10-06 20:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app import rls

# revision identifiers, used by Alembic.
revision: str = 'c8e2f6a41d37'
down_revision: Union[str, Sequence[str], None] = 'b3d9e5a17c42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "telegram_links"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="ok"),
        sa.Column("digest_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("moves_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "move_threshold_pct", sa.Numeric(4, 1), nullable=False, server_default="5.0"
        ),
        sa.Column("linked_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("move_threshold_pct >= 1 AND move_threshold_pct <= 50"),
        sa.CheckConstraint("status IN ('ok', 'blocked')"),
    )
    op.create_index(op.f("ix_telegram_links_user_id"), TABLE, ["user_id"], unique=True)
    # One chat belongs to at most one account, enforced across all users (RLS does not hide rows
    # from a unique index).
    op.create_index(op.f("ix_telegram_links_chat_id"), TABLE, ["chat_id"], unique=True)
    # Same grants and forced owner-only policy as every other user table.
    for statement in rls.grant_table_sql(TABLE):
        op.execute(statement)
    for statement in rls.policy_sql(TABLE):
        op.execute(statement)


def downgrade() -> None:
    op.execute(f"DROP POLICY IF EXISTS {TABLE}_owner ON {TABLE}")
    op.drop_index(op.f("ix_telegram_links_chat_id"), table_name=TABLE)
    op.drop_index(op.f("ix_telegram_links_user_id"), table_name=TABLE)
    op.drop_table(TABLE)
```

- [ ] **Step 4: Model, lists, settings, factory**

`backend/app/models.py` (add `BigInteger` to the `sqlalchemy` import with its first use):

```python
class TelegramLink(Base):
    """A person's connected Telegram chat and their notification settings. One row per user."""

    __tablename__ = "telegram_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, index=True)
    chat_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(10), default="ok", server_default="ok")  # ok|blocked
    digest_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=expression.true()
    )
    moves_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=expression.true()
    )
    move_threshold_pct: Mapped[float] = mapped_column(
        Numeric(4, 1), default=5.0, server_default="5.0"
    )
    linked_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
```

`backend/app/rls.py`: append `"telegram_links",` to `USER_TABLES`.

`backend/app/config.py` (in `Settings`, next to the other optional secrets):

```python
    telegram_bot_token: str | None = None  # BotFather token; without it the Telegram features are off
    telegram_webhook_secret: str | None = None  # long random string Telegram sends back as a header
    telegram_bot_username: str | None = None  # without the @, for the t.me link
    app_url: str | None = None  # the frontend origin, for the link to Today in a message
```

`backend/.env.example`: add the four names with empty values and a one-line comment each.

`backend/tests/auth_support.py` `ROW_FACTORIES`: add `"telegram_links": lambda uid: TelegramLink(user_id=uid, chat_id=uid.int % 10**12 + 1)` (a chat id derived from the user id so two factory users never collide; import `TelegramLink`).

- [ ] **Step 5: Apply and run**

Run: `uv run --system-certs alembic upgrade head` (local database only, confirm the host in `backend/.env` is localhost), then `uv run --system-certs pytest tests/test_telegram_migration.py tests/test_models.py tests/test_auto_analysis_migration.py tests/test_rls.py -q`, then the full suite, ruff and mypy.
Expected: PASS (`test_rls.py` runs its parametrized isolation tests over `USER_TABLES`, so the new table is covered).

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat: telegram_links table with row-level security and the Telegram settings"
```

---

### Task 2: The Telegram client (`app/telegram.py`)

**Files:**
- Create: `backend/app/telegram.py`
- Test: `backend/tests/test_telegram_client.py`

**Interfaces:**
- Consumes: Task 1 settings.
- Produces:
  - `class TelegramError(Exception)`; `class TelegramBlocked(TelegramError)` (403, or "chat not found").
  - `class TelegramBot(token: str, transport: httpx.AsyncBaseTransport | None = None)` with `async send_message(chat_id: int, text: str) -> None` and `async set_webhook(url: str, secret: str) -> None`.
  - `get_bot() -> TelegramBot | None` (None when `telegram_bot_token` is unset). Tests and routes patch `app.telegram.get_bot`.
  - Link-code helpers: `async create_link_code(user_id: uuid.UUID) -> str` (stores `telegram:link:{code}` with `EX 600`), `async consume_link_code(code: str) -> uuid.UUID | None` (atomic `GETDEL`), and chat mapping helpers `async remember_chat(chat_id: int, user_id: uuid.UUID)`, `async user_for_chat(chat_id: int) -> uuid.UUID | None`, `async forget_chat(chat_id: int)` (key `telegram:chat:{chat_id}`, no TTL).
  - `LINK_CODE_SECONDS = 600`.
  - Command line: `python -m app.telegram set-webhook <public webhook url>`.

- [ ] **Step 1: Write the failing tests**

```python
import asyncio
import logging
import uuid

import httpx
import pytest

from app import telegram
from app.redis_client import get_redis

TOKEN = "123456:SECRET-token-value"


def _bot(handler):
    return telegram.TelegramBot(TOKEN, transport=httpx.MockTransport(handler))


def test_send_message_posts_plain_text_to_the_bot_api():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["json"] = request.read().decode()
        return httpx.Response(200, json={"ok": True, "result": {}})

    asyncio.run(_bot(handler).send_message(42, "hello"))
    assert seen["url"] == f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    assert '"chat_id":42' in seen["json"].replace(" ", "") and "parse_mode" not in seen["json"]


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(403, json={"ok": False, "description": "Forbidden: bot was blocked by the user"}),
        httpx.Response(400, json={"ok": False, "description": "Bad Request: chat not found"}),
    ],
)
def test_a_blocked_or_missing_chat_raises_telegram_blocked(response):
    with pytest.raises(telegram.TelegramBlocked):
        asyncio.run(_bot(lambda request: response).send_message(42, "hi"))


@pytest.mark.parametrize("status", [429, 500, 502])
def test_other_failures_raise_telegram_error_not_blocked(status):
    with pytest.raises(telegram.TelegramError) as caught:
        asyncio.run(_bot(lambda request: httpx.Response(status, json={})).send_message(42, "hi"))
    assert not isinstance(caught.value, telegram.TelegramBlocked)


def test_the_token_never_travels_in_an_error_even_when_httpx_raises(caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom connecting to " + str(request.url))

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(telegram.TelegramError) as caught:
            asyncio.run(_bot(handler).send_message(42, "hi"))
    assert TOKEN not in str(caught.value) and TOKEN not in repr(caught.value)
    assert TOKEN not in caplog.text
    assert caught.value.__cause__ is None and caught.value.__suppress_context__


def test_get_bot_is_none_without_a_token(monkeypatch):
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", None)
    assert telegram.get_bot() is None
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", TOKEN)
    assert telegram.get_bot() is not None


def _run(coro):
    # Each asyncio.run is its own event loop and the cached Redis client is bound to one.
    import app.redis_client as redis_client_module

    try:
        return asyncio.run(coro)
    finally:
        redis_client_module._redis = None


def test_a_link_code_works_once_and_expires():
    user_id = uuid.uuid4()
    code = _run(telegram.create_link_code(user_id))
    assert len(code) == 22
    assert _run(get_redis().ttl(f"telegram:link:{code}")) in range(1, telegram.LINK_CODE_SECONDS + 1)
    assert _run(telegram.consume_link_code(code)) == user_id
    assert _run(telegram.consume_link_code(code)) is None          # used once
    assert _run(telegram.consume_link_code("nope-not-a-code-xx")) is None


def test_chat_mapping_round_trip():
    user_id = uuid.uuid4()
    _run(telegram.remember_chat(555, user_id))
    assert _run(telegram.user_for_chat(555)) == user_id
    _run(telegram.forget_chat(555))
    assert _run(telegram.user_for_chat(555)) is None
```

(If `tests/conftest.py` flushes Redis by key patterns, add `telegram:*` to them so tests start clean; look at how `usage:*` and `auto_analysis:*` are flushed.)

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --system-certs pytest tests/test_telegram_client.py -q`
Expected: FAIL (`ModuleNotFoundError: app.telegram`).

- [ ] **Step 3: Implement**

`backend/app/telegram.py`:

```python
"""A small Telegram Bot API client, the one-time link codes and the chat-to-user mapping.

httpx puts the request URL in its exception text, and the URL contains the bot token, so nothing
from an httpx exception may travel: every failure becomes a TelegramError with fixed text raised
`from None`. Logs carry exception class names only.
"""

import argparse
import asyncio
import logging
import secrets
import sys
import uuid

import httpx

from app.config import settings
from app.redis_client import get_redis

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 10.0
LINK_CODE_SECONDS = 600


class TelegramError(Exception):
    """A Bot API call failed. The message never carries the token, a URL or Telegram's reply."""


class TelegramBlocked(TelegramError):
    """The person blocked the bot, or the chat no longer exists: stop sending to it."""


class TelegramBot:
    def __init__(self, token: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._base = f"https://api.telegram.org/bot{token}"
        self._transport = transport

    async def _post(self, method: str, payload: dict[str, object]) -> None:
        try:
            async with httpx.AsyncClient(
                timeout=REQUEST_TIMEOUT_SECONDS, transport=self._transport
            ) as client:
                response = await client.post(f"{self._base}/{method}", json=payload)
        except httpx.HTTPError:
            raise TelegramError("Could not reach Telegram") from None
        if response.is_success:
            return
        description = ""
        try:
            description = str(response.json().get("description", "")).lower()
        except (ValueError, AttributeError):
            pass
        if response.status_code == 403 or "chat not found" in description:
            raise TelegramBlocked("The chat cannot receive messages")
        raise TelegramError(f"Telegram answered HTTP {response.status_code}")

    async def send_message(self, chat_id: int, text: str) -> None:
        # Plain text: no parse_mode, so nothing in a message can be read as markup.
        await self._post(
            "sendMessage", {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
        )

    async def set_webhook(self, url: str, secret: str) -> None:
        await self._post(
            "setWebhook", {"url": url, "secret_token": secret, "allowed_updates": ["message"]}
        )


def get_bot() -> TelegramBot | None:
    token = settings.telegram_bot_token
    return TelegramBot(token) if token else None


async def create_link_code(user_id: uuid.UUID) -> str:
    code = secrets.token_urlsafe(16)  # 22 characters, 128 bits; also fits Telegram's /start payload
    await get_redis().set(f"telegram:link:{code}", str(user_id), ex=LINK_CODE_SECONDS)
    return code


async def consume_link_code(code: str) -> uuid.UUID | None:
    """Atomic get-and-delete, so a code links at most once."""
    value = await get_redis().getdel(f"telegram:link:{code}")
    try:
        return uuid.UUID(value) if value else None
    except ValueError:
        return None


async def remember_chat(chat_id: int, user_id: uuid.UUID) -> None:
    await get_redis().set(f"telegram:chat:{chat_id}", str(user_id))


async def user_for_chat(chat_id: int) -> uuid.UUID | None:
    value = await get_redis().get(f"telegram:chat:{chat_id}")
    try:
        return uuid.UUID(value) if value else None
    except ValueError:
        return None


async def forget_chat(chat_id: int) -> None:
    await get_redis().delete(f"telegram:chat:{chat_id}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.telegram")
    sub = parser.add_subparsers(dest="command", required=True)
    hook = sub.add_parser("set-webhook", help="register the webhook with Telegram")
    hook.add_argument("url", help="the public URL of POST /telegram/webhook")
    args = parser.parse_args(argv)
    bot, secret = get_bot(), settings.telegram_webhook_secret
    if bot is None or not secret:
        print("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must both be set", file=sys.stderr)
        return 1
    try:
        asyncio.run(bot.set_webhook(args.url, secret))
    except TelegramError as exc:
        print(f"set-webhook failed: {exc}", file=sys.stderr)
        return 1
    print("Webhook registered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

(The `print` calls are the command's user output, not debugging; if the repo's lint forbids them, use `sys.stdout.write`/`sys.stderr.write` instead.)

- [ ] **Step 4: Run**

Run: `uv run --system-certs pytest tests/test_telegram_client.py -q`, then the full suite, ruff, mypy.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/telegram.py backend/tests
git commit -m "feat: Telegram Bot API client, link codes and the set-webhook command"
```

---

### Task 3: The settings routes (`/me/telegram`)

**Files:**
- Create: `backend/app/routers/telegram.py` (the `/me/telegram` router first; Task 4 adds the webhook router to this file)
- Modify: `backend/app/schemas.py`, `backend/app/main.py`
- Test: `backend/tests/test_telegram_router.py`

**Interfaces:**
- Consumes: Task 1 (`TelegramLink`, settings), Task 2 (`get_bot`, `create_link_code`, `forget_chat`, `LINK_CODE_SECONDS`).
- Produces (all require an active user, run through `get_user_db`, follow `app/routers/claude_key.py`):
  - `GET /me/telegram` -> `{configured: bool, linked: bool, status: "ok"|"blocked"|null, digest_enabled: bool, moves_enabled: bool, move_threshold_pct: float, bot_username: str|null}` (defaults when not linked; `configured` is false without a token or username).
  - `POST /me/telegram/link` (rate limited 10 per minute) -> `{url, expires_in}`; 503 `{"detail": "Telegram is not set up on this server."}` when not configured.
  - `PATCH /me/telegram` body `{digest_enabled?, moves_enabled?, move_threshold_pct?}` (threshold 1 to 50, one decimal) -> the same shape as GET; 404 `"Not connected"` when there is no link; only the fields sent change.
  - `DELETE /me/telegram` -> 204 (removes the row; removes the Redis chat mapping; idempotent).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_telegram_router.py` (fixtures: `client` is a signed-in active user, `anon_client` is not; look at `tests/test_claude_key_router.py` for how it builds rows and resets Redis; `monkeypatch` the settings):

```python
import pytest

from app import telegram
from app.models import TelegramLink
from tests.auth_support import OTHER_USER_ID, USER_ID


@pytest.fixture()
def configured(monkeypatch):
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", "123:abc")
    monkeypatch.setattr(telegram.settings, "telegram_bot_username", "trade_agent_bot")


def _link(db_session, user_id=USER_ID, chat_id=1001, **kwargs):
    db_session.add(TelegramLink(user_id=user_id, chat_id=chat_id, **kwargs))
    db_session.commit()


def test_not_linked_shows_the_defaults(client, configured):
    body = client.get("/me/telegram").json()
    assert body == {
        "configured": True, "linked": False, "status": None, "digest_enabled": True,
        "moves_enabled": True, "move_threshold_pct": 5.0, "bot_username": "trade_agent_bot",
    }


def test_without_a_token_the_routes_say_so_plainly(client, monkeypatch):
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", None)
    assert client.get("/me/telegram").json()["configured"] is False
    response = client.post("/me/telegram/link")
    assert response.status_code == 503
    assert response.json()["detail"] == "Telegram is not set up on this server."


def test_link_returns_a_t_me_url_with_a_one_time_code(client, configured):
    body = client.post("/me/telegram/link").json()
    assert body["expires_in"] == telegram.LINK_CODE_SECONDS
    prefix = "https://t.me/trade_agent_bot?start="
    assert body["url"].startswith(prefix) and len(body["url"]) == len(prefix) + 22


def test_link_creation_is_rate_limited(client, configured):
    statuses = [client.post("/me/telegram/link").status_code for _ in range(11)]
    assert statuses[:10] == [200] * 10 and statuses[10] == 429


def test_patch_changes_only_the_fields_sent(client, configured, db_session):
    _link(db_session)
    body = client.patch("/me/telegram", json={"move_threshold_pct": 7.5}).json()
    assert (body["linked"], body["digest_enabled"], body["moves_enabled"]) == (True, True, True)
    assert body["move_threshold_pct"] == 7.5
    body = client.patch("/me/telegram", json={"digest_enabled": False}).json()
    assert body["digest_enabled"] is False and body["move_threshold_pct"] == 7.5


@pytest.mark.parametrize("value", [0, 0.9, 50.1, 100, -5])
def test_the_threshold_must_be_between_1_and_50(client, configured, db_session, value):
    _link(db_session)
    assert client.patch("/me/telegram", json={"move_threshold_pct": value}).status_code == 422


def test_patch_without_a_link_is_404(client, configured):
    assert client.patch("/me/telegram", json={"digest_enabled": False}).status_code == 404


def test_delete_unlinks_and_is_idempotent(client, configured, db_session):
    _link(db_session)
    assert client.delete("/me/telegram").status_code == 204
    assert client.delete("/me/telegram").status_code == 204
    assert client.get("/me/telegram").json()["linked"] is False


def test_another_users_link_is_invisible(client, configured, db_session):
    _link(db_session, user_id=OTHER_USER_ID, chat_id=2002)
    body = client.get("/me/telegram").json()
    assert body["linked"] is False
    assert client.delete("/me/telegram").status_code == 204
    assert db_session.query(TelegramLink).filter_by(user_id=OTHER_USER_ID).count() == 1


def test_the_response_never_contains_the_chat_id(client, configured, db_session):
    _link(db_session, chat_id=987654321)
    assert "987654321" not in client.get("/me/telegram").text


def test_the_routes_require_authentication(anon_client):
    assert anon_client.get("/me/telegram").status_code == 401
    assert anon_client.post("/me/telegram/link").status_code == 401
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --system-certs pytest tests/test_telegram_router.py -q`
Expected: FAIL (404 for the routes).

- [ ] **Step 3: Implement**

`backend/app/schemas.py` additions:

```python
class TelegramOut(BaseModel):
    configured: bool
    linked: bool
    status: Literal["ok", "blocked"] | None = None
    digest_enabled: bool = True
    moves_enabled: bool = True
    move_threshold_pct: float = 5.0
    bot_username: str | None = None


class TelegramLinkOut(BaseModel):
    url: str
    expires_in: int


class TelegramSettingsIn(BaseModel):
    digest_enabled: bool | None = None
    moves_enabled: bool | None = None
    move_threshold_pct: float | None = Field(default=None, ge=1, le=50)
```

`backend/app/routers/telegram.py` (follow `routers/claude_key.py`: router-level `Depends(get_current_user)`, `get_user_db`, explicit rollback on a failed commit, `run_in_threadpool` for blocking DB work in async handlers):

```python
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from fastapi import Response

from app import telegram
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.config import settings
from app.models import TelegramLink
from app.rate_limit import rate_limiter
from app.schemas import TelegramLinkOut, TelegramOut, TelegramSettingsIn

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/me/telegram", tags=["telegram"], dependencies=[Depends(get_current_user)]
)

NOT_SET_UP = "Telegram is not set up on this server."


def _configured() -> bool:
    return bool(settings.telegram_bot_token and settings.telegram_bot_username)


def _out(link: TelegramLink | None) -> TelegramOut:
    base = {"configured": _configured(), "bot_username": settings.telegram_bot_username}
    if link is None:
        return TelegramOut(linked=False, **base)
    return TelegramOut(
        linked=True,
        status=link.status,
        digest_enabled=link.digest_enabled,
        moves_enabled=link.moves_enabled,
        move_threshold_pct=float(link.move_threshold_pct),
        **base,
    )


def _load(db: Session, user: CurrentUser) -> TelegramLink | None:
    return db.query(TelegramLink).filter_by(user_id=user.id).one_or_none()


@router.get("", response_model=TelegramOut)
def get_telegram(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> TelegramOut:
    return _out(_load(db, user))


@router.post(
    "/link",
    response_model=TelegramLinkOut,
    dependencies=[Depends(rate_limiter("telegram_link", limit=10))],
)
async def create_link(user: CurrentUser = Depends(get_current_user)) -> TelegramLinkOut:
    if not _configured():
        raise HTTPException(status_code=503, detail=NOT_SET_UP)
    code = await telegram.create_link_code(user.id)
    return TelegramLinkOut(
        url=f"https://t.me/{settings.telegram_bot_username}?start={code}",
        expires_in=telegram.LINK_CODE_SECONDS,
    )


@router.patch("", response_model=TelegramOut)
def update_telegram(
    payload: TelegramSettingsIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> TelegramOut:
    link = _load(db, user)
    if link is None:
        raise HTTPException(status_code=404, detail="Not connected")
    for field, value in payload.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(link, field, value)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    db.refresh(link)
    return _out(link)


@router.delete("", status_code=204)
async def delete_telegram(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> Response:
    link = await run_in_threadpool(_load, db, user)
    if link is not None:
        chat_id = link.chat_id
        try:
            await run_in_threadpool(_delete, db, link)
        except SQLAlchemyError:
            await run_in_threadpool(db.rollback)
            raise
        await telegram.forget_chat(chat_id)
    return Response(status_code=204)


def _delete(db: Session, link: TelegramLink) -> None:
    db.delete(link)
    db.commit()
```

(`move_threshold_pct` comes from a Numeric column as `Decimal`: convert with `float`.) Register in `backend/app/main.py`: `from app.routers import telegram as telegram_routes` and `app.include_router(telegram_routes.router)` (mind the name clash with `app.telegram`; name the router module import to avoid shadowing).

- [ ] **Step 4: Run**

Run: `uv run --system-certs pytest tests/test_telegram_router.py tests/test_routes_require_auth.py -q`, then the full suite, ruff, mypy.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat: /me/telegram routes to connect, adjust and disconnect Telegram"
```

---

### Task 4: The webhook, the data export and data deletion

**Files:**
- Modify: `backend/app/routers/telegram.py` (add `webhook_router`), `backend/app/main.py`, `backend/app/schemas.py` (`ExportOut.telegram`), `backend/app/routers/me.py` (export)
- Test: `backend/tests/test_telegram_webhook.py`, edits to `backend/tests/test_me_router.py`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces:
  - `POST /telegram/webhook` (no user authentication; header secret) -> always `{"ok": true}` with status 200 once the secret matched; 401 on a missing or wrong secret or when `TELEGRAM_WEBHOOK_SECRET` is unset.
  - Behaviour on a private-chat text message: `/start <code>` links; `/start` alone and any other text get a fixed one-line reply; `/stop` unlinks. Replies go through `telegram.get_bot()`; a failing reply is logged by class name and ignored.
  - `ExportOut.telegram: TelegramExportOut | None` with `{linked, status, digest_enabled, moves_enabled, move_threshold_pct}` and never the chat id.

Fixed replies (verbatim): linked "Connected. You will get a short message on weekday mornings when there is something to look at. Send /stop to disconnect."; expired or unknown code "That link has expired. Open Account in the app and press Connect Telegram again."; chat belongs to another account "This chat is already connected to another account."; bare `/start` "Open the app, go to Account and press Connect Telegram."; `/stop` done "Disconnected. You will not get any more messages."; `/stop` from an unknown chat "This chat is not connected. If you still get messages, disconnect in the app under Account."; anything else "I only understand /start and /stop."

Decision (plan ruling): the webhook has no user context, so it cannot look up a link by `chat_id` through row-level security. `/stop` therefore resolves the user from the Redis chat mapping written at link time (`telegram.user_for_chat`), then deletes the row inside `scoped_session(user_id)`. The unique index on `chat_id` enforces "one chat, one account" at the database, whatever the mapping says.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_telegram_webhook.py` (fixture `anon_client`, a `FakeBot` recording `(chat_id, text)`, patching `app.routers.telegram.telegram.get_bot` or the module attribute you import; Redis reset helper as in Task 2; the webhook opens its own DB session through `app.db.scoped_session`, so patch `app.db.SessionLocal` with the restricted-role factory the way `tests/test_scheduled.py`'s `env` fixture does):

```python
SECRET = "s3cret-value"
HEADERS = {"X-Telegram-Bot-Api-Secret-Token": SECRET}


def _update(text, chat_id=555, chat_type="private"):
    return {"update_id": 1, "message": {"chat": {"id": chat_id, "type": chat_type}, "text": text}}


class FakeBot:
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text):
        self.sent.append((chat_id, text))


@pytest.fixture()
def hook(anon_client, monkeypatch, app_session_local):
    bot = FakeBot()
    monkeypatch.setattr(telegram.settings, "telegram_webhook_secret", SECRET)
    monkeypatch.setattr(telegram_routes.telegram, "get_bot", lambda: bot)
    with patch("app.db.SessionLocal", app_session_local):
        yield anon_client, bot


def test_a_missing_or_wrong_secret_is_401(hook):
    client, bot = hook
    assert client.post("/telegram/webhook", json=_update("/start x")).status_code == 401
    bad = {"X-Telegram-Bot-Api-Secret-Token": "wrong"}
    assert client.post("/telegram/webhook", json=_update("/start x"), headers=bad).status_code == 401
    assert bot.sent == []


def test_an_unset_secret_rejects_everything(hook, monkeypatch):
    client, _ = hook
    monkeypatch.setattr(telegram.settings, "telegram_webhook_secret", None)
    assert client.post("/telegram/webhook", json=_update("/stop"), headers=HEADERS).status_code == 401


def test_start_with_a_valid_code_links_the_chat(hook, db_session):
    client, bot = hook
    code = run(telegram.create_link_code(USER_ID))
    r = client.post("/telegram/webhook", json=_update(f"/start {code}", chat_id=777), headers=HEADERS)
    assert r.status_code == 200 and r.json() == {"ok": True}
    link = db_session.query(TelegramLink).filter_by(user_id=USER_ID).one()
    assert (link.chat_id, link.status) == (777, "ok")
    assert bot.sent == [(777, CONNECTED)]
    assert run(telegram.user_for_chat(777)) == USER_ID


def test_a_code_works_only_once_and_an_unknown_one_not_at_all(hook, db_session):
    client, bot = hook
    code = run(telegram.create_link_code(USER_ID))
    client.post("/telegram/webhook", json=_update(f"/start {code}", chat_id=777), headers=HEADERS)
    client.post("/telegram/webhook", json=_update(f"/start {code}", chat_id=888), headers=HEADERS)
    client.post("/telegram/webhook", json=_update("/start nope-nope-nope-nope-x", chat_id=999), headers=HEADERS)
    assert db_session.query(TelegramLink).count() == 1
    assert [t for _, t in bot.sent[1:]] == [EXPIRED, EXPIRED]


def test_a_chat_already_linked_to_someone_else_is_refused_and_the_code_is_spent(hook, db_session):
    client, bot = hook
    db_session.add(TelegramLink(user_id=OTHER_USER_ID, chat_id=777))
    db_session.commit()
    code = run(telegram.create_link_code(USER_ID))
    client.post("/telegram/webhook", json=_update(f"/start {code}", chat_id=777), headers=HEADERS)
    assert bot.sent == [(777, TAKEN)]
    assert db_session.query(TelegramLink).filter_by(user_id=USER_ID).count() == 0
    assert run(telegram.consume_link_code(code)) is None


def test_start_again_from_a_new_chat_replaces_the_chat_and_clears_blocked(hook, db_session):
    client, bot = hook
    db_session.add(TelegramLink(user_id=USER_ID, chat_id=111, status="blocked", digest_enabled=False))
    db_session.commit()
    code = run(telegram.create_link_code(USER_ID))
    client.post("/telegram/webhook", json=_update(f"/start {code}", chat_id=222), headers=HEADERS)
    db_session.expire_all()
    link = db_session.query(TelegramLink).filter_by(user_id=USER_ID).one()
    assert (link.chat_id, link.status, link.digest_enabled) == (222, "ok", False)  # settings kept


def test_stop_unlinks_a_known_chat_and_answers_politely_to_an_unknown_one(hook, db_session):
    client, bot = hook
    db_session.add(TelegramLink(user_id=USER_ID, chat_id=777))
    db_session.commit()
    run(telegram.remember_chat(777, USER_ID))
    client.post("/telegram/webhook", json=_update("/stop", chat_id=777), headers=HEADERS)
    assert db_session.query(TelegramLink).count() == 0
    client.post("/telegram/webhook", json=_update("/stop", chat_id=31337), headers=HEADERS)
    assert [t for _, t in bot.sent] == [STOPPED, NOT_CONNECTED]


@pytest.mark.parametrize(
    "body",
    [{}, {"update_id": 1}, {"message": {"chat": {"id": 1, "type": "group"}, "text": "/start x"}},
     {"message": {"chat": {"id": 1, "type": "private"}}}, {"edited_message": {}}],
)
def test_other_updates_are_acknowledged_and_ignored(hook, body):
    client, bot = hook
    assert client.post("/telegram/webhook", json=body, headers=HEADERS).status_code == 200
    assert bot.sent == []


def test_not_json_is_acknowledged_without_crashing(hook):
    client, _ = hook
    r = client.post("/telegram/webhook", content=b"not json", headers={**HEADERS, "content-type": "text/plain"})
    assert r.status_code == 200


def test_a_failing_reply_does_not_fail_the_webhook(hook, db_session, monkeypatch):
    client, bot = hook

    async def boom(chat_id, text):
        raise telegram.TelegramError("x")

    bot.send_message = boom
    r = client.post("/telegram/webhook", json=_update("hello"), headers=HEADERS)
    assert r.status_code == 200


def test_the_webhook_never_logs_the_secret_or_the_code(hook, caplog):
    client, _ = hook
    code = run(telegram.create_link_code(USER_ID))
    with caplog.at_level(logging.DEBUG):
        client.post("/telegram/webhook", json=_update(f"/start {code}"), headers=HEADERS)
    assert SECRET not in caplog.text and code not in caplog.text
```

(Define `CONNECTED`, `EXPIRED`, `TAKEN`, `STOPPED`, `NOT_CONNECTED` as module constants imported from the router, so tests and code share the exact strings. Define `run` as the Redis-resetting `asyncio.run` helper from Task 2.)

Export and deletion tests in `backend/tests/test_me_router.py`:

```python
def test_the_export_lists_telegram_settings_but_not_the_chat_id(client, db_session):
    db_session.add(TelegramLink(user_id=USER_ID, chat_id=987654321, moves_enabled=False))
    db_session.commit()
    body = client.get("/me/export").json()
    assert body["telegram"] == {
        "linked": True, "status": "ok", "digest_enabled": True,
        "moves_enabled": False, "move_threshold_pct": 5.0,
    }
    assert "987654321" not in client.get("/me/export").text


def test_the_export_has_no_telegram_block_when_not_linked(client):
    assert client.get("/me/export").json()["telegram"] is None
```

and extend `test_delete_my_data_wipes_only_the_callers_rows` so it asserts the caller's `telegram_links` row is gone and the other user's remains (`telegram_links` is in `USER_TABLES`, so the loop already deletes it; the seeded rows must not collide on `chat_id`, which `ROW_FACTORIES` already ensures).

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --system-certs pytest tests/test_telegram_webhook.py tests/test_me_router.py -q`
Expected: FAIL (404 on the webhook, `KeyError: 'telegram'`).

- [ ] **Step 3: Implement**

In `backend/app/routers/telegram.py` add the reply constants and the webhook:

```python
import hmac
from typing import Any

from fastapi import Request
from sqlalchemy.exc import IntegrityError

from app import db as app_db

CONNECTED = (
    "Connected. You will get a short message on weekday mornings when there is something to "
    "look at. Send /stop to disconnect."
)
EXPIRED = "That link has expired. Open Account in the app and press Connect Telegram again."
TAKEN = "This chat is already connected to another account."
BARE_START = "Open the app, go to Account and press Connect Telegram."
STOPPED = "Disconnected. You will not get any more messages."
NOT_CONNECTED = (
    "This chat is not connected. If you still get messages, disconnect in the app under Account."
)
UNKNOWN = "I only understand /start and /stop."

webhook_router = APIRouter(tags=["telegram"])


def _secret_ok(received: str | None) -> bool:
    expected = settings.telegram_webhook_secret
    return bool(expected and received and hmac.compare_digest(received, expected))


async def _reply(chat_id: int, text: str) -> None:
    bot = telegram.get_bot()
    if bot is None:
        return
    try:
        await bot.send_message(chat_id, text)
    except telegram.TelegramError as exc:
        logger.warning("Telegram reply failed (%s)", type(exc).__name__)


def _link_chat(user_id: uuid.UUID, chat_id: int) -> bool:
    """False when the chat already belongs to another account (unique chat_id)."""
    with app_db.scoped_session(user_id) as db:
        link = db.query(TelegramLink).filter_by(user_id=user_id).one_or_none()
        if link is None:
            db.add(TelegramLink(user_id=user_id, chat_id=chat_id))
        else:
            link.chat_id, link.status = chat_id, "ok"  # settings are kept
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            return False
    return True


def _unlink(user_id: uuid.UUID) -> None:
    with app_db.scoped_session(user_id) as db:
        db.query(TelegramLink).filter_by(user_id=user_id).delete()
        db.commit()


@webhook_router.post("/telegram/webhook")
async def telegram_webhook(
    request: Request, x_telegram_bot_api_secret_token: str | None = Header(default=None)
) -> dict[str, bool]:
    if not _secret_ok(x_telegram_bot_api_secret_token):
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        update: Any = await request.json()
    except ValueError:
        return {"ok": True}
    message = update.get("message") if isinstance(update, dict) else None
    chat = message.get("chat") if isinstance(message, dict) else None
    text = message.get("text") if isinstance(message, dict) else None
    if not (isinstance(chat, dict) and chat.get("type") == "private" and isinstance(text, str)):
        return {"ok": True}
    chat_id = chat.get("id")
    if not isinstance(chat_id, int):
        return {"ok": True}
    command, _, argument = text.strip().partition(" ")
    command = command.split("@")[0]  # "/start@botname" in some clients
    if command == "/start" and argument.strip():
        user_id = await telegram.consume_link_code(argument.strip())
        if user_id is None:
            await _reply(chat_id, EXPIRED)
        elif await run_in_threadpool(_link_chat, user_id, chat_id):
            await telegram.remember_chat(chat_id, user_id)
            await _reply(chat_id, CONNECTED)
        else:
            await _reply(chat_id, TAKEN)
    elif command == "/start":
        await _reply(chat_id, BARE_START)
    elif command == "/stop":
        user_id = await telegram.user_for_chat(chat_id)
        if user_id is None:
            await _reply(chat_id, NOT_CONNECTED)
        else:
            await run_in_threadpool(_unlink, user_id)
            await telegram.forget_chat(chat_id)
            await _reply(chat_id, STOPPED)
    else:
        await _reply(chat_id, UNKNOWN)
    return {"ok": True}
```

(Add `Header` to the `fastapi` import. Never log `text`, `argument`, the code or the header.) Register `app.include_router(telegram_routes.webhook_router)` in `main.py`.

Export: in `backend/app/schemas.py` add

```python
class TelegramExportOut(BaseModel):
    linked: bool = True
    status: str
    digest_enabled: bool
    moves_enabled: bool
    move_threshold_pct: float
```

and `telegram: TelegramExportOut | None = None` to `ExportOut`. In `routers/me.py` `export_data`, load the user's `TelegramLink` and build `TelegramExportOut(status=..., digest_enabled=..., moves_enabled=..., move_threshold_pct=float(...))` when present (no chat id).

- [ ] **Step 4: Run**

Run: `uv run --system-certs pytest tests/test_telegram_webhook.py tests/test_me_router.py tests/test_routes_require_auth.py -q`, then the full suite, ruff, mypy.
Expected: PASS (the webhook answers 401 without the secret, so the every-route-needs-auth test passes without an exemption).

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat: Telegram webhook to link and unlink chats; the export lists the settings"
```

---

### Task 5: The message and the `notify` step

**Files:**
- Create: `backend/app/notify.py`
- Modify: `backend/app/scheduled.py` (`Summary`, `run_notify`, `COMMANDS`, `daily` wiring), `backend/tests/conftest.py` (flush `telegram:*`)
- Test: `backend/tests/test_notify.py`, `backend/tests/test_scheduled.py`

**Interfaces:**
- Consumes: Tasks 1-2 (`TelegramLink`, `TelegramBot`, `TelegramBlocked`), `jobs.default_ticker_infos`, `market_data.fetch_quote_and_history`.
- Produces:
  - `notify.build_message(new_recs: list[tuple[str, str]], moves: list[tuple[str, float]], app_url: str | None) -> str | None`.
  - `async notify.notify_user(user_id: uuid.UUID, now: datetime, bot: TelegramBot) -> str` returning `"sent" | "skipped" | "blocked" | "failed"`.
  - `Summary.notify_sent`, `Summary.notify_skipped`, `Summary.notify_failures` (and `line()` includes them); `async scheduled.run_notify(summary, now=None)`; command `notify`; `daily` runs it last.
  - `MAX_LISTED = 10` tickers per line, then "+N more".

Message layout (verbatim):

```
3 new: AAPL ADD, MSFT HOLD, NVDA TRIM
Moved: AAPL -6.2%, NVDA +5.4%
Open Today: https://app.example.com/today
Advisory only. Nothing is sent to a broker.
```

(The first line only when there are new recommendations, the second only when there are moves, the third only when `app_url` is set. Moves are sorted by size, biggest first, percentage with one decimal and an explicit sign.)

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_notify.py`:

```python
def test_build_message_full():
    text = notify.build_message(
        [("AAPL", "ADD"), ("MSFT", "HOLD")], [("NVDA", 5.44), ("AAPL", -6.21)], "https://app.example.com/"
    )
    assert text == (
        "2 new: AAPL ADD, MSFT HOLD\n"
        "Moved: AAPL -6.2%, NVDA +5.4%\n"
        "Open Today: https://app.example.com/today\n"
        "Advisory only. Nothing is sent to a broker."
    )


def test_build_message_parts_are_optional_and_nothing_means_none():
    assert notify.build_message([], [], "https://x") is None
    only_moves = notify.build_message([], [("AAPL", -7.0)], None)
    assert only_moves == "Moved: AAPL -7.0%\nAdvisory only. Nothing is sent to a broker."


def test_long_lists_are_cut():
    recs = [(f"T{i}", "ADD") for i in range(13)]
    text = notify.build_message(recs, [], None)
    assert text.splitlines()[0].endswith("+3 more") and "T9 ADD" in text and "T10 ADD" not in text
```

DB-backed tests in the same file (the `env` fixture is the one in `tests/test_scheduled.py`: an owner session with the restricted runtime role patched into `app.db.SessionLocal`; copy it):

```python
import asyncio
import logging
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

import app.redis_client as redis_client_module
from app import notify
from app.models import Holding, Recommendation, TelegramLink, WatchlistItem
from app.redis_client import get_redis
from app.telegram import TelegramBlocked, TelegramError
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user

MONDAY = datetime(2026, 10, 5, 6, 0, tzinfo=UTC)
FOOT = "Advisory only. Nothing is sent to a broker."


class FakeBot:
    def __init__(self, error=None):
        self.sent, self.error = [], error

    async def send_message(self, chat_id, text):
        if self.error:
            raise self.error
        self.sent.append((chat_id, text))


@pytest.fixture()
def env(session_local, app_session_local):
    with patch("app.db.SessionLocal", app_session_local), session_local() as owner:
        yield owner


def _arun(coro):
    try:
        return asyncio.run(coro)
    finally:
        redis_client_module._redis = None  # each asyncio.run is its own event loop


def _user(db, user_id=USER_ID, chat_id=1001, user_status="active", **link):
    add_app_user(db, user_id, status=user_status)
    db.add(TelegramLink(user_id=user_id, chat_id=chat_id, **link))
    db.commit()


def _hold(db, user_id, ticker):
    db.add(
        Holding(
            user_id=user_id, ticker=ticker, name=ticker, asset_type="STOCK", shares=5,
            cost_basis=100.0, first_purchase_date=date(2024, 1, 1),
        )
    )
    db.commit()


def _rec(db, user_id, ticker, action="ADD", source="scheduled", status="PENDING", days_old=0):
    created = MONDAY.replace(tzinfo=None) - timedelta(days=days_old)
    db.add(
        Recommendation(
            user_id=user_id, ticker=ticker, asset_type="STOCK", action=action, reasoning=["x"],
            source=source, status=status, created_at=created,
        )
    )
    db.commit()


def _quotes(closes_by_ticker):
    async def fetch(ticker):
        closes = closes_by_ticker[ticker]  # an unknown ticker raises KeyError: a failing lookup
        return {"price": closes[-1] if closes else None, "closes": closes}

    return AsyncMock(side_effect=fetch)


def _notify(user_id=USER_ID, bot=None, quotes=None, now=MONDAY):
    bot = bot or FakeBot()
    with patch("app.notify.fetch_quote_and_history", quotes or _quotes({})):
        return _arun(notify.notify_user(user_id, now, bot)), bot


def _seed_day(db, user_id=USER_ID):
    _hold(db, user_id, "AAPL")
    _hold(db, user_id, "NVDA")
    _rec(db, user_id, "MSFT")                         # today, scheduled, pending: listed
    _rec(db, user_id, "AAPL", days_old=3)             # an older day: not today's
    _rec(db, user_id, "NVDA", source="manual")        # manual: not listed
    _rec(db, user_id, "TSLA", status="APPROVED")      # decided: not listed


QUOTES = {"AAPL": [100.0, 94.0], "NVDA": [100.0, 101.0]}


def test_a_linked_user_gets_todays_scheduled_calls_and_the_big_movers(env):
    _user(env)
    _seed_day(env)
    outcome, bot = _notify(quotes=_quotes(QUOTES))
    assert outcome == "sent"
    assert bot.sent == [(1001, f"1 new: MSFT ADD\nMoved: AAPL -6.0%\n{FOOT}")]


def test_digest_off_keeps_only_the_moves(env):
    _user(env, digest_enabled=False)
    _seed_day(env)
    _, bot = _notify(quotes=_quotes(QUOTES))
    assert bot.sent == [(1001, f"Moved: AAPL -6.0%\n{FOOT}")]


def test_moves_off_keeps_only_the_digest(env):
    _user(env, moves_enabled=False)
    _seed_day(env)
    _, bot = _notify(quotes=_quotes(QUOTES))
    assert bot.sent == [(1001, f"1 new: MSFT ADD\n{FOOT}")]


def test_nothing_to_say_sends_nothing_and_sets_no_marker(env):
    _user(env)
    _hold(env, USER_ID, "NVDA")
    outcome, bot = _notify(quotes=_quotes({"NVDA": [100.0, 101.0]}))
    assert (outcome, bot.sent) == ("skipped", [])
    assert _arun(get_redis().exists(f"telegram:sent:{USER_ID}:2026-10-05")) == 0


def test_a_second_run_the_same_day_sends_nothing(env):
    _user(env)
    _seed_day(env)
    first, bot = _notify(quotes=_quotes(QUOTES))
    second, _ = _notify(bot=bot, quotes=_quotes(QUOTES))
    assert (first, second, len(bot.sent)) == ("sent", "skipped", 1)


def test_a_failed_send_clears_the_marker_so_a_retry_can_send(env):
    _user(env)
    _seed_day(env)
    outcome, _ = _notify(bot=FakeBot(TelegramError("x")), quotes=_quotes(QUOTES))
    assert outcome == "failed"
    retry, bot = _notify(quotes=_quotes(QUOTES))
    assert (retry, len(bot.sent)) == ("sent", 1)


def test_a_blocked_chat_is_marked_blocked_and_not_tried_again(env):
    _user(env)
    _seed_day(env)
    outcome, _ = _notify(bot=FakeBot(TelegramBlocked("x")), quotes=_quotes(QUOTES))
    assert outcome == "blocked"
    env.expire_all()
    assert env.query(TelegramLink).one().status == "blocked"
    again, bot = _notify(quotes=_quotes(QUOTES))
    assert (again, bot.sent) == ("skipped", [])


def test_a_user_without_a_link_gets_nothing(env):
    add_app_user(env, USER_ID)
    _seed_day(env)
    outcome, bot = _notify(quotes=_quotes(QUOTES))
    assert (outcome, bot.sent) == ("skipped", [])


def test_a_blocked_link_gets_nothing(env):
    _user(env, status="blocked")
    _seed_day(env)
    outcome, bot = _notify(quotes=_quotes(QUOTES))
    assert (outcome, bot.sent) == ("skipped", [])


def test_a_disabled_user_gets_nothing(env):
    _user(env, user_status="disabled")
    _seed_day(env)
    outcome, bot = _notify(quotes=_quotes(QUOTES))
    assert (outcome, bot.sent) == ("skipped", [])


def test_failing_quotes_still_send_the_digest(env):
    _user(env)
    _seed_day(env)
    outcome, bot = _notify(quotes=AsyncMock(side_effect=RuntimeError("yahoo down")))
    assert (outcome, bot.sent) == ("sent", [(1001, f"1 new: MSFT ADD\n{FOOT}")])


def test_one_users_message_never_contains_another_users_tickers(env):
    _user(env, USER_ID, 1001)
    _user(env, OTHER_USER_ID, 1002)
    _rec(env, USER_ID, "MSFT")
    _rec(env, OTHER_USER_ID, "TSLA")
    _hold(env, OTHER_USER_ID, "NVDA")
    _, bot = _notify(USER_ID, quotes=_quotes({"NVDA": [100.0, 80.0]}))
    text = bot.sent[0][1]
    assert "MSFT" in text and "TSLA" not in text and "NVDA" not in text


def test_the_threshold_is_the_users_own(env):
    _user(env, USER_ID, 1001, move_threshold_pct=5.0)
    _user(env, OTHER_USER_ID, 1002, move_threshold_pct=10.0)
    for uid in (USER_ID, OTHER_USER_ID):
        _hold(env, uid, "AAPL")
    quotes = _quotes({"AAPL": [100.0, 94.0]})
    assert _notify(USER_ID, quotes=quotes)[0] == "sent"
    assert _notify(OTHER_USER_ID, quotes=quotes)[0] == "skipped"


@pytest.mark.parametrize("closes", [[], [100.0], [0.0, 5.0]])
def test_short_or_zero_history_is_ignored(env, closes):
    _user(env)
    _hold(env, USER_ID, "AAPL")
    outcome, _ = _notify(quotes=_quotes({"AAPL": closes}))
    assert outcome == "skipped"


def test_open_holdings_and_the_watchlist_are_both_checked_for_moves(env):
    _user(env)
    env.add(WatchlistItem(user_id=USER_ID, ticker="NVDA", asset_type="STOCK"))
    _hold(env, USER_ID, "AAPL")
    env.commit()
    _, bot = _notify(quotes=_quotes({"AAPL": [100.0, 94.0], "NVDA": [100.0, 70.0]}))
    assert bot.sent == [(1001, f"Moved: NVDA -30.0%, AAPL -6.0%\n{FOOT}")]


def test_a_closed_position_is_not_checked(env):
    _user(env)
    env.add(
        Holding(
            user_id=USER_ID, ticker="OLD", name="OLD", asset_type="STOCK", shares=0,
            cost_basis=100.0, first_purchase_date=date(2024, 1, 1),
        )
    )
    env.commit()
    outcome, _ = _notify(quotes=_quotes({"OLD": [100.0, 50.0]}))
    assert outcome == "skipped"
```

In `backend/tests/test_scheduled.py` add (reusing its `env` fixture, `MONDAY`, `_arun`-style helpers and `add_app_user`; import `TelegramLink`, `TelegramError`):

```python
SATURDAY = datetime(2026, 10, 10, 6, 0, tzinfo=UTC)


class _Bot:
    def __init__(self, fail_chats=()):
        self.sent, self.fail_chats = [], set(fail_chats)

    async def send_message(self, chat_id, text):
        if chat_id in self.fail_chats:
            raise TelegramError("x")
        self.sent.append(chat_id)


def _linked(db, user_id, chat_id, ticker):
    add_app_user(db, user_id)
    db.add(TelegramLink(user_id=user_id, chat_id=chat_id))
    db.add(
        Recommendation(
            user_id=user_id, ticker=ticker, asset_type="STOCK", action="ADD", reasoning=["x"],
            source="scheduled", created_at=MONDAY.replace(tzinfo=None),
        )
    )
    db.commit()


def _run_notify(bot, now=MONDAY):
    summary = scheduled.Summary()
    with patch("app.telegram.get_bot", return_value=bot):
        asyncio.run(scheduled.run_notify(summary, now=now))
    redis_client_module._redis = None
    return summary


def test_run_notify_counts_sends_and_failures(env):
    _linked(env, USER_ID, 1001, "MSFT")
    _linked(env, OTHER_USER_ID, 1002, "TSLA")
    summary = _run_notify(_Bot(fail_chats={1002}))
    assert (summary.notify_sent, summary.notify_failures, summary.notify_skipped) == (1, 1, 0)


def test_notify_failures_never_change_the_exit_code(env):
    _linked(env, USER_ID, 1001, "MSFT")
    with patch("app.telegram.get_bot", return_value=_Bot(fail_chats={1001})), patch(
        "app.scheduled.datetime"
    ) as clock:
        clock.now.return_value = MONDAY
        assert _arun(scheduled.run_command("notify")) == 0


def test_notify_does_nothing_at_the_weekend(env):
    _linked(env, USER_ID, 1001, "MSFT")
    bot = _Bot()
    summary = _run_notify(bot, now=SATURDAY)
    assert (bot.sent, summary.notify_sent) == ([], 0)


def test_notify_does_nothing_without_a_bot(env):
    _linked(env, USER_ID, 1001, "MSFT")
    summary = scheduled.Summary()
    with patch("app.telegram.get_bot", return_value=None):
        asyncio.run(scheduled.run_notify(summary, now=MONDAY))
    redis_client_module._redis = None
    assert (summary.notify_sent, summary.notify_failures, summary.notify_skipped) == (0, 0, 0)
```

Also update `test_daily_runs_snapshots_then_outcomes_then_analysis` to patch `app.scheduled.run_notify` too and assert the order `["snapshots", "outcomes", "analysis", "notify"]`, and the `Summary.line()` assertion for the new counters.

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --system-certs pytest tests/test_notify.py tests/test_scheduled.py -q`
Expected: FAIL (`ModuleNotFoundError: app.notify`).

- [ ] **Step 3: Implement `backend/app/notify.py`**

```python
"""The morning Telegram message: new automatic recommendations plus tickers that moved a lot.

Each message is built inside the person's own scoped session and contains only tickers, actions and
percentages. A per-person per-day marker keeps a re-run from sending a second message.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from app import db as app_db
from app.agents.jobs import default_ticker_infos
from app.agents.market_data import fetch_quote_and_history
from app.config import settings
from app.models import AppUser, Recommendation, TelegramLink
from app.redis_client import get_redis
from app.telegram import TelegramBlocked, TelegramBot, TelegramError

logger = logging.getLogger(__name__)

MAX_LISTED = 10
MARKER_SECONDS = 90000  # outlives the UTC day so a late retry cannot send twice
QUOTE_CONCURRENCY = 5
FOOTER = "Advisory only. Nothing is sent to a broker."


def _listed(items: list[str]) -> str:
    shown = ", ".join(items[:MAX_LISTED])
    return shown + (f", +{len(items) - MAX_LISTED} more" if len(items) > MAX_LISTED else "")


def build_message(
    new_recs: list[tuple[str, str]], moves: list[tuple[str, float]], app_url: str | None
) -> str | None:
    lines: list[str] = []
    if new_recs:
        lines.append(f"{len(new_recs)} new: {_listed([f'{t} {a}' for t, a in new_recs])}")
    if moves:
        ordered = sorted(moves, key=lambda m: abs(m[1]), reverse=True)
        lines.append("Moved: " + _listed([f"{t} {c:+.1f}%" for t, c in ordered]))
    if not lines:
        return None
    if app_url:
        lines.append(f"Open Today: {app_url.rstrip('/')}/today")
    lines.append(FOOTER)
    return "\n".join(lines)


async def _moves(tickers: list[str], threshold: float) -> list[tuple[str, float]]:
    semaphore = asyncio.Semaphore(QUOTE_CONCURRENCY)

    async def one(ticker: str) -> tuple[str, float] | None:
        async with semaphore:
            try:
                closes = (await fetch_quote_and_history(ticker)).get("closes") or []
            except Exception as exc:  # a failing lookup only drops that ticker from the message
                logger.warning("Notify: quote failed for %s (%s)", ticker, type(exc).__name__)
                return None
        if len(closes) < 2 or not closes[-2]:
            return None
        change = (closes[-1] - closes[-2]) / closes[-2] * 100
        return (ticker, change) if abs(change) >= threshold else None

    found = await asyncio.gather(*(one(t) for t in dict.fromkeys(tickers)))
    return [m for m in found if m is not None]


async def notify_user(user_id: uuid.UUID, now: datetime, bot: TelegramBot) -> str:
    """"sent" | "skipped" | "blocked" | "failed". The chat id and the message exist only here."""
    today = datetime(now.year, now.month, now.day)  # naive UTC, like created_at
    with app_db.scoped_session(user_id) as db:
        link = db.query(TelegramLink).filter_by(user_id=user_id).one_or_none()
        user = db.get(AppUser, user_id)
        if link is None or link.status != "ok" or user is None or user.status != "active":
            return "skipped"
        chat_id, digest, moves_on = link.chat_id, link.digest_enabled, link.moves_enabled
        threshold = float(link.move_threshold_pct)
        new_recs: list[tuple[str, str]] = []
        if digest:
            rows = (
                db.query(Recommendation.ticker, Recommendation.action)
                .filter(
                    Recommendation.user_id == user_id,
                    Recommendation.source == "scheduled",
                    Recommendation.status == "PENDING",
                    Recommendation.created_at >= today,
                )
                .order_by(Recommendation.id)
                .all()
            )
            new_recs = [(t, a) for t, a in rows]
        tickers = (
            [i["ticker"] for i in default_ticker_infos(db, user_id, open_only=True)]
            if moves_on
            else []
        )
    moved = await _moves(tickers, threshold) if tickers else []
    text = build_message(new_recs, moved, settings.app_url)
    if text is None:
        return "skipped"
    marker = f"telegram:sent:{user_id}:{now.strftime('%Y-%m-%d')}"
    redis = get_redis()
    if not await redis.set(marker, "1", nx=True, ex=MARKER_SECONDS):
        return "skipped"
    try:
        await bot.send_message(chat_id, text)
    except TelegramBlocked:
        await redis.delete(marker)
        with app_db.scoped_session(user_id) as db:
            db.query(TelegramLink).filter_by(user_id=user_id).update({"status": "blocked"})
            db.commit()
        return "blocked"
    except TelegramError:
        await redis.delete(marker)  # nothing was delivered, so a retry may still send
        return "failed"
    return "sent"
```

`backend/app/scheduled.py`: add `notify_sent`, `notify_skipped`, `notify_failures` to `Summary` and `line()`; add

```python
async def run_notify(summary: Summary, now: datetime | None = None) -> None:
    """Weekday Telegram messages. Never raises and never changes the exit code: a Telegram problem
    is counted and logged by user id and class name only."""
    now = now or datetime.now(UTC)
    if now.weekday() >= 5:
        logger.info("Notify: weekend, nothing to do")
        return
    bot = telegram.get_bot()
    if bot is None:
        logger.info("Notify: Telegram is not set up, nothing to do")
        return
    for user_id in active_user_ids():
        try:
            outcome = await notify_user(user_id, now, bot)
        except Exception as exc:
            summary.notify_failures += 1
            logger.warning("Notify failed for user %s: %s", user_id, type(exc).__name__)
            continue
        if outcome == "sent":
            summary.notify_sent += 1
        elif outcome == "failed":
            summary.notify_failures += 1
        else:  # skipped, or blocked (the link is now marked and not retried)
            summary.notify_skipped += 1
        logger.info("Notify user %s: %s", user_id, outcome)
```

Add `"notify"` to `COMMANDS`, call `await run_notify(summary)` last in `run_command` for `daily` and `notify`, and leave the exit-code expression as it is (notify counters are not in it). Add `telegram:*` to the Redis flush patterns in `tests/conftest.py`.

- [ ] **Step 4: Run**

Run: `uv run --system-certs pytest tests/test_notify.py tests/test_scheduled.py -q`, then the full suite, ruff, mypy.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat: weekday Telegram message with new recommendations and big movers"
```

---

### Task 6: Docs

**Files:** `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `PRODUCT.md`, `backend/.env.example` (verify)

- [ ] **Step 1: ARCHITECTURE.md** — data model (`telegram_links`), API (the four `/me/telegram` routes and `POST /telegram/webhook` with its header secret and 401 behaviour), the `notify` step in §12 (weekdays, per user, marker, counters, never changes the exit code), configuration (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, `APP_URL`), the Redis keys (`telegram:link:*`, `telegram:chat:*`, `telegram:sent:*`) and why `/stop` uses the chat mapping (row-level security hides links from a request without a user).
- [ ] **Step 2: RUNBOOK.md** — a Telegram section: create the bot with BotFather (`/newbot`), set the four values as Fly secrets (generate the webhook secret with `openssl rand -hex 32`; never paste secrets into chat or commits), register the webhook once with `python -m app.telegram set-webhook https://<api host>/telegram/webhook`, a post-deploy checklist (connect from Account, `/start` works, the weekday message arrives, `/stop` works), what the counters mean, what `blocked` means and that reconnecting resets it, rotating the token (BotFather `/revoke`, new secret, re-run set-webhook) and the privacy note (the bot operator can read messages people send to the bot; the app never logs message content).
- [ ] **Step 3: PRODUCT.md** — notifications are now built (replace the "Not yet built" sentence for the notification channel).
- [ ] **Step 4: Commit**

```bash
git add docs PRODUCT.md backend/.env.example
git commit -m "docs: Telegram notifications in the architecture notes, the runbook and the product record"
```

---

### Task 7: STOP — design the Account Telegram panel (huashu-design + impeccable)

The backend (Tasks 1-6) is complete and can be pushed on its own. No frontend code is written until this task is finished and the user has picked a direction.

**Files:**
- Create: `docs/design/telegram/` (draft HTML and screenshots, kept as the design reference once chosen)
- Create: `direction-approved.md` in that folder

- [ ] **Step 1: Run the design skills** — invoke `huashu-design` (three real HTML directions with screenshots, using `docs/design/claude-keys/base.css` and `shell.js`, which carry the app's tokens) and `impeccable` (shape, then critique and polish of the chosen one). Each direction covers, in dark and light and at phone width: the Account **Telegram panel** in its states: not connected (the "Connect Telegram" button and the note), waiting after pressing it (the link opened, "Waiting for you to press Start in Telegram…", a way to open the link again), connected (the two switches "Morning digest" and "Price moves", the threshold field with its 1 to 50 bounds, "Disconnect"), connected with `blocked` ("Telegram stopped receiving messages. Reconnect to get them again."), and not set up on this server (the panel hidden or a plain "Not available"). Also one sample **Telegram message** as it looks in a phone chat. Use the spec's copy; no emoji, no Buy/Sell wording, no amounts.
- [ ] **Step 2: Present and stop** — show the three directions and wait for the user's choice or mix. Do not start Task 8 until they answer.
- [ ] **Step 3: Record the decision** — write `direction-approved.md`, fill Part 2 below with the chosen structure and commit both.

---

## Part 2 — Frontend (design picked: direction C, settings beside a live preview)

The user picked direction C on 2026-10-07 (after an alignment fix). The decision and the rules that come with it are in `docs/design/telegram/direction-approved.md`; the drafts to match are `docs/design/telegram/c-live-preview.html` (with `tg.js`, `tg.css`) and `shots/c-*`. Copy is verbatim from `tg.js` (NOTE, PITCH, BLOCKED and the panel texts).

Each task follows the same rhythm (failing Vitest test, run, implement, run, `eslint` / `tsc` / full suite / build, commit) and uses the existing `useAction`, SWR, `apiFetch`, MUI components and design tokens. The Account page already mounts `ClaudeKeyPanel`; follow its structure and tests.

### Task 8: Types and the `useTelegram` hook

**Files:** `frontend/lib/telegram.ts` (+ test).

Types: `TelegramStatus { configured: boolean; linked: boolean; status: "ok" | "blocked" | null; digest_enabled: boolean; moves_enabled: boolean; move_threshold_pct: number; bot_username: string | null }` and `TelegramLink { url: string; expires_in: number }`.

Behaviour to test: `useTelegram()` returns `{status, connect(), update(patch), disconnect(), isLoading, error}` from `GET /me/telegram`; `connect()` calls `POST /me/telegram/link` and returns `{url, expires_in}` without storing the code; `update` sends only the changed fields with `PATCH` and revalidates; `disconnect` sends `DELETE` and revalidates; while "waiting" (after `connect`, until `linked` or the code's lifetime has passed) the status is re-fetched every 3 seconds, and polling stops when linked, on unmount, or after `expires_in`.

### Task 9: The Telegram panel on Account

**Files:** `frontend/components/account/TelegramPanel.tsx` (+ test), mounted in the Account page (and its page test).

Design C: two cards in one row on desktop (the settings card and the "What a message looks like" preview card, equal tops and heights), the preview first on a phone; the preview is static sample data and is hidden when Telegram is not configured. The settings change on toggle or on blur of the threshold field (no Save button); the threshold shows a % suffix and the hint "1 to 50".

Behaviour to test (copy and structure from the chosen direction): not configured shows only the title and "Telegram is not available on this server." (no preview card); not connected shows the note and "Connect Telegram", which opens the returned link in a new tab (`rel="noopener noreferrer"`) and shows the waiting state; connected shows the two switches and the threshold (bounds 1 to 50, one decimal, saved on change or blur as the design says) and "Disconnect" with a confirmation; `blocked` shows the reconnect message and the Connect button; a failed save shows the error and rolls the control back; nothing in the panel shows a chat id.

---

### Task 10: Final review, security review and the pull request

- [ ] **Step 1:** Run all checks: backend `uv run --system-certs ruff check . && uv run --system-certs mypy app && uv run --system-certs pytest -q`; frontend `npx eslint . && npx tsc --noEmit && npx vitest run && npm run build`.
- [ ] **Step 2:** Dispatch the `security-reviewer` subagent on `git diff master...HEAD` with this brief: the bot token and webhook secret never reach a log, response or exception (including through httpx exception text); the webhook rejects everything without the secret header (constant-time compare, unset secret rejected), handles private chats only, never logs message text or link codes, and cannot be made to link or unlink another person's chat; link codes are unguessable, single-use (atomic GETDEL) and expire; one chat cannot belong to two accounts and a refused link spends the code; each message is built inside that user's `scoped_session` and contains only tickers, actions and percentages; the per-user per-day marker prevents duplicate messages and a failed send clears it; a blocked chat is not retried; `/me/telegram` routes only touch the caller's row (row-level security with the runtime role), the response never contains the chat id, link creation is rate limited; the Redis chat mapping and codes cannot be used to learn about other users; deleting data or the account removes the link; a Telegram outage cannot change the job's exit code or block the analysis; the migration's grants and policy; no path can place a trade.
- [ ] **Step 3:** Fix every finding it confirms in one pass, re-run the checks, push the branch and open the pull request. In the description list the owner steps: create the bot with BotFather, set the four secrets on Fly before merging (the routes answer 503 and the step does nothing without them, so merging first is safe), run `python -m app.telegram set-webhook <url>` after the deploy, and follow the RUNBOOK checklist.
