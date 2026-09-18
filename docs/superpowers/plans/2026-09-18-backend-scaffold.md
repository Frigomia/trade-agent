# Backend Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the FastAPI backend skeleton — app, SQLAlchemy models, Alembic migrations, `/health`, and full portfolio CRUD (`holdings`, `watchlist`, `trades`) — running against local SQLite, with no auth and no RLS yet.

**Architecture:** A single FastAPI app (`backend/app/main.py`) backed by SQLAlchemy 2.0 models and Alembic migrations. Every query is scoped to a hardcoded `DEFAULT_USER_ID` placeholder (no real auth in this slice). Portfolio endpoints upsert by `(user_id, ticker)`. `Recommendation` and `ChatMessage` tables are created now but have no routes yet — those arrive with the analysis/chat sub-projects.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 (`Mapped`/`mapped_column`), Alembic, Pydantic v2 / pydantic-settings, SQLite (local), pytest + `TestClient`.

**Spec:** `docs/superpowers/specs/2026-09-18-backend-scaffold-design.md`

## Global Constraints

- Python 3.12.
- SQLAlchemy 2.0 declarative style only (`Mapped`, `mapped_column`) — never the legacy `Column(...)` API.
- Every DB query/write is scoped to `settings.default_user_id` — no real auth exists in this slice.
- No Row Level Security, no JWT verification, no CORS/rate-limit hardening — explicitly out of scope (spec §Non-goals).
- Tests run from `backend/` via `python -m pytest tests/ -v` (use `-m pytest`, not bare `pytest`, so `backend/` — the cwd — lands on `sys.path` and `import app...` resolves).
- Commit after every task's tests pass.

---

### Task 1: Project skeleton, config, DB session, `/health`

**Files:**
- Create: `.gitignore`
- Create: `CLAUDE.md`
- Create: `backend/CLAUDE.md`
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`
- Create: `backend/app/__init__.py`
- Create: `backend/app/config.py`
- Create: `backend/app/db.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/conftest.py`
- Test: `backend/tests/test_health.py`

**Interfaces:**
- Produces: `app.config.settings` (`Settings` instance — `.database_url: str`, `.default_user_id: UUID`, `.max_single_position_pct: float`, `.rsi_oversold: float`, `.fundamental_buy_threshold: float`)
- Produces: `app.db.Base` (SQLAlchemy `DeclarativeBase` subclass), `app.db.get_db` (FastAPI dependency, yields `Session`)
- Produces: `app.main.app` (FastAPI instance)
- Produces: `tests/conftest.py` fixtures `engine` (SQLAlchemy `Engine`, temp SQLite file, tables created) and `client` (`TestClient`, `get_db` overridden to use `engine`)

- [ ] **Step 1: Create `.gitignore`**

```
.venv/
__pycache__/
*.pyc
.env
*.db
.pytest_cache/
node_modules/
.next/
```

- [ ] **Step 2: Create root `CLAUDE.md`**

```markdown
# Trading Agent Platform

Navigational guide for Claude Code. Design spec: `docs/ARCHITECTURE.md`.

## Layout

- `backend/` — FastAPI + LangGraph + MCP server. See `backend/CLAUDE.md`.
- `frontend/` — Next.js dashboard (not yet scaffolded).
- `docs/superpowers/specs/` — design specs, one per sub-project.
- `docs/superpowers/plans/` — implementation plans, one per sub-project.

## Rules

- This system never places trades — every recommendation ends in a human
  approval step; the human executes manually in Trade Republic's app.
- Every DB table carries `user_id`, even single-user — required for Row
  Level Security once Supabase Auth lands.
```

- [ ] **Step 3: Create `backend/CLAUDE.md`**

```markdown
# Backend — Claude Code Conventions

FastAPI + SQLAlchemy + Alembic. Design spec: `../docs/ARCHITECTURE.md` §3-5, §11.

## Commands

    python -m venv .venv && source .venv/bin/activate   # .venv\Scripts\activate on Windows
    pip install -r requirements.txt
    cp .env.example .env
    alembic upgrade head
    uvicorn app.main:app --reload
    python -m pytest tests/ -v

## Conventions

- SQLAlchemy 2.0 style (`Mapped`, `mapped_column`), never the legacy `Column` API.
- Every query filters by `settings.default_user_id` — no auth yet, this is
  the placeholder single-user boundary.
- Pydantic v2 schemas in `app/schemas.py`; one `*In`/`*Out` pair per resource.
- New model field → `alembic revision --autogenerate -m "..."`, review the
  generated migration before applying.
```

- [ ] **Step 4: Create `backend/requirements.txt`**

```
fastapi
uvicorn[standard]
sqlalchemy
alembic
pydantic
pydantic-settings
python-dotenv
langgraph
anthropic
mcp
yfinance
redis
pytest
httpx
```

- [ ] **Step 5: Create venv and install dependencies**

Run (from `backend/`):
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```
Expected: install completes with no errors.

- [ ] **Step 6: Create `backend/.env.example`**

```
DATABASE_URL=sqlite:///./trading_agent.db
DEFAULT_USER_ID=00000000-0000-0000-0000-000000000001
```

- [ ] **Step 7: Create `backend/app/__init__.py`** (empty file)

- [ ] **Step 8: Create `backend/app/config.py`**

```python
from uuid import UUID

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./trading_agent.db"
    default_user_id: UUID = UUID("00000000-0000-0000-0000-000000000001")

    max_single_position_pct: float = 0.15
    rsi_oversold: float = 30.0
    fundamental_buy_threshold: float = 60.0


settings = Settings()
```

- [ ] **Step 9: Create `backend/app/db.py`**

```python
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

connect_args = (
    {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
)
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 10: Create `backend/app/main.py`** (stub — `/health` added in Step 14)

```python
from fastapi import FastAPI

app = FastAPI(title="Trading Agent API")
```

- [ ] **Step 11: Create `backend/tests/conftest.py`**

```python
import os
import tempfile
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base, get_db
from app.main import app


@pytest.fixture()
def engine() -> Generator[Engine, None, None]:
    db_fd, db_path = tempfile.mkstemp(suffix=".db")
    test_engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=test_engine)
    yield test_engine
    test_engine.dispose()
    os.close(db_fd)
    os.remove(db_path)


@pytest.fixture()
def client(engine: Engine) -> Generator[TestClient, None, None]:
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
```

- [ ] **Step 12: Write the failing test — `backend/tests/test_health.py`**

```python
def test_health_returns_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 13: Run test, verify it fails**

Run: `python -m pytest tests/test_health.py -v` (from `backend/`)
Expected: FAIL — 404, `/health` doesn't exist yet.

- [ ] **Step 14: Add the `/health` route — modify `backend/app/main.py`**

```python
from fastapi import FastAPI

app = FastAPI(title="Trading Agent API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 15: Run test, verify it passes**

Run: `python -m pytest tests/test_health.py -v`
Expected: PASS

- [ ] **Step 16: Commit**

```bash
git add .gitignore CLAUDE.md backend/CLAUDE.md backend/requirements.txt backend/.env.example backend/app/__init__.py backend/app/config.py backend/app/db.py backend/app/main.py backend/tests/conftest.py backend/tests/test_health.py
git commit -m "Scaffold FastAPI app, config, DB session, and /health"
```

---

### Task 2: SQLAlchemy models + Alembic migrations

**Files:**
- Create: `backend/app/models.py`
- Modify: `backend/tests/conftest.py`
- Test: `backend/tests/test_models.py`
- Create: `backend/alembic.ini` (via `alembic init`)
- Create: `backend/migrations/env.py` (via `alembic init`, then edited)
- Create: `backend/migrations/versions/<generated>_initial_schema.py` (via `alembic revision --autogenerate`)

**Interfaces:**
- Consumes: `app.db.Base` (Task 1)
- Produces: `app.models.Holding`, `app.models.WatchlistItem`, `app.models.Trade`, `app.models.Recommendation`, `app.models.ChatMessage` (all SQLAlchemy model classes, all with `id: int`, `user_id: UUID`)
- Produces: `tests/conftest.py` fixture `db_session` (raw SQLAlchemy `Session`, same temp DB as `client`)

- [ ] **Step 1: Write the failing test — `backend/tests/test_models.py`**

```python
import uuid
from datetime import date

from app.models import ChatMessage, Holding, Recommendation, Trade, WatchlistItem


def test_holding_roundtrip(db_session):
    holding = Holding(
        user_id=uuid.uuid4(),
        ticker="VWCE",
        name="Vanguard FTSE All-World",
        asset_type="ETF",
        shares=10,
        cost_basis=95.5,
        first_purchase_date=date(2024, 1, 15),
    )
    db_session.add(holding)
    db_session.commit()

    fetched = db_session.query(Holding).filter_by(ticker="VWCE").one()
    assert fetched.asset_type == "ETF"
    assert float(fetched.shares) == 10


def test_watchlist_item_roundtrip(db_session):
    item = WatchlistItem(user_id=uuid.uuid4(), ticker="NVDA", asset_type="STOCK")
    db_session.add(item)
    db_session.commit()

    fetched = db_session.query(WatchlistItem).filter_by(ticker="NVDA").one()
    assert fetched.note is None


def test_trade_roundtrip(db_session):
    trade = Trade(
        user_id=uuid.uuid4(),
        date=date(2024, 2, 1),
        ticker="VWCE",
        action="BUY",
        shares=5,
        price=97.2,
    )
    db_session.add(trade)
    db_session.commit()

    fetched = db_session.query(Trade).filter_by(ticker="VWCE").one()
    assert fetched.action == "BUY"


def test_recommendation_roundtrip(db_session):
    rec = Recommendation(
        user_id=uuid.uuid4(),
        ticker="VWCE",
        asset_type="ETF",
        action="HOLD",
        reasoning=["trend is up", "valuation fair"],
    )
    db_session.add(rec)
    db_session.commit()

    fetched = db_session.query(Recommendation).filter_by(ticker="VWCE").one()
    assert fetched.status == "PENDING"
    assert fetched.reasoning == ["trend is up", "valuation fair"]


def test_chat_message_roundtrip(db_session):
    msg = ChatMessage(
        user_id=uuid.uuid4(),
        session_id="sess-1",
        role="user",
        content="How is my portfolio doing?",
    )
    db_session.add(msg)
    db_session.commit()

    fetched = db_session.query(ChatMessage).filter_by(session_id="sess-1").one()
    assert fetched.role == "user"
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python -m pytest tests/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models'` (and `db_session` fixture doesn't exist yet either).

- [ ] **Step 3: Update `backend/tests/conftest.py` to add the `db_session` fixture and register models**

Replace the full file with:

```python
import os
import tempfile
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401  registers tables on Base.metadata
from app.db import Base, get_db
from app.main import app


@pytest.fixture()
def engine() -> Generator[Engine, None, None]:
    db_fd, db_path = tempfile.mkstemp(suffix=".db")
    test_engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=test_engine)
    yield test_engine
    test_engine.dispose()
    os.close(db_fd)
    os.remove(db_path)


@pytest.fixture()
def db_session(engine: Engine) -> Generator[Session, None, None]:
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = testing_session_local()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(engine: Engine) -> Generator[TestClient, None, None]:
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
```

- [ ] **Step 4: Create `backend/app/models.py`**

```python
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Numeric, String, Text, Uuid, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (UniqueConstraint("user_id", "ticker", name="uq_holdings_user_ticker"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    ticker: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    asset_type: Mapped[str] = mapped_column(String(10))  # "ETF" | "STOCK"
    shares: Mapped[float] = mapped_column(Numeric(18, 6))
    cost_basis: Mapped[float] = mapped_column(Numeric(18, 6))
    first_purchase_date: Mapped[date] = mapped_column(Date)
    target_weight: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    sector: Mapped[str | None] = mapped_column(String(100), nullable=True)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (UniqueConstraint("user_id", "ticker", name="uq_watchlist_user_ticker"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    ticker: Mapped[str] = mapped_column(String(20))
    asset_type: Mapped[str] = mapped_column(String(10))
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    date: Mapped[date] = mapped_column(Date)
    ticker: Mapped[str] = mapped_column(String(20))
    action: Mapped[str] = mapped_column(String(4))  # "BUY" | "SELL"
    shares: Mapped[float] = mapped_column(Numeric(18, 6))
    price: Mapped[float] = mapped_column(Numeric(18, 6))


class Recommendation(Base):
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ticker: Mapped[str] = mapped_column(String(20))
    asset_type: Mapped[str] = mapped_column(String(10))
    action: Mapped[str] = mapped_column(String(6))  # BUY|ADD|HOLD|TRIM|SELL|WATCH
    reasoning: Mapped[list[str]] = mapped_column(JSON)
    ai_analysis: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggested_position_pct: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="PENDING")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    session_id: Mapped[str] = mapped_column(String(100), index=True)
    role: Mapped[str] = mapped_column(String(10))  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text)
```

- [ ] **Step 5: Run test, verify it passes**

Run: `python -m pytest tests/test_models.py -v`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit models + tests**

```bash
git add backend/app/models.py backend/tests/conftest.py backend/tests/test_models.py
git commit -m "Add SQLAlchemy models for portfolio, trades, recommendations, chat"
```

- [ ] **Step 7: Initialize Alembic**

Run (from `backend/`):
```bash
alembic init migrations
```
Expected: creates `alembic.ini`, `migrations/env.py`, `migrations/script.py.mako`, `migrations/versions/`.

- [ ] **Step 8: Edit `backend/migrations/env.py`**

At the very top of the file, before any other imports (the `alembic` console
script doesn't put `backend/` on `sys.path` the way `python -m` does, so
without this `import app...` below fails with `ModuleNotFoundError`), add:
```python
import os
import sys

sys.path.insert(0, os.getcwd())
```
Then, after the existing imports, add:
```python
import app.models  # noqa: F401  registers tables on Base.metadata
from app.db import Base
from app.config import settings
```
Find the line `target_metadata = None` and replace it with:
```python
target_metadata = Base.metadata
```
Find the `run_migrations_offline` / `run_migrations_online` setup where `config.get_main_option("sqlalchemy.url")` is used, and above it add:
```python
config.set_main_option("sqlalchemy.url", settings.database_url)
```

- [ ] **Step 9: Generate the initial migration**

Run (from `backend/`):
```bash
alembic revision --autogenerate -m "initial schema"
```
Expected: creates one file under `migrations/versions/` with `upgrade()`/`downgrade()` creating the 5 tables.

- [ ] **Step 10: Apply the migration**

Run:
```bash
alembic upgrade head
```
Expected: exits with no error, creates `trading_agent.db`.

- [ ] **Step 11: Verify the tables exist**

Run:
```bash
python -c "import sqlite3; con = sqlite3.connect('trading_agent.db'); print(sorted(r[0] for r in con.execute(\"select name from sqlite_master where type='table' and name not like 'alembic%'\")))"
```
Expected: `['chat_messages', 'holdings', 'recommendations', 'trades', 'watchlist_items']`

- [ ] **Step 12: Commit Alembic setup**

```bash
git add backend/alembic.ini backend/migrations
git commit -m "Add Alembic migrations, initial schema"
```

---

### Task 3: Holdings endpoints

**Files:**
- Create: `backend/app/schemas.py`
- Create: `backend/app/routers/__init__.py`
- Create: `backend/app/routers/portfolio.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_portfolio.py`

**Interfaces:**
- Consumes: `app.models.Holding` (Task 2), `app.config.settings`, `app.db.get_db` (Task 1)
- Produces: `app.schemas.HoldingIn`, `app.schemas.HoldingOut` (Pydantic models)
- Produces: `app.routers.portfolio.router` (FastAPI `APIRouter`, prefix `/portfolio`) — later tasks add routes to this same router

- [ ] **Step 1: Write the failing tests — `backend/tests/test_portfolio.py`**

```python
def test_list_holdings_empty(client):
    response = client.get("/portfolio/holdings")
    assert response.status_code == 200
    assert response.json() == []


def test_create_and_list_holding(client):
    payload = {
        "ticker": "VWCE",
        "name": "Vanguard FTSE All-World",
        "asset_type": "ETF",
        "shares": 10,
        "cost_basis": 95.5,
        "first_purchase_date": "2024-01-15",
    }
    response = client.post("/portfolio/holdings", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["ticker"] == "VWCE"
    assert body["shares"] == 10

    response = client.get("/portfolio/holdings")
    assert len(response.json()) == 1


def test_upsert_holding_updates_existing(client):
    payload = {
        "ticker": "VWCE",
        "name": "Vanguard FTSE All-World",
        "asset_type": "ETF",
        "shares": 10,
        "cost_basis": 95.5,
        "first_purchase_date": "2024-01-15",
    }
    client.post("/portfolio/holdings", json=payload)

    payload["shares"] = 15
    response = client.post("/portfolio/holdings", json=payload)
    assert response.json()["shares"] == 15

    response = client.get("/portfolio/holdings")
    assert len(response.json()) == 1


def test_delete_holding(client):
    payload = {
        "ticker": "VWCE",
        "name": "Vanguard FTSE All-World",
        "asset_type": "ETF",
        "shares": 10,
        "cost_basis": 95.5,
        "first_purchase_date": "2024-01-15",
    }
    client.post("/portfolio/holdings", json=payload)

    response = client.delete("/portfolio/holdings/VWCE")
    assert response.status_code == 204

    response = client.get("/portfolio/holdings")
    assert response.json() == []


def test_delete_missing_holding_returns_404(client):
    response = client.delete("/portfolio/holdings/NOPE")
    assert response.status_code == 404
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python -m pytest tests/test_portfolio.py -v`
Expected: FAIL — 404, no `/portfolio/holdings` route mounted yet.

- [ ] **Step 3: Create `backend/app/schemas.py`**

```python
from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class HoldingIn(BaseModel):
    ticker: str
    name: str
    asset_type: str
    shares: float
    cost_basis: float
    first_purchase_date: date
    target_weight: float | None = None
    sector: str | None = None


class HoldingOut(HoldingIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID
```

- [ ] **Step 4: Create `backend/app/routers/__init__.py`** (empty file)

- [ ] **Step 5: Create `backend/app/routers/portfolio.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Holding
from app.schemas import HoldingIn, HoldingOut

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


@router.get("/holdings", response_model=list[HoldingOut])
def list_holdings(db: Session = Depends(get_db)) -> list[Holding]:
    return db.query(Holding).filter_by(user_id=settings.default_user_id).all()


@router.post("/holdings", response_model=HoldingOut)
def upsert_holding(payload: HoldingIn, db: Session = Depends(get_db)) -> Holding:
    holding = (
        db.query(Holding)
        .filter_by(user_id=settings.default_user_id, ticker=payload.ticker)
        .one_or_none()
    )
    if holding is None:
        holding = Holding(user_id=settings.default_user_id, **payload.model_dump())
        db.add(holding)
    else:
        for field, value in payload.model_dump().items():
            setattr(holding, field, value)
    db.commit()
    db.refresh(holding)
    return holding


@router.delete("/holdings/{ticker}", status_code=204)
def delete_holding(ticker: str, db: Session = Depends(get_db)) -> None:
    holding = (
        db.query(Holding)
        .filter_by(user_id=settings.default_user_id, ticker=ticker)
        .one_or_none()
    )
    if holding is None:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(holding)
    db.commit()
```

- [ ] **Step 6: Mount the router — modify `backend/app/main.py`**

```python
from fastapi import FastAPI

from app.routers import portfolio

app = FastAPI(title="Trading Agent API")
app.include_router(portfolio.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 7: Run tests, verify they pass**

Run: `python -m pytest tests/test_portfolio.py -v`
Expected: PASS (5 tests)

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/__init__.py backend/app/routers/portfolio.py backend/app/main.py backend/tests/test_portfolio.py
git commit -m "Add holdings CRUD endpoints"
```

---

### Task 4: Watchlist endpoints

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/portfolio.py`
- Modify: `backend/tests/test_portfolio.py`

**Interfaces:**
- Consumes: `app.models.WatchlistItem` (Task 2), `router` from Task 3
- Produces: `app.schemas.WatchlistItemIn`, `app.schemas.WatchlistItemOut`

- [ ] **Step 1: Write the failing tests — append to `backend/tests/test_portfolio.py`**

```python
def test_list_watchlist_empty(client):
    response = client.get("/portfolio/watchlist")
    assert response.status_code == 200
    assert response.json() == []


def test_create_and_upsert_watchlist_item(client):
    payload = {"ticker": "NVDA", "asset_type": "STOCK", "note": "watching earnings"}
    response = client.post("/portfolio/watchlist", json=payload)
    assert response.status_code == 200
    assert response.json()["note"] == "watching earnings"

    payload["note"] = "still watching"
    response = client.post("/portfolio/watchlist", json=payload)
    assert response.json()["note"] == "still watching"

    response = client.get("/portfolio/watchlist")
    assert len(response.json()) == 1
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python -m pytest tests/test_portfolio.py -v -k watchlist`
Expected: FAIL — 404, no `/portfolio/watchlist` route yet.

- [ ] **Step 3: Add `WatchlistItemIn`/`WatchlistItemOut` — append to `backend/app/schemas.py`**

```python
class WatchlistItemIn(BaseModel):
    ticker: str
    asset_type: str
    note: str | None = None


class WatchlistItemOut(WatchlistItemIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID
```

- [ ] **Step 4: Add watchlist routes — modify `backend/app/routers/portfolio.py`**

Change the model/schema imports at the top to:
```python
from app.models import Holding, WatchlistItem
from app.schemas import HoldingIn, HoldingOut, WatchlistItemIn, WatchlistItemOut
```
Append at the end of the file:
```python
@router.get("/watchlist", response_model=list[WatchlistItemOut])
def list_watchlist(db: Session = Depends(get_db)) -> list[WatchlistItem]:
    return db.query(WatchlistItem).filter_by(user_id=settings.default_user_id).all()


@router.post("/watchlist", response_model=WatchlistItemOut)
def upsert_watchlist_item(
    payload: WatchlistItemIn, db: Session = Depends(get_db)
) -> WatchlistItem:
    item = (
        db.query(WatchlistItem)
        .filter_by(user_id=settings.default_user_id, ticker=payload.ticker)
        .one_or_none()
    )
    if item is None:
        item = WatchlistItem(user_id=settings.default_user_id, **payload.model_dump())
        db.add(item)
    else:
        for field, value in payload.model_dump().items():
            setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `python -m pytest tests/test_portfolio.py -v`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/portfolio.py backend/tests/test_portfolio.py
git commit -m "Add watchlist endpoints"
```

---

### Task 5: Trade logging endpoint

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/portfolio.py`
- Modify: `backend/tests/test_portfolio.py`

**Interfaces:**
- Consumes: `app.models.Trade`, `app.models.Holding` (Task 2), `router` from Task 3
- Produces: `app.schemas.TradeIn`, `app.schemas.TradeOut`

**Behavior clarification (not fully specified in the design doc):** a Trade can only be logged against a ticker that already has a `Holding` — `POST /portfolio/trades` returns 404 if none exists. `TradeIn` has no `name`/`asset_type` fields, so there isn't enough data to create a `Holding` from a trade alone; the intended flow is `POST /portfolio/holdings` first (to establish the position), then `POST /portfolio/trades` to log subsequent buys/sells against it. On `BUY`, `cost_basis` is recalculated as the weighted average; on `SELL`, only `shares` decreases (no lot tracking).

- [ ] **Step 1: Write the failing tests — append to `backend/tests/test_portfolio.py`**

```python
def test_log_trade_buy_updates_holding_cost_basis(client):
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": "VWCE",
            "name": "Vanguard FTSE All-World",
            "asset_type": "ETF",
            "shares": 10,
            "cost_basis": 90.0,
            "first_purchase_date": "2024-01-15",
        },
    )

    response = client.post(
        "/portfolio/trades",
        json={"date": "2024-03-01", "ticker": "VWCE", "action": "BUY", "shares": 10, "price": 100.0},
    )
    assert response.status_code == 200

    holdings = client.get("/portfolio/holdings").json()
    assert holdings[0]["shares"] == 20
    assert holdings[0]["cost_basis"] == 95.0


def test_log_trade_sell_reduces_shares(client):
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": "VWCE",
            "name": "Vanguard FTSE All-World",
            "asset_type": "ETF",
            "shares": 10,
            "cost_basis": 90.0,
            "first_purchase_date": "2024-01-15",
        },
    )

    response = client.post(
        "/portfolio/trades",
        json={"date": "2024-03-01", "ticker": "VWCE", "action": "SELL", "shares": 4, "price": 105.0},
    )
    assert response.status_code == 200

    holdings = client.get("/portfolio/holdings").json()
    assert holdings[0]["shares"] == 6


def test_log_trade_missing_holding_returns_404(client):
    response = client.post(
        "/portfolio/trades",
        json={"date": "2024-03-01", "ticker": "NOPE", "action": "BUY", "shares": 1, "price": 1.0},
    )
    assert response.status_code == 404
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python -m pytest tests/test_portfolio.py -v -k trade`
Expected: FAIL — 404, no `/portfolio/trades` route yet.

- [ ] **Step 3: Add `TradeIn`/`TradeOut` — append to `backend/app/schemas.py`**

```python
class TradeIn(BaseModel):
    date: date
    ticker: str
    action: str
    shares: float
    price: float


class TradeOut(TradeIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID
```

- [ ] **Step 4: Add the trade route — modify `backend/app/routers/portfolio.py`**

Change the model/schema imports at the top to:
```python
from app.models import Holding, Trade, WatchlistItem
from app.schemas import (
    HoldingIn,
    HoldingOut,
    TradeIn,
    TradeOut,
    WatchlistItemIn,
    WatchlistItemOut,
)
```
Append at the end of the file:
```python
@router.post("/trades", response_model=TradeOut)
def log_trade(payload: TradeIn, db: Session = Depends(get_db)) -> Trade:
    holding = (
        db.query(Holding)
        .filter_by(user_id=settings.default_user_id, ticker=payload.ticker)
        .one_or_none()
    )
    if holding is None:
        raise HTTPException(
            status_code=404,
            detail=f"No holding for {payload.ticker}; add it via POST /portfolio/holdings first",
        )

    if payload.action == "BUY":
        total_cost = float(holding.shares) * float(holding.cost_basis) + payload.shares * payload.price
        holding.shares = float(holding.shares) + payload.shares
        holding.cost_basis = total_cost / float(holding.shares)
    elif payload.action == "SELL":
        holding.shares = float(holding.shares) - payload.shares
    else:
        raise HTTPException(status_code=422, detail="action must be BUY or SELL")

    trade = Trade(user_id=settings.default_user_id, **payload.model_dump())
    db.add(trade)
    db.commit()
    db.refresh(trade)
    return trade
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `python -m pytest tests/ -v`
Expected: PASS (all tests in the suite — health, models, portfolio)

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/portfolio.py backend/tests/test_portfolio.py
git commit -m "Add trade logging endpoint"
```
