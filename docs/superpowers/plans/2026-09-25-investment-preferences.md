# Investment Preferences Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `GET /preferences` / `POST /preferences`, a single-row-per-user
profile (risk tolerance, sector avoid-list, free-text notes) that later work
(4c, `build_context()`) will feed into the analysis agent as informational
context.

**Architecture:** One new SQLAlchemy model (`InvestmentPreferences`,
unique on `user_id`) and one new thin router that follows
`routers/portfolio.py`'s existing `POST`-as-upsert pattern exactly
(`upsert_holding`/`upsert_watchlist_item`). No new abstractions — this is
plain CRUD over a single row.

**Tech Stack:** FastAPI, SQLAlchemy 2 (sync ORM), Alembic, Pydantic v2,
pytest.

**Spec:** `docs/superpowers/specs/2026-09-25-investment-preferences-design.md`

## Global Constraints

- Routes are sync `def`, not `async def` (CLAUDE.md — this router has no
  async I/O anywhere, unlike `routers/memory.py`/`routers/chat.py`, so the
  normal sync-routes rule applies with no exception here).
- One SQLAlchemy session per request via `Depends(get_db)`.
- `notes` capped at 2000 chars (matches this project's established
  precedent: `MemorySimilarIn.query` at 4000, `ChatIn.message` at 4000, for
  free-text fields with no DB-level limit).
- `risk_tolerance` validated as `Literal["conservative", "moderate",
  "aggressive"]` at the Pydantic layer, stored as a plain `String(20)` —
  same split as `Holding.asset_type`/`WatchlistItem.asset_type`.
- `GET /preferences` never 404s — returns the schema's default empty shape
  if no row exists yet.
- `InvestmentPreferences` is consumed by nothing in this plan. No edit to
  `agents/chat.py`, `analysis/recommend.py`, or `analysis/technical.py`.
- Never log/persist raw exception text.
- Migration: `alembic revision --autogenerate` only, no hand edits (plain
  new table, unlike 3b's `pgvector` extension statement).

## Review Focus

- A `POST /preferences` call when no row exists yet, immediately followed
  by a second `POST /preferences` — must update the same row, not create a
  second one (the `unique=True` constraint on `user_id` should make a
  duplicate impossible at the DB level, but the upsert logic must also get
  it right at the application level before that constraint is ever
  reached).
- `sector_avoid_list` omitted entirely from a `POST` body — Pydantic's
  `default_factory=list` must produce `[]`, not `null`, since the column
  is `JSON` with `default=list`, not nullable.
- `notes` at exactly 2000 chars (boundary, should succeed) and 2001 chars
  (should 422) — off-by-one on `max_length`.
- `risk_tolerance` sent as an out-of-`Literal` string (e.g. `"YOLO"`) —
  must 422, not silently store an invalid value the way a bare `str`
  column would.
- Two back-to-back `GET /preferences` calls with no `POST` in between on a
  totally fresh database — both must return the same default shape, and
  neither call may accidentally create a row (a `GET` is not supposed to
  have a write side effect).

---

## Task 1: `InvestmentPreferences` model + migration

**Files:**
- Modify: `backend/app/models.py` (append after `BacktestResult`, end of file)
- Test: `backend/tests/test_models.py` (create if it doesn't exist — check
  first; if it exists, append to it)

**Interfaces:**
- Produces: `InvestmentPreferences` (SQLAlchemy model) — `id: int`,
  `user_id: uuid.UUID` (unique), `risk_tolerance: str | None`,
  `sector_avoid_list: list[str]` (default `[]`), `notes: str | None`,
  `updated_at: datetime`. Used by Task 2's router.

- [ ] **Step 1: Read the existing test file**

`backend/tests/test_models.py` already exists (one "roundtrip" test per
model, e.g. `test_holding_roundtrip`, `test_chat_message_roundtrip`). Read
it first — Step 2 below adds to it in the same style. Its current import
line is:

```python
import uuid
from datetime import date

from app.models import ChatMessage, Holding, Recommendation, Trade, WatchlistItem
```

- [ ] **Step 2: Write the failing test**

Change the existing import line to add `InvestmentPreferences` (keep it
alphabetical, matching the existing order) and add `import pytest` above
`import uuid`:

```python
import pytest
import uuid
from datetime import date

from app.models import (
    ChatMessage,
    Holding,
    InvestmentPreferences,
    Recommendation,
    Trade,
    WatchlistItem,
)
```

Then append these two tests to the end of the file:

```python
def test_investment_preferences_roundtrip(db_session):
    pref = InvestmentPreferences(user_id=uuid.uuid4())
    db_session.add(pref)
    db_session.commit()
    db_session.refresh(pref)

    assert pref.risk_tolerance is None
    assert pref.sector_avoid_list == []
    assert pref.notes is None
    assert pref.updated_at is not None


def test_investment_preferences_user_id_unique(db_session):
    user_id = uuid.uuid4()
    db_session.add(InvestmentPreferences(user_id=user_id))
    db_session.commit()

    db_session.add(InvestmentPreferences(user_id=user_id))
    with pytest.raises(Exception):
        db_session.commit()
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && uv run python -m pytest tests/test_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'InvestmentPreferences'`

- [ ] **Step 4: Write minimal implementation**

Append to `backend/app/models.py` (after the `BacktestResult` class, at
the end of the file):

```python
class InvestmentPreferences(Base):
    __tablename__ = "investment_preferences"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, index=True)
    risk_tolerance: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sector_avoid_list: Mapped[list[str]] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
```

No new imports needed — `JSON`, `String`, `Text`, `DateTime`, `Uuid`,
`func`, `Mapped`, `mapped_column` are all already imported at the top of
`models.py` (used by the other models in this file).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run python -m pytest tests/test_models.py -v`
Expected: PASS (2 tests)

- [ ] **Step 6: Generate the migration**

Run: `cd backend && uv run alembic revision --autogenerate -m "add investment_preferences table"`

Open the generated file in `backend/migrations/versions/` and confirm it
contains an `op.create_table("investment_preferences", ...)` with all five
columns and a unique constraint/index on `user_id`. Do not hand-edit it —
if it's missing something, the model in Step 4 is wrong, fix that instead
and regenerate.

- [ ] **Step 7: Apply the migration and verify**

Run: `cd backend && uv run alembic upgrade head`
Expected: no errors. Then re-run the Step 5 test to confirm it still
passes against the real migrated schema: `uv run python -m pytest tests/test_models.py -v`

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/tests/test_models.py backend/migrations/versions/
git commit -m "feat: add InvestmentPreferences model and migration"
```

---

## Task 2: `GET`/`POST /preferences` router

**Files:**
- Create: `backend/app/routers/preferences.py`
- Modify: `backend/app/schemas.py` (add `PreferencesIn`/`PreferencesOut`
  after `MemorySimilarOut`, end of file)
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_preferences_router.py`

**Interfaces:**
- Consumes: `InvestmentPreferences` model (Task 1).
- Produces: `GET /preferences` and `POST /preferences` HTTP endpoints
  returning `PreferencesOut`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_preferences_router.py
from app.config import settings
from app.models import InvestmentPreferences


def test_get_preferences_returns_defaults_when_none_exist(client):
    response = client.get("/preferences")

    assert response.status_code == 200
    assert response.json() == {
        "risk_tolerance": None,
        "sector_avoid_list": [],
        "notes": None,
    }


def test_get_preferences_does_not_create_a_row(client, db_session):
    client.get("/preferences")
    client.get("/preferences")

    count = db_session.query(InvestmentPreferences).count()
    assert count == 0


def test_post_preferences_creates_row(client, db_session):
    response = client.post(
        "/preferences",
        json={
            "risk_tolerance": "aggressive",
            "sector_avoid_list": ["tobacco", "gambling"],
            "notes": "Prefer dividend growth stocks.",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["risk_tolerance"] == "aggressive"
    assert body["sector_avoid_list"] == ["tobacco", "gambling"]
    assert body["notes"] == "Prefer dividend growth stocks."

    rows = (
        db_session.query(InvestmentPreferences)
        .filter_by(user_id=settings.default_user_id)
        .all()
    )
    assert len(rows) == 1


def test_post_preferences_twice_updates_same_row(client, db_session):
    client.post("/preferences", json={"risk_tolerance": "conservative"})
    client.post("/preferences", json={"risk_tolerance": "aggressive"})

    rows = (
        db_session.query(InvestmentPreferences)
        .filter_by(user_id=settings.default_user_id)
        .all()
    )
    assert len(rows) == 1
    assert rows[0].risk_tolerance == "aggressive"


def test_post_preferences_omitted_sector_avoid_list_defaults_to_empty(client):
    response = client.post("/preferences", json={"risk_tolerance": "moderate"})

    assert response.status_code == 200
    assert response.json()["sector_avoid_list"] == []


def test_post_preferences_rejects_invalid_risk_tolerance(client):
    response = client.post("/preferences", json={"risk_tolerance": "YOLO"})

    assert response.status_code == 422


def test_post_preferences_rejects_oversized_notes(client):
    response = client.post("/preferences", json={"notes": "x" * 2001})

    assert response.status_code == 422


def test_post_preferences_accepts_notes_at_max_length(client):
    response = client.post("/preferences", json={"notes": "x" * 2000})

    assert response.status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m pytest tests/test_preferences_router.py -v`
Expected: FAIL — 404 (no `/preferences` route registered yet)

- [ ] **Step 3: Write minimal implementation**

Add to `backend/app/schemas.py` (after `MemorySimilarOut`, end of file):

```python
RiskTolerance = Literal["conservative", "moderate", "aggressive"]


class PreferencesIn(BaseModel):
    risk_tolerance: RiskTolerance | None = None
    sector_avoid_list: list[str] = Field(default_factory=list)
    notes: str | None = Field(default=None, max_length=2000)


class PreferencesOut(PreferencesIn):
    model_config = ConfigDict(from_attributes=True)
```

Create `backend/app/routers/preferences.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import InvestmentPreferences
from app.schemas import PreferencesIn, PreferencesOut

router = APIRouter(tags=["preferences"])


@router.get("/preferences", response_model=PreferencesOut)
def get_preferences(db: Session = Depends(get_db)) -> PreferencesOut | InvestmentPreferences:
    pref = (
        db.query(InvestmentPreferences)
        .filter_by(user_id=settings.default_user_id)
        .one_or_none()
    )
    if pref is None:
        return PreferencesOut()
    return pref


@router.post("/preferences", response_model=PreferencesOut)
def upsert_preferences(
    payload: PreferencesIn, db: Session = Depends(get_db)
) -> InvestmentPreferences:
    pref = (
        db.query(InvestmentPreferences)
        .filter_by(user_id=settings.default_user_id)
        .one_or_none()
    )
    if pref is None:
        pref = InvestmentPreferences(user_id=settings.default_user_id, **payload.model_dump())
        db.add(pref)
    else:
        for field, value in payload.model_dump().items():
            setattr(pref, field, value)
    db.commit()
    db.refresh(pref)
    return pref
```

Modify `backend/app/main.py`:

```python
from app.routers import analysis, backtest, chat, memory, portfolio, preferences

app = FastAPI(title="Trading Agent API")
app.include_router(portfolio.router)
app.include_router(analysis.router)
app.include_router(backtest.router)
app.include_router(memory.router)
app.include_router(chat.router)
app.include_router(preferences.router)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m pytest tests/test_preferences_router.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/preferences.py backend/app/schemas.py backend/app/main.py backend/tests/test_preferences_router.py
git commit -m "feat: add GET/POST /preferences endpoints"
```

---

## Task 3: Full suite, lint, typecheck, docs

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§4 data model, §5 API table, §15.1 step 4b)

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && uv run python -m pytest tests/ -v`
Expected: all tests pass, including the new `test_models.py` (if newly
created) and `test_preferences_router.py`.

- [ ] **Step 2: Lint and format**

Run: `cd backend && uv run ruff check . && uv run ruff format --check .`
Expected: clean. Fix any findings.

- [ ] **Step 3: Typecheck**

Run: `cd backend && uv run mypy app`
Expected: clean (strict mode).

- [ ] **Step 4: Update ARCHITECTURE.md**

- §4 (data model): add an `InvestmentPreferences` entry in the same style
  as the other model entries (`id, user_id, risk_tolerance,
  sector_avoid_list, notes, updated_at`).
- §5 (API table): add two rows — `GET /preferences` and
  `POST /preferences` — in the same style as the existing table rows.
- §15.1 step 4: mark 4b (investment preferences capture) as done,
  matching how 4a was marked done in the prior branch.

- [ ] **Step 5: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: document investment preferences capture (4b)"
```
