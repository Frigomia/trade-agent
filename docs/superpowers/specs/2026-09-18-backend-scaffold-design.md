# Backend Scaffold — Design Spec

Sub-project 1 of the trading agent platform (see `doc/ARCHITECTURE.md` for
the full system design). This is the first slice from the build order in
ARCHITECTURE.md §15: scaffold the FastAPI app, models, and Alembic setup;
get `/health` and portfolio CRUD running against local SQLite.

Everything else (LangGraph analysis graph, frontend, Supabase Auth, MCP
server, chat agent) depends on this existing and is out of scope here —
each gets its own spec/plan cycle later.

## Scope

In scope:
- Monorepo skeleton: root `CLAUDE.md` (navigational), `.gitignore`, git init
- `backend/` app: FastAPI, SQLAlchemy models, Alembic migrations, SQLite
  local dev
- `/health` endpoint
- Portfolio CRUD endpoints (`/portfolio/holdings`, `/portfolio/watchlist`,
  `/portfolio/trades`) per ARCHITECTURE.md §5
- `Recommendation` and `ChatMessage` tables scaffolded in `models.py` and
  the initial migration (schema settled once), but no routes for them
- Unit tests for every endpoint

Out of scope (later sub-projects):
- `frontend/`, `.github/workflows/` — not created yet
- LangGraph analysis graph, `/analysis/*` routes, `/chat` route
- Supabase Auth, JWT verification, Row Level Security policies
- MCP server, Claude Skill repo
- Redis caching/job queue (dependency pinned, not wired up)

## Repo structure

```
trade-agent/
  CLAUDE.md                  root, navigational only
  .gitignore
  doc/ARCHITECTURE.md        (existing)
  docs/superpowers/specs/     (this file)
  backend/
    CLAUDE.md                 backend conventions
    requirements.txt
    .env.example
    alembic.ini
    migrations/                alembic env + versions/
    app/
      __init__.py
      main.py                  FastAPI app, mounts routers, /health
      config.py                pydantic-settings: DATABASE_URL,
                                 DEFAULT_USER_ID, risk thresholds (§11)
      db.py                    engine/session factory, declarative Base
      models.py                Holding, WatchlistItem, Trade,
                                 Recommendation, ChatMessage (§4)
      schemas.py                Pydantic In/Out models
      routers/
        __init__.py
        portfolio.py            holdings + watchlist + trades endpoints
    tests/
      conftest.py                TestClient + temp-SQLite-file fixture
      test_health.py
      test_portfolio.py
```

## Data model

Models match ARCHITECTURE.md §4 exactly (`Holding`, `WatchlistItem`,
`Trade`, `Recommendation`, `ChatMessage`), each carrying `user_id`.

**No auth exists yet in this slice.** `user_id` is a Postgres/SQLite
`UUID`/`CHAR(36)` column, `nullable=False`, stamped on every write from a
single hardcoded constant: `settings.DEFAULT_USER_ID` (a fixed UUID
literal in `config.py`, overridable via env var of the same name). This
keeps the column NOT NULL from the very first migration — the real value
swaps in once Supabase Auth issues the actual user UUID in the auth
sub-project (ARCHITECTURE.md §13); no schema change needed then, just a
different value populating the same column.

Row Level Security is explicitly **not** part of this slice — RLS is a
Postgres feature tied to `auth.uid()`, which doesn't exist without
Supabase Auth wired up. SQLite has no RLS equivalent. RLS policies land in
the auth sub-project alongside the Postgres migration, per ARCHITECTURE.md
§4 and the pre-launch checklist item "RLS enabled and a policy created in
the same migration per table."

## Migrations

Alembic, per ARCHITECTURE.md §4:
```bash
alembic init migrations
# env.py imports Base from app.db, sets target_metadata
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```
One initial migration creating all five tables. No RLS `op.execute()`
calls in this migration (out of scope, see above).

## API surface (this slice)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/health` | — | Liveness check |
| GET | `/portfolio/holdings` | — | List holdings for `DEFAULT_USER_ID` |
| POST | `/portfolio/holdings` | `HoldingIn` | Upsert by ticker |
| DELETE | `/portfolio/holdings/{ticker}` | — | 404 if not found |
| GET | `/portfolio/watchlist` | — | |
| POST | `/portfolio/watchlist` | `WatchlistItemIn` | Upsert by ticker |
| POST | `/portfolio/trades` | `TradeIn` | Logs a trade; updates holding shares/cost basis |

All other endpoints in ARCHITECTURE.md §5 (`/analysis/*`, `/chat`) are
later sub-projects.

## Data flow

Client → FastAPI router → SQLAlchemy session (SQLite file via
`DATABASE_URL`) → response. Every write stamps `user_id =
settings.DEFAULT_USER_ID`. Upsert-by-ticker on POST holdings/watchlist:
query by `(user_id, ticker)`, update if found else insert.

## Error handling

FastAPI defaults only — no external calls exist in this slice, so there's
nothing exotic to handle:
- 404 on DELETE of an unknown ticker
- 422 automatic from Pydantic validation on malformed bodies

## Configuration

`backend/.env.example`:
```
DATABASE_URL=sqlite:///./trading_agent.db
DEFAULT_USER_ID=00000000-0000-0000-0000-000000000001
```
Risk-profile thresholds from ARCHITECTURE.md §11
(`max_single_position_pct`, `rsi_oversold`, `fundamental_buy_threshold`)
are defined in `config.py` with defaults now even though nothing consumes
them yet — they belong to the analysis sub-project, but the settings
object is one file and cheap to extend now vs. later.

## Dependencies

`backend/requirements.txt` pins the full eventual stack now (per explicit
choice, not deferred): `fastapi`, `uvicorn[standard]`, `sqlalchemy`,
`alembic`, `pydantic`, `pydantic-settings`, `python-dotenv`, `langgraph`,
`anthropic`, `mcp`, `yfinance`, `redis`, `pytest`, `httpx`.

Only `fastapi`, `uvicorn`, `sqlalchemy`, `alembic`, `pydantic*`,
`python-dotenv`, `pytest`, `httpx` are actually imported by code in this
slice. The rest sit unused until their sub-projects land — a deliberate
choice to pin versions once rather than incrementally.

## Testing

pytest + FastAPI `TestClient`. `conftest.py` fixture creates a temp SQLite
file per test session, overrides the `get_db` dependency, tears down after.
One test per endpoint: health check returns 200; holdings
create/list/upsert-by-ticker/delete; watchlist create/list/upsert; trade
log updates holding shares/cost basis. No mocking needed — nothing in this
slice calls an external service.

## Non-goals (explicit, matching ARCHITECTURE.md §14/§16)

- No authentication — every request acts as `DEFAULT_USER_ID`. Not for
  public deployment as-is; blocking item is the auth sub-project.
- No rate limiting, no CORS hardening — local dev only at this stage.
- No Redis usage yet despite the dependency being pinned.
