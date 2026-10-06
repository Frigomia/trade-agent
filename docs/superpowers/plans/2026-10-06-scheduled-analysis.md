# Scheduled analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person who opts in finds their recommendations already on Today each weekday morning, without pressing Run analysis, on their own Claude key and within their monthly run limit.

**Architecture:** A third step in the existing `python -m app.scheduled daily` command (after snapshots and outcomes). For each active user with `auto_analysis` on, inside their own RLS-scoped session, it resolves that user's own Claude client (`resolve_client`), checks the monthly run limit, drops tickers that already have a fresh pending call, counts one run, and reuses the manual pipeline (`create_job` + `run_job`) with `source="scheduled"`. Failures are per user and never stop the others. Shared decisions (is the user paused, which tickers to skip) live in one module that the Preferences API also uses to show "paused" reasons.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic (hand-written migration), Redis counters, pytest; Next.js 16, MUI 9, SWR, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-scheduled-analysis-design.md` (depends on `docs/superpowers/specs/2026-10-06-user-claude-keys-design.md`, merged).

## Global Constraints

- The system never places a trade. Nothing here calls a broker; a scheduled run only creates PENDING recommendations.
- Cadence: once each weekday (Monday-Friday, UTC), opt-in per user, **off by default**.
- Cost: one automatic run counts as **one** run against the user's monthly `analysis_run` limit.
- Whose key: the user's own Claude key (`claude_keys.resolve_client`). An admin without a personal key uses the server key (`client=None`); a user with no usable key is **skipped** (counted as skipped, not as a failure). `client=None` must never be passed for a non-admin.
- A ticker that has a PENDING call **younger than 3 days** is skipped; with 3 days or older it is analyzed again and the old call becomes `SUPERSEDED` (the existing behaviour of `app/agents/jobs.py::_process_ticker`, no new code for this).
- Nothing left to analyze: stop without counting a run.
- A failure for one user is caught, logged by user id and exception class name only, counted, and the other users still run. The command exits non-zero when any user failed. The new summary counters are `analysis_runs`, `analysis_skipped`, `analysis_failures`.
- The decrypted key lives only inside the `Anthropic` client for that user's iteration: never logged, never in Redis or job state, never in a module global.
- Hand-written migration only (a new file; generated or existing migrations are never edited). Alembic head before this work: `f4a1c8d27b90`.
- Frontend copy (verbatim from the spec): switch label "Analyze my portfolio automatically each weekday"; line under it "Runs once each weekday morning and counts as one run of your monthly limit."; paused: "Paused: you have used all N runs this month. It resumes on <date>." and "Paused: connect your Claude key to turn this on."; tag "Automatic". No emoji, no Buy/Sell wording.
- Conventional Commits; never skip hooks or GPG signing; branch `feature/scheduled-analysis`.

## Review Focus

Failure modes the spec implies that no single task's happy path exercises (each is pinned by a test in the task named in brackets):

1. **Same-day re-run** (a manual `workflow_dispatch` after the cron): every ticker now has a fresh pending call, so the second run skips everyone and counts no extra run. [Task 4]
2. **One user's key is revoked or undecryptable mid-run**: that user is flagged and counted as a failure, the other users still run, the exit code is non-zero, and no key text appears in logs. [Task 4]
3. **A slow run must not hang the job**: a global time budget; users not reached are counted as skipped and logged. [Task 4]
4. **Empty portfolio and watchlist**, or only closed positions (`shares == 0`): skipped, no run counted. [Task 4]
5. **Not-active users** (invited, disabled) never run even if `auto_analysis` is on. [Task 4]
6. **Weekend**: the step does nothing and says so in the log. [Task 4]
7. **Limit boundary**: a user with exactly `limit - 1` runs used runs once; with `limit` used is skipped and shown as paused with the resume date. [Tasks 3, 4, 5]

---

## File Structure

- Create `backend/migrations/versions/b3d9e5a17c42_add_auto_analysis_and_source.py` — the two new columns.
- Modify `backend/app/models.py` — `InvestmentPreferences.auto_analysis`, `Recommendation.source`.
- Modify `backend/app/schemas.py` — `RecommendationOut.source`; `PreferencesIn/Out.auto_analysis`; `AutoAnalysisPaused`.
- Modify `backend/app/agents/jobs.py` — `source` parameter; `default_ticker_infos` moved here from the router.
- Modify `backend/app/routers/analysis.py` — use `default_ticker_infos`.
- Modify `backend/app/claude_keys.py` — `has_usable_key`.
- Create `backend/app/auto_analysis.py` — `STALE_AFTER`, `fresh_pending_tickers`, `next_month_start`, `Pause`, `pause_state`.
- Modify `backend/app/scheduled.py` — `run_analysis`, new `Summary` fields, command wiring, exit code.
- Modify `backend/app/routers/preferences.py` — accept and report `auto_analysis`.
- Tests: `backend/tests/test_auto_analysis.py` (new), plus edits to `test_scheduled.py`, `test_agents_jobs.py`, `test_preferences_router.py`, `test_analysis_router.py`, `test_user_api_keys_migration.py`, `test_models.py`.
- Docs/CI: `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `.github/workflows/scheduled-jobs.yml`.
- Frontend (Part 2): `frontend/lib/preferences.ts`, `frontend/lib/api/recommendation-types.ts`, the Preferences page and form, `frontend/components/recommendations/RecommendationCard.tsx` and the Today page.

---

## Part 1 — Backend

### Task 1: The two columns (migration, models, schema)

**Files:**
- Create: `backend/migrations/versions/b3d9e5a17c42_add_auto_analysis_and_source.py`
- Modify: `backend/app/models.py` (`InvestmentPreferences` ~line 115, `Recommendation` ~line 62; import `Boolean`, `expression`)
- Modify: `backend/app/schemas.py` (`RecommendationOut` ~line 81)
- Modify: `backend/tests/test_user_api_keys_migration.py:9-17` (its `heads == [migration.revision]` assertion breaks once a newer head exists)
- Test: `backend/tests/test_models.py`, new `backend/tests/test_auto_analysis_migration.py`

**Interfaces:**
- Produces: `InvestmentPreferences.auto_analysis: bool` (default false); `Recommendation.source: str` (`"manual"` | `"scheduled"`, default `"manual"`); `RecommendationOut.source: str = "manual"`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_auto_analysis_migration.py`:

```python
import importlib.util
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parent.parent


def _migration():
    path = next((BACKEND / "migrations" / "versions").glob("*_add_auto_analysis_and_source.py"))
    spec = importlib.util.spec_from_file_location("add_auto_analysis_and_source", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_is_the_single_head_on_top_of_the_api_keys_revision():
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()

    migration = _migration()
    assert heads == [migration.revision]
    assert migration.down_revision == "f4a1c8d27b90"
```

Append to `backend/tests/test_models.py` (use that file's existing session fixture and imports; add `InvestmentPreferences` to its model imports):

```python
def test_auto_analysis_is_off_and_a_recommendation_is_manual_unless_said_otherwise(session):
    pref = InvestmentPreferences(user_id=uuid.uuid4())
    rec = Recommendation(
        user_id=uuid.uuid4(), ticker="AAPL", asset_type="STOCK", action="BUY", reasoning=["x"]
    )
    session.add_all([pref, rec])
    session.commit()
    session.refresh(pref)
    session.refresh(rec)
    assert pref.auto_analysis is False
    assert rec.source == "manual"
```

Edit `backend/tests/test_user_api_keys_migration.py` so the head test no longer pins that revision as the head: replace the final assertion block of `test_the_migration_is_the_single_head_after_the_api_role_revoke` with

```python
    assert len(heads) == 1
    migration = _migration()
    assert migration.down_revision == "a7c3e91d5b20"
```

(and drop the now-unused `heads == [migration.revision]` line).

- [ ] **Step 2: Run to verify they fail**

Run (from `backend/`): `uv run --native-tls pytest tests/test_auto_analysis_migration.py tests/test_models.py -q`
Expected: FAIL (`StopIteration` / `AttributeError: auto_analysis`).

- [ ] **Step 3: Write the migration**

`backend/migrations/versions/b3d9e5a17c42_add_auto_analysis_and_source.py`:

```python
"""add investment_preferences.auto_analysis and recommendations.source

Revision ID: b3d9e5a17c42
Revises: f4a1c8d27b90
Create Date: 2026-10-06 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b3d9e5a17c42'
down_revision: Union[str, Sequence[str], None] = 'f4a1c8d27b90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing rows get the defaults, so nothing changes for anyone until they opt in.
    op.add_column(
        "investment_preferences",
        sa.Column("auto_analysis", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "recommendations",
        sa.Column("source", sa.String(length=10), nullable=False, server_default="manual"),
    )


def downgrade() -> None:
    op.drop_column("recommendations", "source")
    op.drop_column("investment_preferences", "auto_analysis")
```

No grant changes are needed: both tables already have table-level grants for the runtime role.

- [ ] **Step 4: Models and schema**

`backend/app/models.py`: add `Boolean` to the `sqlalchemy` import and `from sqlalchemy.sql import expression`. In `InvestmentPreferences` add after `notes`:

```python
    # Opt-in weekday analysis (see app/scheduled.py); off until the user turns it on.
    auto_analysis: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=expression.false()
    )
```

In `Recommendation` add after `status`:

```python
    # "manual" (Run analysis) | "scheduled" (the weekday job); shown as an Automatic tag on Today.
    source: Mapped[str] = mapped_column(String(10), default="manual", server_default="manual")
```

`backend/app/schemas.py`, in `RecommendationOut` after `status: str`:

```python
    source: str = "manual"
```

- [ ] **Step 5: Apply and run**

Run: `uv run --native-tls alembic upgrade head` (local DB, localhost only), then `uv run --native-tls pytest tests/test_auto_analysis_migration.py tests/test_models.py tests/test_user_api_keys_migration.py -q`
Expected: PASS. Then the full suite: `uv run --native-tls pytest -q` (the schema-vs-models comparison tests must stay green).

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/versions/b3d9e5a17c42_add_auto_analysis_and_source.py backend/app/models.py backend/app/schemas.py backend/tests
git commit -m "feat: auto_analysis preference and recommendation source columns"
```

---

### Task 2: `source` through the pipeline, and the default ticker list in `jobs.py`

**Files:**
- Modify: `backend/app/agents/jobs.py` (`_process_ticker`, `run_job`, new `default_ticker_infos`)
- Modify: `backend/app/routers/analysis.py:75-110` (`_build_ticker_infos` else-branch)
- Test: `backend/tests/test_agents_jobs.py`, `backend/tests/test_analysis_router.py`

**Interfaces:**
- Consumes: Task 1's `Recommendation.source`.
- Produces:
  - `run_job(job_id, user_id, tickers, client=None, source="manual")` and `_process_ticker(job_id, user_id, ticker_info, semaphore, client=None, source="manual")`; a new recommendation row gets `source=source`.
  - `default_ticker_infos(db: Session, user_id: uuid.UUID, *, open_only: bool = False) -> list[dict[str, Any]]` in `app/agents/jobs.py`: every holding (or only holdings with `shares > 0` when `open_only`) followed by the watchlist, each `{"ticker", "asset_type", "is_held"}`, capped at `MAX_RUN_TICKERS` (move that constant to `jobs.py` and import it back into the router so there is one definition).

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_agents_jobs.py` add (the file already defines `FAKE_STATE_BUY`; add `from datetime import date`, `from app.agents.jobs import default_ticker_infos` and `Holding, WatchlistItem` to its imports):

```python
def _run_one_ticker(app_session_local, source=None):
    async def _run() -> None:
        tickers = [{"ticker": "AAPL", "asset_type": "STOCK", "is_held": False}]
        job_id = await create_job(OTHER_USER_ID, tickers)
        extra = {} if source is None else {"source": source}
        with (
            patch("app.agents.jobs.run_graph_for_ticker", AsyncMock(return_value=FAKE_STATE_BUY)),
            patch("app.db.SessionLocal", app_session_local),
        ):
            await run_job(job_id, OTHER_USER_ID, tickers, **extra)

    asyncio.run(_run())


def test_a_scheduled_run_stores_its_recommendations_as_scheduled(session_local, app_session_local):
    _run_one_ticker(app_session_local, source="scheduled")
    with session_local() as db:
        assert db.query(Recommendation).filter_by(user_id=OTHER_USER_ID).one().source == "scheduled"


def test_a_manual_run_stores_manual(session_local, app_session_local):
    _run_one_ticker(app_session_local)
    with session_local() as db:
        assert db.query(Recommendation).filter_by(user_id=OTHER_USER_ID).one().source == "manual"


def test_default_ticker_infos_lists_open_holdings_then_the_watchlist(session_local):
    with session_local() as db:
        for ticker, shares in (("AAPL", 5), ("OLD", 0)):
            db.add(
                Holding(
                    user_id=USER_ID, ticker=ticker, name=ticker, asset_type="STOCK",
                    shares=shares, cost_basis=100.0, first_purchase_date=date(2024, 1, 1),
                )
            )
        db.add(WatchlistItem(user_id=USER_ID, ticker="MSFT", name="MSFT", asset_type="STOCK"))
        db.commit()
        open_only = default_ticker_infos(db, USER_ID, open_only=True)
        everything = default_ticker_infos(db, USER_ID)
    assert [i["ticker"] for i in open_only] == ["AAPL", "MSFT"]  # the closed position is absent
    assert [i["is_held"] for i in open_only] == [True, False]
    assert [i["ticker"] for i in everything] == ["AAPL", "OLD", "MSFT"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --native-tls pytest tests/test_agents_jobs.py -q`
Expected: FAIL (`unexpected keyword 'source'`, `ImportError: default_ticker_infos`).

- [ ] **Step 3: Implement**

In `backend/app/agents/jobs.py` add the imports `from sqlalchemy.orm import Session` and `from app.models import Holding, Recommendation, WatchlistItem`, then:

```python
MAX_RUN_TICKERS = 50  # each ticker is its own graph run (a Claude web search plus an embedding)


def default_ticker_infos(
    db: Session, user_id: uuid.UUID, *, open_only: bool = False
) -> list[dict[str, Any]]:
    """Every holding followed by the watchlist, capped at MAX_RUN_TICKERS. `open_only` leaves out
    holdings with no shares left (the scheduled run analyzes what the person still owns)."""
    holdings = db.query(Holding).filter_by(user_id=user_id)
    if open_only:
        holdings = holdings.filter(Holding.shares > 0)
    infos = [
        {"ticker": h.ticker, "asset_type": h.asset_type, "is_held": True} for h in holdings
    ] + [
        {"ticker": w.ticker, "asset_type": w.asset_type, "is_held": False}
        for w in db.query(WatchlistItem).filter_by(user_id=user_id)
    ]
    return infos[:MAX_RUN_TICKERS]
```

Add `source: str = "manual"` as the last parameter of `_process_ticker` and `run_job` (pass it through in the `gather` call), and `source=source,` in the `Recommendation(...)` constructor.

In `backend/app/routers/analysis.py`: delete `MAX_RUN_TICKERS` and import it with `from app.agents.jobs import MAX_RUN_TICKERS, create_job, default_ticker_infos, get_job_status, run_job`; in `_build_ticker_infos` replace the whole `else:` branch (the `ticker_infos = [...] + [...]` and the slice) with `ticker_infos = default_ticker_infos(db, user_id)`. Keep the explicit-tickers branch and its 404 exactly as it is.

- [ ] **Step 4: Run**

Run: `uv run --native-tls pytest tests/test_agents_jobs.py tests/test_analysis_router.py -q`
Expected: PASS (the router behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests
git commit -m "refactor: run_job carries a recommendation source; default ticker list lives in jobs.py"
```

---

### Task 3: Shared pause rules (`auto_analysis.py`) and `has_usable_key`

**Files:**
- Modify: `backend/app/claude_keys.py` (add `has_usable_key` after `require_claude_key`)
- Create: `backend/app/auto_analysis.py`
- Test: new `backend/tests/test_auto_analysis.py`

**Interfaces:**
- Consumes: `claude_keys._usable_key_row`, `ClaudeKeyRequired`; `usage.get_usage`, `usage.effective_limit`, `usage.LimitDefaults`; `models.Recommendation`, `AppUser`.
- Produces:
  - `claude_keys.has_usable_key(db: Session, user_id: uuid.UUID, role: str) -> bool` — True for a saved key with status `ok`, and for an admin without a key (server key); False otherwise. Decrypts nothing.
  - `auto_analysis.STALE_AFTER = timedelta(days=3)`.
  - `auto_analysis.fresh_pending_tickers(db: Session, user_id: uuid.UUID, now: datetime) -> set[str]` — tickers with a PENDING call created after `now - STALE_AFTER` (naive UTC `now`).
  - `auto_analysis.next_month_start(today: date) -> date`.
  - `auto_analysis.Pause` (frozen dataclass: `reason: Literal["no_key", "limit"]`, `limit: int | None = None`, `resumes_on: date | None = None`).
  - `async auto_analysis.pause_state(db: Session, user: AppUser, defaults: LimitDefaults, today: date) -> Pause | None`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_auto_analysis.py`:

```python
import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta

from app import auto_analysis, claude_keys
from app.models import AppUser, Recommendation, UserApiKey
from app.redis_client import get_redis
from app.usage import LimitDefaults
from tests.auth_support import USER_ID, add_app_user

DEFAULTS = LimitDefaults(analysis_runs=3, chat_messages=10)


def _rec(db, ticker, status="PENDING", days_old=0):
    db.add(
        Recommendation(
            user_id=USER_ID,
            ticker=ticker,
            asset_type="STOCK",
            action="BUY",
            reasoning=["x"],
            status=status,
            created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=days_old),
        )
    )
    db.commit()


def _key(db, status="ok"):
    db.add(
        UserApiKey(
            user_id=USER_ID,
            ciphertext=claude_keys.encrypt_key(USER_ID, "sk-ant-test-key-0000"),
            last4="0000",
            status=status,
        )
    )
    db.commit()


def test_a_pending_call_younger_than_three_days_is_fresh_and_an_older_one_is_not(session):
    _rec(session, "AAPL", days_old=2)
    _rec(session, "MSFT", days_old=3, status="PENDING")
    _rec(session, "NVDA", days_old=0, status="APPROVED")
    now = datetime.now(UTC).replace(tzinfo=None)
    assert auto_analysis.fresh_pending_tickers(session, USER_ID, now) == {"AAPL"}


def test_next_month_start_rolls_over_the_year():
    assert auto_analysis.next_month_start(date(2026, 10, 6)) == date(2026, 11, 1)
    assert auto_analysis.next_month_start(date(2026, 12, 31)) == date(2027, 1, 1)


def test_has_usable_key(session):
    add_app_user(session, USER_ID, role="user")
    assert claude_keys.has_usable_key(session, USER_ID, "user") is False
    assert claude_keys.has_usable_key(session, USER_ID, "admin") is True  # server key
    _key(session)
    assert claude_keys.has_usable_key(session, USER_ID, "user") is True


def test_a_flagged_key_is_not_usable_even_for_an_admin(session):
    add_app_user(session, USER_ID, role="admin")
    _key(session, status="needs_attention")
    assert claude_keys.has_usable_key(session, USER_ID, "admin") is False


def test_pause_state_no_key_then_limit_then_none(session):
    user = add_app_user(session, USER_ID, role="user")
    today = date(2026, 10, 6)

    pause = asyncio.run(auto_analysis.pause_state(session, user, DEFAULTS, today))
    assert pause == auto_analysis.Pause("no_key")

    _key(session)
    assert asyncio.run(auto_analysis.pause_state(session, user, DEFAULTS, today)) is None

    redis = get_redis()
    month = datetime.now(UTC).strftime("%Y-%m")
    asyncio.run(redis.set(f"usage:analysis_run:{USER_ID}:{month}", 2))  # limit is 3: still room
    assert asyncio.run(auto_analysis.pause_state(session, user, DEFAULTS, today)) is None

    asyncio.run(redis.set(f"usage:analysis_run:{USER_ID}:{month}", 3))  # used all 3
    pause = asyncio.run(auto_analysis.pause_state(session, user, DEFAULTS, today))
    assert pause == auto_analysis.Pause("limit", limit=3, resumes_on=date(2026, 11, 1))
```

(`session` is the owner-session fixture used by the other model tests; if the Redis fixture in `conftest.py` is named differently or autouse, follow `tests/test_usage.py` for how it is obtained and reset between tests.)

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --native-tls pytest tests/test_auto_analysis.py -q`
Expected: FAIL (`ModuleNotFoundError: app.auto_analysis`).

- [ ] **Step 3: Implement**

Append to `backend/app/claude_keys.py`:

```python
def has_usable_key(db: Session, user_id: uuid.UUID, role: str) -> bool:
    """True when a request for this user could get a Claude client: a saved key that is `ok`, or no
    key at all for an admin (who then uses the server key). Decrypts nothing and builds no client."""
    try:
        _usable_key_row(db, user_id, role)
    except ClaudeKeyRequired:
        return False
    return True
```

`backend/app/auto_analysis.py`:

```python
"""Rules shared by the weekday analysis job and the Preferences screen: whether a person's
automatic analysis is paused, and which tickers are still fresh enough to skip."""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from sqlalchemy.orm import Session

from app import claude_keys
from app.models import AppUser, Recommendation
from app.usage import LimitDefaults, effective_limit, get_usage

# A pending call this young is left alone; an older one is analyzed again and superseded.
STALE_AFTER = timedelta(days=3)


@dataclass(frozen=True)
class Pause:
    reason: Literal["no_key", "limit"]
    limit: int | None = None
    resumes_on: date | None = None


def fresh_pending_tickers(db: Session, user_id: uuid.UUID, now: datetime) -> set[str]:
    """Tickers that already have a PENDING recommendation younger than STALE_AFTER (`now` is naive
    UTC, like the created_at column)."""
    rows = (
        db.query(Recommendation.ticker)
        .filter(
            Recommendation.user_id == user_id,
            Recommendation.status == "PENDING",
            Recommendation.created_at > now - STALE_AFTER,
        )
        .distinct()
        .all()
    )
    return {row[0] for row in rows}


def next_month_start(today: date) -> date:
    """First day of the month after `today`: when this month's run counter starts over."""
    return date(today.year + 1, 1, 1) if today.month == 12 else date(today.year, today.month + 1, 1)


async def pause_state(
    db: Session, user: AppUser, defaults: LimitDefaults, today: date
) -> Pause | None:
    """Why this user's automatic analysis cannot run right now, or None when it can."""
    if not claude_keys.has_usable_key(db, user.id, user.role):
        return Pause("no_key")
    limit = effective_limit(user, "analysis_run", defaults)
    if await get_usage("analysis_run", str(user.id)) >= limit:
        return Pause("limit", limit=limit, resumes_on=next_month_start(today))
    return None
```

- [ ] **Step 4: Run**

Run: `uv run --native-tls pytest tests/test_auto_analysis.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/claude_keys.py backend/app/auto_analysis.py backend/tests/test_auto_analysis.py
git commit -m "feat: shared rules for pausing automatic analysis and skipping fresh tickers"
```

---

### Task 4: The scheduled step

**Files:**
- Modify: `backend/app/scheduled.py` (`Summary`, new `run_analysis`/`_analyze_user`, `COMMANDS`, `run_command`)
- Test: `backend/tests/test_scheduled.py`

**Interfaces:**
- Consumes: Task 2 (`default_ticker_infos`, `run_job(..., source=)`), Task 3 (`pause_state`, `fresh_pending_tickers`), existing `create_job`, `get_job_status`, `claude_keys.resolve_client`, `usage.load_limit_defaults`, `usage.check_and_increment_usage`, `usage.effective_limit`, `scoped_session`.
- Produces: `Summary.analysis_runs`, `Summary.analysis_skipped`, `Summary.analysis_failures` (and `line()` includes them); `async run_analysis(summary: Summary, now: datetime | None = None) -> None`; command `analysis`; `daily` runs it after outcomes; exit code 1 when `summary.failures or summary.analysis_failures`; `MAX_ANALYSIS_SECONDS = 2400`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_scheduled.py` (reuse its `env` fixture, `_holding`, `add_app_user`, `OTHER_USER_ID`, `THIRD_USER_ID`; add imports `InvestmentPreferences, UserApiKey, WatchlistItem` from `app.models` and `from app import claude_keys`):

```python
MONDAY = datetime(2026, 10, 5, 5, 30, tzinfo=UTC)
SATURDAY = datetime(2026, 10, 10, 5, 30, tzinfo=UTC)


def _opted_in(db, user_id, *, key=True, role="user", status="active"):
    add_app_user(db, user_id, role=role, status=status)
    db.add(InvestmentPreferences(user_id=user_id, auto_analysis=True))
    if key:
        db.add(
            UserApiKey(
                user_id=user_id,
                ciphertext=claude_keys.encrypt_key(user_id, "sk-ant-test-key-0000"),
                last4="0000",
            )
        )
    db.commit()


def _state(action="BUY"):
    return {
        "action": action,
        "reasoning": ["x"],
        "ai_analysis": None,
        "suggested_position_pct": 0.05,
        "quote": {"price": 100.0},
        "fundamental_score": 5,
        "technical_signal": "NEUTRAL",
    }


def _run_analysis(now=MONDAY, graph=None):
    summary = scheduled.Summary()
    graph = graph or AsyncMock(return_value=_state())
    with patch("app.agents.jobs.run_graph_for_ticker", graph):
        asyncio.run(scheduled.run_analysis(summary, now=now))
    return summary, graph


def _recs(db, user_id):
    return db.query(Recommendation).filter_by(user_id=user_id).all()


def test_an_opted_in_user_gets_scheduled_recommendations_and_one_run_is_counted(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    summary, graph = _run_analysis()
    recs = _recs(env, USER_ID)
    assert [(r.ticker, r.source, r.status) for r in recs] == [("AAPL", "scheduled", "PENDING")]
    assert (summary.analysis_runs, summary.analysis_skipped, summary.analysis_failures) == (1, 0, 0)
    # the run was made with the user's own client, never the server key
    assert graph.await_args.args[4] is not None
    redis = get_redis()
    month = MONDAY.strftime("%Y-%m")
    assert asyncio.run(redis.get(f"usage:analysis_run:{USER_ID}:{month}")) == "1"


def test_a_user_who_has_not_opted_in_is_left_alone(env):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert (summary.analysis_runs, summary.analysis_skipped) == (0, 0)


def test_weekends_do_nothing(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    summary, graph = _run_analysis(now=SATURDAY)
    graph.assert_not_awaited()
    assert summary.analysis_runs == 0


def test_only_active_users_run(env):
    _opted_in(env, USER_ID, status="invited")
    _holding(env, USER_ID, "AAPL")
    _, graph = _run_analysis()
    graph.assert_not_awaited()


def test_a_user_without_a_key_is_skipped_not_failed(env):
    _opted_in(env, USER_ID, key=False)
    _holding(env, USER_ID, "AAPL")
    summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert (summary.analysis_skipped, summary.analysis_failures) == (1, 0)


def test_an_admin_without_a_personal_key_uses_the_server_key(env):
    _opted_in(env, USER_ID, key=False, role="admin")
    _holding(env, USER_ID, "AAPL")
    summary, graph = _run_analysis()
    assert summary.analysis_runs == 1
    assert graph.await_args.args[4] is None  # client None = the server's key, admin only


def test_a_user_at_the_monthly_limit_is_skipped_and_one_below_it_runs(env):
    _opted_in(env, USER_ID)
    _opted_in(env, OTHER_USER_ID)
    for uid in (USER_ID, OTHER_USER_ID):
        _holding(env, uid, "AAPL")
    env.query(AppUser).filter_by(id=USER_ID).update({"monthly_analysis_limit": 2})
    env.query(AppUser).filter_by(id=OTHER_USER_ID).update({"monthly_analysis_limit": 2})
    env.commit()
    redis = get_redis()
    month = MONDAY.strftime("%Y-%m")
    asyncio.run(redis.set(f"usage:analysis_run:{USER_ID}:{month}", 2))        # used all
    asyncio.run(redis.set(f"usage:analysis_run:{OTHER_USER_ID}:{month}", 1))  # one left
    summary, _ = _run_analysis()
    assert _recs(env, USER_ID) == []
    assert len(_recs(env, OTHER_USER_ID)) == 1
    assert (summary.analysis_runs, summary.analysis_skipped) == (1, 1)


def test_a_fresh_pending_call_is_skipped_and_an_old_one_is_replaced(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    _holding(env, USER_ID, "MSFT")
    now = MONDAY.replace(tzinfo=None)
    for ticker, age in (("AAPL", 1), ("MSFT", 4)):
        env.add(
            Recommendation(
                user_id=USER_ID, ticker=ticker, asset_type="STOCK", action="HOLD",
                reasoning=["old"], created_at=now - timedelta(days=age),
            )
        )
    env.commit()
    summary, graph = _run_analysis()
    assert [c.args[1] for c in graph.await_args_list] == ["MSFT"]  # AAPL is fresh: left alone
    by_ticker = {}
    for r in _recs(env, USER_ID):
        by_ticker.setdefault(r.ticker, []).append((r.source, r.status))
    assert by_ticker["AAPL"] == [("manual", "PENDING")]
    assert sorted(by_ticker["MSFT"]) == [("manual", "SUPERSEDED"), ("scheduled", "PENDING")]
    assert summary.analysis_runs == 1


def test_running_twice_on_the_same_day_skips_everything_the_second_time(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    _run_analysis()
    summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert (summary.analysis_runs, summary.analysis_skipped) == (0, 1)
    month = MONDAY.strftime("%Y-%m")
    assert asyncio.run(get_redis().get(f"usage:analysis_run:{USER_ID}:{month}")) == "1"


def test_nothing_to_analyze_counts_no_run(env):
    _opted_in(env, USER_ID)            # no holdings, no watchlist
    _opted_in(env, OTHER_USER_ID)
    _holding(env, OTHER_USER_ID, "AAPL", shares=0)  # a closed position is not analyzed
    summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert (summary.analysis_runs, summary.analysis_skipped) == (0, 2)
    assert asyncio.run(get_redis().get(f"usage:analysis_run:{USER_ID}:{MONDAY.strftime('%Y-%m')}")) is None


def test_the_watchlist_is_analyzed_too(env):
    _opted_in(env, USER_ID)
    env.add(WatchlistItem(user_id=USER_ID, ticker="NVDA", name="NVDA", asset_type="STOCK"))
    env.commit()
    _run_analysis()
    assert [(r.ticker, r.source) for r in _recs(env, USER_ID)] == [("NVDA", "scheduled")]


def test_one_failing_user_does_not_stop_the_others_and_the_command_fails(env, caplog):
    _opted_in(env, USER_ID)
    _opted_in(env, OTHER_USER_ID)
    _holding(env, USER_ID, "AAPL")
    _holding(env, OTHER_USER_ID, "MSFT")

    async def graph(user_id, ticker, *args):
        if user_id == USER_ID:
            raise RuntimeError("boom sk-ant-test-key-0000")
        return _state()

    with caplog.at_level(logging.DEBUG):
        summary, _ = _run_analysis(graph=AsyncMock(side_effect=graph))
    assert len(_recs(env, OTHER_USER_ID)) == 1
    assert summary.analysis_failures == 1 and summary.analysis_runs == 2
    assert "sk-ant-test-key-0000" not in caplog.text


def test_a_key_anthropic_rejects_during_the_run_counts_as_a_failure_and_is_flagged(env):
    import anthropic

    _opted_in(env, USER_ID)
    _opted_in(env, OTHER_USER_ID)
    _holding(env, USER_ID, "AAPL")
    _holding(env, OTHER_USER_ID, "MSFT")

    async def graph(user_id, ticker, *args):
        if user_id == USER_ID:
            claude_keys.mark_needs_attention(user_id)  # what graph.news_agent does on a 401
        return _state()

    summary, _ = _run_analysis(graph=AsyncMock(side_effect=graph))
    env.expire_all()
    assert env.query(UserApiKey).filter_by(user_id=USER_ID).one().status == "needs_attention"
    assert summary.analysis_failures == 1
    assert len(_recs(env, OTHER_USER_ID)) == 1


def test_an_undecryptable_key_is_skipped_and_flagged_not_crashed(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    env.query(UserApiKey).update({"ciphertext": b"not a real ciphertext at all, no."})
    env.commit()
    summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert (summary.analysis_skipped, summary.analysis_failures) == (1, 0)
    env.expire_all()
    assert env.query(UserApiKey).one().status == "needs_attention"


def test_a_run_past_the_time_budget_skips_the_remaining_users(env, monkeypatch):
    _opted_in(env, USER_ID)
    _opted_in(env, OTHER_USER_ID)
    _holding(env, USER_ID, "AAPL")
    _holding(env, OTHER_USER_ID, "MSFT")
    monkeypatch.setattr(scheduled, "MAX_ANALYSIS_SECONDS", -1)
    summary, graph = _run_analysis()
    graph.assert_not_awaited()
    assert summary.analysis_skipped == 2


def test_the_daily_command_runs_the_analysis_step_and_exits_non_zero_on_a_failed_user(env):
    _opted_in(env, USER_ID)
    _holding(env, USER_ID, "AAPL")
    graph = AsyncMock(side_effect=RuntimeError("boom"))
    # run_job swallows a per-ticker error into the job results; the user still counts as failed
    with patch("app.agents.jobs.run_graph_for_ticker", graph), patch(
        "app.scheduled.datetime"
    ) as clock, patch("app.snapshots.fetch_quote_and_history", _price_ok()):
        clock.now.return_value = MONDAY
        assert asyncio.run(scheduled.run_command("analysis")) == 1
```

(Where these tests call the pipeline for a ticker the user does not hold yet, add the holding/watchlist rows first. If `scheduled.datetime` cannot be patched this way, pass `now` through a module-level `_now()` helper in `scheduled.py` and patch that instead — keep the production code simple and use whichever the existing tests of this module make easiest.)

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --native-tls pytest tests/test_scheduled.py -q`
Expected: FAIL (`AttributeError: module 'app.scheduled' has no attribute 'run_analysis'`).

- [ ] **Step 3: Implement**

In `backend/app/scheduled.py` update the imports:

```python
import time
...
from app import claude_keys
from app.agents.jobs import create_job, default_ticker_infos, get_job_status, run_job
from app.auto_analysis import fresh_pending_tickers, pause_state
from app.config import settings
from app.models import AppUser, Holding, InvestmentPreferences, PortfolioSnapshot, UserApiKey
from app.usage import LimitDefaults, check_and_increment_usage, effective_limit, load_limit_defaults
```

Extend `Summary`:

```python
    analysis_runs: int = 0
    analysis_skipped: int = 0
    analysis_failures: int = 0
```

and `line()` to end with

```python
            f"outcomes_evaluated={self.outcomes_evaluated} failures={self.failures} "
            f"analysis_runs={self.analysis_runs} analysis_skipped={self.analysis_skipped} "
            f"analysis_failures={self.analysis_failures}"
```

(update the existing `line()` assertion in `test_scheduled.py` accordingly).

Add, after `run_outcomes`:

```python
# One user's run can take minutes (up to 50 tickers, 3 at a time). A global budget keeps the whole
# command inside its lock and its machine: users not reached are skipped and logged.
MAX_ANALYSIS_SECONDS = 2400


async def _analyze_user(user_id: uuid.UUID, now: datetime, defaults: LimitDefaults) -> str:
    """One user's automatic run: "off" | "skipped" | "ran" | "failed". The key's client exists only
    inside this call."""
    with app_db.scoped_session(user_id) as db:
        prefs = db.query(InvestmentPreferences).filter_by(user_id=user_id).one_or_none()
        if prefs is None or not prefs.auto_analysis:
            return "off"
        user = db.get(AppUser, user_id)
        if user is None or user.status != "active":
            return "off"
        if await pause_state(db, user, defaults, now.date()) is not None:
            return "skipped"
        fresh = fresh_pending_tickers(db, user_id, now.replace(tzinfo=None))
        infos = [
            t for t in default_ticker_infos(db, user_id, open_only=True) if t["ticker"] not in fresh
        ]
        if not infos:
            return "skipped"
        try:
            # Always the user's own client; None only for an admin with no key of their own.
            client = claude_keys.resolve_client(db, user_id, user.role)
        except claude_keys.ClaudeKeyRequired:
            return "skipped"  # includes a key that could not be decrypted (flagged inside)
        limit = effective_limit(user, "analysis_run", defaults)
    # The session is closed: the run below must not hold a database connection for minutes.
    await check_and_increment_usage("analysis_run", str(user_id), limit)
    job_id = await create_job(user_id, infos)
    await run_job(job_id, user_id, infos, client=client, source="scheduled")
    status = await get_job_status(job_id, user_id)
    errored = status is not None and any("error" in r for r in status["results"])
    with app_db.scoped_session(user_id) as db:
        key = db.query(UserApiKey).filter_by(user_id=user_id).one_or_none()
        rejected = key is not None and key.status != "ok"
    return "failed" if errored or rejected else "ran"


async def run_analysis(summary: Summary, now: datetime | None = None) -> None:
    """Opt-in weekday analysis (Monday to Friday, UTC). A user's failure is counted and logged by
    id and class name; the others still run."""
    now = now or datetime.now(UTC)
    if now.weekday() >= 5:
        logger.info("Analysis: weekend, nothing to do")
        return
    ids = active_user_ids()
    if summary.users == 0:
        summary.users = len(ids)
    with app_db.SessionLocal() as db:
        defaults = load_limit_defaults(db, settings)
    started = time.monotonic()
    for user_id in ids:
        if time.monotonic() - started > MAX_ANALYSIS_SECONDS:
            summary.analysis_skipped += 1
            logger.warning("Analysis user %s: skipped (time budget used up)", user_id)
            continue
        try:
            outcome = await _analyze_user(user_id, now, defaults)
        except Exception as exc:
            summary.analysis_failures += 1
            logger.warning("Analysis failed for user %s: %s", user_id, type(exc).__name__)
            continue
        if outcome == "ran":
            summary.analysis_runs += 1
        elif outcome == "skipped":
            summary.analysis_skipped += 1
        elif outcome == "failed":
            summary.analysis_runs += 1  # the run was counted against the monthly limit
            summary.analysis_failures += 1
            logger.warning("Analysis user %s: finished with errors", user_id)
        logger.info("Analysis user %s: %s", user_id, outcome)
```

Wire the command: `COMMANDS = ("daily", "snapshots", "outcomes", "analysis")`; in `run_command` after the outcomes block add

```python
        if command in ("daily", "analysis"):
            await run_analysis(summary)
```

and change the final return to `return 1 if summary.failures or summary.analysis_failures else 0`. Update the module docstring to mention the analysis step.

- [ ] **Step 4: Run**

Run: `uv run --native-tls pytest tests/test_scheduled.py -q`, then the whole backend suite plus `uv run --native-tls ruff check . && uv run --native-tls mypy app`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/scheduled.py backend/tests/test_scheduled.py
git commit -m "feat: weekday automatic analysis step in the daily scheduled job"
```

---

### Task 5: Preferences API — the switch and the paused reasons

**Files:**
- Modify: `backend/app/schemas.py` (`PreferencesIn`, `PreferencesOut`, new `AutoAnalysisPaused`)
- Modify: `backend/app/routers/preferences.py`
- Test: `backend/tests/test_preferences_router.py`, and the export expectations in `backend/tests/test_me_router.py` if they list preference keys

**Interfaces:**
- Consumes: Task 3 (`pause_state`, `Pause`), `usage.load_limit_defaults`.
- Produces: `PreferencesIn.auto_analysis: bool | None = None` (None = leave unchanged); `PreferencesOut.auto_analysis: bool = False`; `PreferencesOut.auto_analysis_paused: AutoAnalysisPaused | None = None` with `AutoAnalysisPaused(reason: Literal["no_key", "limit"], limit: int | None = None, resumes_on: date | None = None)`. `auto_analysis_paused` is only filled when `auto_analysis` is true.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_preferences_router.py` (use its existing `client` fixture and style; `client` has a saved key for `USER_ID`; `client_no_key` has none):

```python
def test_auto_analysis_defaults_to_off(client):
    body = client.get("/preferences").json()
    assert body["auto_analysis"] is False
    assert body["auto_analysis_paused"] is None


def test_the_switch_round_trips_and_saving_other_fields_keeps_it(client):
    assert client.post("/preferences", json={"auto_analysis": True}).json()["auto_analysis"] is True
    # an older client that does not send the field must not turn it off
    again = client.post("/preferences", json={"risk_tolerance": "moderate"}).json()
    assert again["auto_analysis"] is True
    off = client.post("/preferences", json={"auto_analysis": False}).json()
    assert off["auto_analysis"] is False


def test_an_enabled_switch_with_a_key_and_room_is_not_paused(client):
    client.post("/preferences", json={"auto_analysis": True})
    assert client.get("/preferences").json()["auto_analysis_paused"] is None


def test_an_enabled_switch_without_a_key_is_paused_for_the_key(client_no_key):
    client_no_key.post("/preferences", json={"auto_analysis": True})
    paused = client_no_key.get("/preferences").json()["auto_analysis_paused"]
    assert paused["reason"] == "no_key"


def test_an_enabled_switch_at_the_monthly_limit_reports_the_limit_and_the_resume_date(client):
    client.post("/preferences", json={"auto_analysis": True})
    month = datetime.now(UTC).strftime("%Y-%m")
    limit = settings.default_monthly_analysis_limit
    asyncio.run(get_redis().set(f"usage:analysis_run:{USER_ID}:{month}", limit))
    paused = client.get("/preferences").json()["auto_analysis_paused"]
    assert paused["reason"] == "limit"
    assert paused["limit"] == limit
    assert paused["resumes_on"] == next_month_start(datetime.now(UTC).date()).isoformat()


def test_a_disabled_switch_is_never_reported_as_paused(client_no_key):
    assert client_no_key.get("/preferences").json()["auto_analysis_paused"] is None
```

(Add the imports `asyncio`, `from datetime import UTC, datetime`, `from app.config import settings`, `from app.auto_analysis import next_month_start`, `from app.redis_client import get_redis` and `from tests.auth_support import USER_ID` to the test module.)

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --native-tls pytest tests/test_preferences_router.py -q`
Expected: FAIL (`KeyError: 'auto_analysis'`).

- [ ] **Step 3: Implement**

`backend/app/schemas.py` (add `date` to the datetime import and `Literal` if missing):

```python
class AutoAnalysisPaused(BaseModel):
    reason: Literal["no_key", "limit"]
    limit: int | None = None
    resumes_on: date | None = None
```

`PreferencesIn`: add `auto_analysis: bool | None = None  # None: leave as it is`.
`PreferencesOut`: add

```python
    auto_analysis: bool = False
    auto_analysis_paused: AutoAnalysisPaused | None = None
```

`backend/app/routers/preferences.py` — make both routes async, keep the blocking queries in the threadpool, and build the paused field:

```python
from datetime import UTC, datetime

from starlette.concurrency import run_in_threadpool

from app.auto_analysis import pause_state
from app.config import settings
from app.models import AppUser, InvestmentPreferences
from app.schemas import AutoAnalysisPaused, PreferencesIn, PreferencesOut
from app.usage import load_limit_defaults


async def _out(db: Session, user: CurrentUser, pref: InvestmentPreferences | None) -> PreferencesOut:
    out = PreferencesOut.model_validate(pref) if pref is not None else PreferencesOut()
    if out.auto_analysis:
        row = await run_in_threadpool(db.get, AppUser, user.id)
        defaults = await run_in_threadpool(load_limit_defaults, db, settings)
        pause = await pause_state(db, row, defaults, datetime.now(UTC).date())
        if pause is not None:
            out.auto_analysis_paused = AutoAnalysisPaused(
                reason=pause.reason, limit=pause.limit, resumes_on=pause.resumes_on
            )
    return out
```

`get_preferences` becomes `async def`, loads `pref` with `await run_in_threadpool(...)`, and returns `await _out(db, user, pref)`. In `upsert_preferences` (also async):

```python
    values = payload.model_dump()
    auto = values.pop("auto_analysis")
    pref = ...one_or_none()
    if pref is None:
        pref = InvestmentPreferences(user_id=user.id, **values)
        db.add(pref)
    else:
        for field, value in values.items():
            setattr(pref, field, value)
    if auto is not None:
        pref.auto_analysis = auto
    db.commit(); db.refresh(pref)
    return await _out(db, user, pref)
```

(Keep the `response_model=PreferencesOut` and any existing commit/rollback pattern of this router. `pause_state` calls `has_usable_key`, a synchronous query: wrap it as `await run_in_threadpool` is not possible for an async function, so if the event-loop blocking matters to the existing tests, run the whole `_out` body's DB access in one `run_in_threadpool` helper and only `get_usage` on the loop — the implementer picks the simpler form that keeps the tests green and records it.)

- [ ] **Step 4: Run**

Run: `uv run --native-tls pytest tests/test_preferences_router.py tests/test_me_router.py -q`, then the whole suite, ruff, mypy.
Expected: PASS (adjust the export test's expected preference keys to include the two new fields).

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat: preferences expose the automatic analysis switch and why it is paused"
```

---

### Task 6: Docs and the job's machine size

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§12 scheduled jobs; the preferences table row; the `recommendations` table row; the `GET/POST /preferences` API entries)
- Modify: `docs/RUNBOOK.md` (scheduled-job section)
- Modify: `.github/workflows/scheduled-jobs.yml`

- [ ] **Step 1: ARCHITECTURE.md** — in §12 describe the third step (weekday only, opt-in, per-user scope and client, one run counted, tickers with a pending call younger than 3 days skipped, `source = scheduled`, time budget 2400 s, summary counters, exit code); add `auto_analysis` to the `investment_preferences` row and `source` to the `recommendations` row; document the two new `PreferencesOut` fields in the API section.
- [ ] **Step 2: RUNBOOK.md** — in the scheduled-job section list the new counters (`analysis_runs`, `analysis_skipped`, `analysis_failures`), explain that "skipped" is normal (no key, limit reached, nothing new), that a failure turns the workflow red, how to run the step alone (`python -m app.scheduled analysis`), that a second run the same day is safe (fresh calls are skipped, no extra run counted), and that the cost lands on each person's own Claude key and, for the admin, on the server key.
- [ ] **Step 3: Workflow** — in `.github/workflows/scheduled-jobs.yml` change the one-off machine to `--vm-memory 1024` (the analysis pipeline runs three tickers at a time with pandas and yfinance), update the cron comment to mention the analysis step, and keep every pin and permission as it is. Run `actionlint` on the file if available.
- [ ] **Step 4: Commit**

```bash
git add docs .github/workflows/scheduled-jobs.yml
git commit -m "docs: scheduled analysis in the architecture notes and the runbook; give the job 1 GB"
```

---

### Task 7: STOP — design the small frontend (huashu-design + impeccable)

The backend (Tasks 1-6) is complete and can be pushed on its own. No frontend code is written until this task is finished and the user has picked a direction.

**Files:**
- Create: `docs/design/scheduled-analysis/` (draft HTML and screenshots; kept as the design reference once chosen)
- Create: `direction-approved.md` in that folder

- [ ] **Step 1: Run the design skills** — invoke `huashu-design` (three real HTML directions with screenshots, using `docs/design/claude-keys/base.css` and `shell.js`, which carry the app's tokens) and `impeccable` (shape, then critique/polish of the chosen one). Each direction covers, in dark and light and at phone width: (a) the **Preferences** switch "Analyze my portfolio automatically each weekday" with its one-line explanation, in the three states off / on / paused ("Paused: you have used all N runs this month. It resumes on <date>." and "Paused: connect your Claude key to turn this on.", the second with a link to `/more/connect-claude`); (b) the **Today** recommendation card with the "Automatic" tag, next to a manual one, and the existing "Last analysis" line. Use the spec's copy verbatim; no emoji, no Buy/Sell wording.
- [ ] **Step 2: Present and stop** — show the three directions and wait for the user's choice or mix. Do not start Task 8 until they answer.
- [ ] **Step 3: Record the decision** — write `direction-approved.md` (what was shown, screenshot paths, the user's words), fill Part 2 below with the chosen structure, and commit both.

---

## Part 2 — Frontend (design picked: direction A, a row in Preferences)

The user picked direction A on 2026-10-06. The decision and the rules that come with it are in `docs/design/scheduled-analysis/direction-approved.md`; the drafts to match are `docs/design/scheduled-analysis/a-row-in-preferences.html` (with `sa.js`, `sa.css`) and `shots/a-*`. Copy is verbatim from `sa.js` (LABEL, EXPLAIN, P_LIMIT, P_KEY).

Each task follows the same rhythm (failing Vitest test, run, implement, run, `eslint` / `tsc` / full suite / build, commit) and uses the existing `useAction`, SWR, `apiFetch`, MUI components and design tokens.

### Task 8: Types and the Preferences switch

**Files:** `frontend/lib/preferences.ts` (`auto_analysis`, `auto_analysis_paused` on `Preferences`), the Preferences page/form (`frontend/app/(shell)/more/preferences/page.tsx` and its component), tests beside them.

Design A: a separate panel under the existing preference fields with one row: title, the explanation line under it, the switch at the right; paused shows an amber line with a warning icon under the row. The switch saves on toggle (no Save button). IMPORTANT: `POST /preferences` replaces every field, so the toggle must send the SAVED values of risk_tolerance, sector_avoid_list and notes (from the loaded preferences, not an unsaved form draft) together with `auto_analysis`; a test must assert that toggling the switch does not change the other saved fields.

Behaviour to test: the switch reflects `auto_analysis` and is off by default; toggling it sends `POST /preferences` with `auto_analysis` (and the other fields unchanged); the explanation line is always visible; when `auto_analysis_paused.reason === "limit"` the paused line shows N (`limit`) and the resume date formatted for the user's locale; when `"no_key"` it shows "Paused: connect your Claude key to turn this on." with a link to `/more/connect-claude`; the paused line only appears while the switch is on; a failed save restores the switch and shows the error.

### Task 9: The Automatic tag on Today

**Files:** `frontend/lib/api/recommendation-types.ts` (`source: "manual" | "scheduled"`), `frontend/components/recommendations/RecommendationCard.tsx` (and the desktop detail view if it renders its own header), tests beside them.

Design A: a small outlined pill "Automatic" with a clock icon, next to the action chip (see `a-row-in-preferences.html` Today frame).

Behaviour to test: a recommendation with `source === "scheduled"` shows the "Automatic" tag, a manual one does not; `SUPERSEDED` calls are still not listed (existing behaviour, keep its test green); the Track record counts are unchanged (`lib/trackRecord.ts` already excludes `SUPERSEDED`).

---

### Task 10: Final review, security review and the pull request

- [ ] **Step 1:** Run all checks: backend `uv run --native-tls ruff check . && uv run --native-tls mypy app && uv run --native-tls pytest -q`; frontend `npx eslint . && npx tsc --noEmit && npx vitest run && npm run build`.
- [ ] **Step 2:** Dispatch the `security-reviewer` subagent on `git diff master...HEAD` with this brief: the scheduled step never uses the server key for a non-admin (`client=None` only for an admin) and never logs, stores or passes a decrypted key (no Redis, job state or module global); each user's work happens in `scoped_session(user_id)` so one user's data never reaches another's run; `active_user_ids` only returns active users and disabled or invited users never run; the monthly counter cannot be bypassed or double-counted (run counted once, before the job; a same-day re-run counts nothing); the `PreferencesIn.auto_analysis` field cannot be set to flip another user's switch; the time budget really bounds the command; no new path can place a trade.
- [ ] **Step 3:** Fix every finding it confirms in one pass, re-run the checks, push the branch and open the pull request. In the description note that the scheduled job's first production run should be watched (RUNBOOK) and that the one-off machine is now 1 GB.
