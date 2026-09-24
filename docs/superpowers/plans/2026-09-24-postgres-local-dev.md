# Local Dev Postgres Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move local dev and the test suite from SQLite onto a local Postgres+pgvector container, with zero behavior change anywhere else in the app, so the long-term-memory sub-project (3b) can build directly on a working `pgvector` column.

**Architecture:** A `postgres` service joins the existing `redis` service in `docker-compose.yml`. `config.py`'s `database_url` default switches to that container; `db.py` drops its SQLite-only connection branch. The test suite's `conftest.py` fixture keeps its exact create/yield/teardown shape, just pointed at a dedicated `trading_agent_test` Postgres database instead of a SQLite temp file. No application code (routers, models, services) changes — every one of them already goes through `SessionLocal`/`get_db`.

**Tech Stack:** `pgvector/pgvector:pg16` (Postgres 16 image with `pgvector` preinstalled), `psycopg[binary]` (driver), `pgvector` (Python package, SQLAlchemy `Vector` type — added now for 3b, unused by this plan).

**Spec:** `docs/superpowers/specs/2026-09-24-postgres-local-dev-design.md`

## Global Constraints

- Python 3.12, managed via `uv` — run tests as `uv run python -m pytest tests/ -v` from `backend/` (needs `-m pytest`, not bare `pytest`).
- `ruff check .`, `ruff format --check .`, and `mypy app` (strict) must all pass before any commit.
- **Postgres only.** SQLite support is dropped entirely, not kept as a fallback — one DB engine, no dialect-specific branching in `db.py`.
- **No behavior change.** This plan touches only DB connection plumbing (`docker-compose.yml`, `config.py`, `db.py`, `conftest.py`, `.env.example`, `pyproject.toml`). No router, model, or service file changes.
- Dev credentials are fixed values (`trading_agent`/`trading_agent`), matching the trust level `.env` secrets already get in this project — never used beyond `localhost`.
- Named volume (`postgres_data`) so dev data survives `docker compose restart`/host reboots.
- **Success criterion:** the same 80 tests that pass today against SQLite pass unchanged against Postgres — this plan adds no new test *behavior*, only a new engine underneath the existing ones.

---

### Task 1: Docker Compose Postgres service + dependencies

**Files:**
- Modify: `backend/docker-compose.yml`
- Modify: `backend/pyproject.toml`

**Interfaces:**
- Produces: a running Postgres 16 server on `localhost:5432`, database `trading_agent`, user/password `trading_agent`/`trading_agent`, with the `pgvector` extension installable via `CREATE EXTENSION IF NOT EXISTS vector`.
- Produces: `psycopg` and `pgvector` importable from the `uv` environment (consumed by Task 2's `postgresql+psycopg://` connection strings; `pgvector`'s `Vector` type is for 3b, not used in this plan).

- [ ] **Step 1: Add the `postgres` service to `backend/docker-compose.yml`**

Replace the file's contents with:
```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: trading_agent
      POSTGRES_USER: trading_agent
      POSTGRES_PASSWORD: trading_agent
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

- [ ] **Step 2: Add `psycopg[binary]` and `pgvector` to `backend/pyproject.toml`**

Change the `dependencies` list from:
```toml
dependencies = [
    "fastapi",
    "uvicorn[standard]",
    "sqlalchemy",
    "alembic",
    "pydantic",
    "pydantic-settings",
    "python-dotenv",
    "langgraph",
    "anthropic",
    "mcp",
    "yfinance",
    "redis",
]
```
to:
```toml
dependencies = [
    "fastapi",
    "uvicorn[standard]",
    "sqlalchemy",
    "alembic",
    "pydantic",
    "pydantic-settings",
    "python-dotenv",
    "langgraph",
    "anthropic",
    "mcp",
    "yfinance",
    "redis",
    "psycopg[binary]",
    "pgvector",
]
```

- [ ] **Step 3: Install dependencies**

Run (from `backend/`):
```bash
uv sync
```
Expected: resolves and installs `psycopg` and `pgvector` with no errors.

- [ ] **Step 4: Start the containers**

Run (from `backend/`):
```bash
docker compose up -d
```
Expected: `docker compose ps` shows both `redis` and `postgres` up/healthy. Postgres may take a few seconds to accept connections on first start — if Step 5 fails immediately, wait 5s and retry.

- [ ] **Step 5: Verify Postgres is reachable and `pgvector` is installable**

Run:
```bash
uv run python -c "
import psycopg
conn = psycopg.connect('postgresql://trading_agent:trading_agent@localhost:5432/trading_agent')
conn.autocommit = True
conn.execute('CREATE EXTENSION IF NOT EXISTS vector')
print('pgvector extension OK')
conn.close()
"
```
Expected: prints `pgvector extension OK` with no errors. This is the one concrete risk this task exists to retire — confirming the image genuinely ships `pgvector` before anything else depends on it.

- [ ] **Step 6: Commit**

```bash
git add backend/docker-compose.yml backend/pyproject.toml backend/uv.lock
git commit -m "Add Postgres+pgvector docker-compose service and dependencies"
```

---

### Task 2: Switch app config, db connection, and test fixture to Postgres

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/db.py`
- Modify: `backend/.env.example`
- Modify: `backend/tests/conftest.py`

**Interfaces:**
- Consumes: the running Postgres container from Task 1 (`localhost:5432`, `trading_agent`/`trading_agent`).
- Produces: `app.config.settings.database_url: str` defaulting to the Postgres connection string (unchanged name/type, only the default value changes — nothing that imports `settings.database_url` needs to change).
- Produces: `backend/tests/conftest.py`'s `engine`, `session_local`, `db_session`, `client` fixtures — same names, signatures, and yielded types as before; only their backing engine changes from a SQLite temp file to a Postgres database named `trading_agent_test`.

- [ ] **Step 1: Switch the default `database_url` — modify `backend/app/config.py`**

Change:
```python
    database_url: str = "sqlite:///./trading_agent.db"
```
to:
```python
    database_url: str = "postgresql+psycopg://trading_agent:trading_agent@localhost:5432/trading_agent"
```

- [ ] **Step 2: Drop the SQLite connection branch — modify `backend/app/db.py`**

Change:
```python
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
```
to:
```python
engine = create_engine(settings.database_url)
```

- [ ] **Step 3: Update `backend/.env.example`**

Change:
```
DATABASE_URL=sqlite:///./trading_agent.db
```
to:
```
DATABASE_URL=postgresql+psycopg://trading_agent:trading_agent@localhost:5432/trading_agent
```

- [ ] **Step 4: Rewrite the test fixture — modify `backend/tests/conftest.py`**

Replace the file's contents with:
```python
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401  registers tables on Base.metadata
import app.redis_client as redis_client_module
from app.db import Base, get_db
from app.main import app

ADMIN_DATABASE_URL = "postgresql+psycopg://trading_agent:trading_agent@localhost:5432/postgres"
TEST_DATABASE_URL = (
    "postgresql+psycopg://trading_agent:trading_agent@localhost:5432/trading_agent_test"
)


@pytest.fixture(scope="session", autouse=True)
def _ensure_test_database() -> None:
    admin_engine = create_engine(ADMIN_DATABASE_URL, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        try:
            conn.execute(text("CREATE DATABASE trading_agent_test"))
        except ProgrammingError:
            pass  # already exists from a previous run
    admin_engine.dispose()


@pytest.fixture()
def engine() -> Generator[Engine, None, None]:
    test_engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.create_all(bind=test_engine)
    yield test_engine
    Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()


@pytest.fixture()
def session_local(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def _reset_redis_client() -> Generator[None, None, None]:
    # Each test that hits real Redis via asyncio.run() gets its own event loop;
    # the cached client in app.redis_client is bound to whichever loop created it,
    # so reusing it across tests raises "Event loop is closed" on Windows.
    # Reset the singleton after every test so the next one builds a fresh client.
    yield
    redis_client_module._redis = None


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

Note what's deliberately unchanged: `session_local`, `_reset_redis_client`, `db_session`, and `client` keep their exact prior bodies — only `engine` (now Postgres-backed) and the new `_ensure_test_database` session fixture are new. No `create_all`/`drop_all`-per-test logic changed shape, only the connection string it targets.

- [ ] **Step 5: Run the full suite, verify it passes against Postgres**

Run (from `backend/`):
```bash
uv run python -m pytest tests/ -v
```
Expected: PASS — 80 passed, same count as before this plan, now running against Postgres. If `_ensure_test_database` raises something other than `ProgrammingError` on a second run (i.e. the "already exists" case isn't being caught), the fixture needs a broader except clause — check the actual exception type printed and adjust; this is the one spot in this plan with real runtime uncertainty (documented as such in the spec).

- [ ] **Step 6: Lint, format, type-check**

Run:
```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy app
```
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add backend/app/config.py backend/app/db.py backend/.env.example backend/tests/conftest.py
git commit -m "Switch database config, connection, and test fixture to Postgres"
```

---

### Task 3: Manual verification — real server against Postgres

**Files:** none (no code changes — confirms the whole local dev story end to end)

- [ ] **Step 1: Confirm containers are running**

```bash
docker compose ps
```
Expected: `redis` and `postgres` both up (from Task 1; if you stopped them since, `docker compose up -d`).

- [ ] **Step 2: Apply migrations against the fresh Postgres database**

Run (from `backend/`):
```bash
uv run alembic upgrade head
```
Expected: applies both existing migrations (`527045de2906_initial_schema`, `5af8cb330a2c_add_backtest_results_table`) with no errors — this is the concrete check that neither migration has any SQLite-specific SQL that Postgres rejects.

- [ ] **Step 3: Start the server**

```bash
uv run uvicorn app.main:app --reload
```

- [ ] **Step 4: Exercise a real request round-trip**

In a second terminal:
```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/portfolio/holdings -H "Content-Type: application/json" -d '{"ticker":"AAPL","name":"Apple","asset_type":"STOCK","shares":5,"cost_basis":150.0,"first_purchase_date":"2024-01-01"}'
curl http://localhost:8000/portfolio/holdings
```
Expected: `{"status":"ok"}`, then a 200 with the created holding, then a list containing it — proves the real app (not the test fixture) talks to the real `trading_agent` Postgres database correctly.

- [ ] **Step 5: Confirm the named volume persists data**

Stop the server (Ctrl+C), then:
```bash
docker compose restart postgres
curl http://localhost:8000/portfolio/holdings
```
(restart uvicorn first if it isn't still running)
Expected: the AAPL holding from Step 4 is still there after the Postgres container restarts — confirms the `postgres_data` volume actually persists data rather than starting fresh each time.

Report back: whether all five steps matched expectations, and the exact text of any error if `alembic upgrade head` or the round-trip didn't work as expected. No commit for this task.
