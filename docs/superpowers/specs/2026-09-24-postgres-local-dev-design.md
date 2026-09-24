# Local Dev Postgres Migration — Design Spec

Sub-project 3a of the long-term-memory work (ARCHITECTURE.md §15.1 step 3),
split out on its own because it's infrastructure, not a feature: long-term
memory needs `pgvector`, `pgvector` needs real Postgres, and this repo's
local dev/tests currently run on SQLite. This sub-project moves local dev
and the test suite onto Postgres with zero behavior change anywhere else,
so 3b (long-term memory) can build directly on a working `pgvector` column
without also carrying a database migration in its diff.

## Scope

In scope:
- `backend/docker-compose.yml` gains a `postgres` service
  (`pgvector/pgvector:pg16` — Postgres 16 with `pgvector` preinstalled),
  alongside the existing `redis` service.
- `backend/app/config.py`: `database_url` default switches from the SQLite
  file path to the local Postgres connection string.
- `backend/app/db.py`: drop the SQLite-specific
  `connect_args={"check_same_thread": False}` branch — Postgres needs no
  such thing, `create_engine(settings.database_url)` is enough.
- `backend/pyproject.toml`: add `psycopg[binary]` (Postgres driver) and
  `pgvector` (SQLAlchemy type integration — added now since it's this
  migration's dependency work, even though 3b is what actually uses the
  `Vector` column type).
- `backend/tests/conftest.py`: the `engine` fixture moves from a SQLite
  temp-file to a Postgres test database, same create/yield/teardown shape.
- `backend/.env.example`: `DATABASE_URL` line updated to the Postgres form.
- Re-verify both existing Alembic migrations (`527045de2906_initial_schema`,
  `5af8cb330a2c_add_backtest_results_table`) apply cleanly against Postgres.

Out of scope:
- Everything `pgvector`-specific (the actual `Vector` column, embeddings,
  similarity search, outcome tracking) — that's 3b, built after this lands.
- Supabase itself. This is a local Postgres container for dev/tests; the
  eventual Supabase-hosted Postgres (ARCHITECTURE.md §13, still a future
  deployment step) is a separate connection string swap, not new code.
- SQLite support. Dropped entirely, not kept as a fallback — one DB engine
  to maintain, matching the actual production target.

## Architecture

```
backend/docker-compose.yml   # + postgres service, named volume
backend/app/config.py        # database_url default -> postgres://...
backend/app/db.py            # drop SQLite connect_args branch
backend/tests/conftest.py    # engine fixture -> Postgres test DB
```

No new application modules — this sub-project touches only the DB
connection plumbing four files already own. Every router, model, and
service is unaffected; they all go through `SessionLocal`/`get_db`
exactly as before.

## Docker Compose

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

A named volume (`postgres_data`) so dev data survives `docker compose
restart`/host reboots, matching what a persistent local database should
do (the SQLite file it replaces already persisted on disk indefinitely).
Credentials are fixed dev-only values, consistent with this being a local
container never exposed beyond `localhost` — same trust level `.env` file
secrets already get in this project.

## Config & Connection

`backend/app/config.py`:
```python
database_url: str = "postgresql+psycopg://trading_agent:trading_agent@localhost:5432/trading_agent"
```

`backend/app/db.py`:
```python
engine = create_engine(settings.database_url)
```
(the `connect_args` conditional and its SQLite branch are deleted outright
— nothing else in this file changes.)

## Test Fixture

Two databases on the one Postgres server: `trading_agent` (dev, created by
`POSTGRES_DB`) and `trading_agent_test` (tests). A session-scoped pytest
fixture ensures the test database exists before any test runs — connects
with autocommit to the server's default `postgres` database, issues
`CREATE DATABASE trading_agent_test`, and ignores the "already exists"
error on repeat runs (no `DROP DATABASE ... IF EXISTS` dance needed; the
per-test `create_all`/`drop_all` below keeps it clean between runs).

The per-test `engine` fixture keeps today's exact shape — `create_all` →
yield → `drop_all` — just pointed at `trading_agent_test` instead of a
fresh SQLite temp file:

```python
TEST_DATABASE_URL = "postgresql+psycopg://trading_agent:trading_agent@localhost:5432/trading_agent_test"


@pytest.fixture(scope="session", autouse=True)
def _ensure_test_database() -> None:
    admin_engine = create_engine(
        "postgresql+psycopg://trading_agent:trading_agent@localhost:5432/postgres",
        isolation_level="AUTOCOMMIT",
    )
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
```

Deliberately not a transaction-per-test rollback scheme: several existing
code paths call `session.commit()` internally (routers, `agents/jobs.py`,
`backtest/jobs.py`), which breaks a naive nested-transaction fixture unless
built around `SAVEPOINT`s. `create_all`/`drop_all` per test sidesteps that
complexity entirely and keeps the fixture's diff against today's version
small — same shape, different engine underneath.

## Migration Verification

No migration content changes. Both existing migration files are plain
`op.create_table`/`op.create_index` calls with standard SQLAlchemy column
types (`Uuid`, `String`, `Numeric`, `JSON`, `DateTime`, `Date`) — nothing
SQLite-specific. This sub-project's actual work here is running
`alembic upgrade head` against the new Postgres container and confirming
it applies with no errors, not writing new migration logic.

## Testing

No new test *behavior* — the existing 80 tests are the verification. They
should pass unchanged; only the engine underneath changes. Success
criterion: `uv run python -m pytest tests/ -v` reports the same 80 passed
against Postgres that it does today against SQLite. `ruff`/`mypy` are
unaffected (no application logic changed, only `config.py`/`db.py`'s few
lines and `conftest.py`'s fixture).
