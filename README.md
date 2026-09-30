# Trade Agent

A personal, advisory-only trading assistant. It analyzes a portfolio and watchlist of stocks and
ETFs and produces recommendations (BUY / ADD / HOLD / TRIM / SELL / WATCH) with the reasoning
behind each. You review the recommendation, approve or dismiss it, and — if you approve — place
the trade yourself in your broker's app.

> **This system never places a trade.** No code anywhere calls a broker API to execute an order.
> Every recommendation ends in a human approval step, and approving only updates local state.

## Status

Everything below is built and merged. The one screen still to come is **Chat**.

- **Backend:** multi-user, invitation-only. Supabase Auth + JWT verification, Row Level Security,
  an admin API for inviting/managing users, per-user monthly usage limits, and self-service data
  export/deletion (PRs [#21](../../pull/21), [#22](../../pull/22), [#23](../../pull/23)). The
  analysis agents, portfolio, watchlist, trade log and snapshots, recommendations with 20-day
  outcomes, backtests with a stored equity curve ([#33](../../pull/33)), long-term memory,
  per-user rate limits and bounded preferences ([#34](../../pull/34)), and scheduled daily
  snapshot and outcome jobs ([#35](../../pull/35)). The chat endpoint exists; its screen does not.
- **Frontend:** foundation ([#24](../../pull/24)), login and admin ([#27](../../pull/27)), the
  recommendation review loop ([#29](../../pull/29)), Portfolio ([#31](../../pull/31)), and the
  secondary screens ([#32](../../pull/32)) and Backtests ([#33](../../pull/33)). That is Today,
  recommendation detail and approve/dismiss, Portfolio (holdings, watchlist, "log a trade",
  value-over-time chart), Track record, Backtests, Preferences, Account (usage, export, delete my
  data), and the admin users/usage screens, with light and dark themes, a phone-first shell, and
  session-backed route protection.

## Layout

```
backend/    FastAPI + LangGraph + Postgres (pgvector) + Redis — the API and the agents
frontend/   Next.js + TypeScript + MUI — the dashboard
docs/       Design spec (ARCHITECTURE.md) and the brainstorming/spec/plan trail for every cycle
```

Each side has its own `CLAUDE.md` with its stack, commands, and conventions:
[backend/CLAUDE.md](backend/CLAUDE.md), [frontend/CLAUDE.md](frontend/CLAUDE.md). Repo-wide rules
(branch naming, commit conventions, the never-place-a-trade constraint) live in the root
[CLAUDE.md](CLAUDE.md).

## Quick start

### Backend

```bash
cd backend
uv sync                    # creates .venv, installs everything
cp .env.example .env       # add ANTHROPIC_API_KEY, SUPABASE_URL, etc.
docker compose up -d       # Postgres + Redis
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # add NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

Full setup details (Supabase project configuration, the first-admin bootstrap command, running
tests) are in each side's `CLAUDE.md`.

### Scheduled jobs

The daily portfolio snapshot and the 20-day outcome evaluation also run without anyone opening a
page, through a one-shot command that an external scheduler (cron, Task Scheduler, a Fly scheduled
machine) triggers:

```bash
cd backend
uv run python -m app.scheduled daily   # or: snapshots / outcomes
```

What it does, its exit codes, and copy-paste triggers are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §12.

## Documentation

- [PRODUCT.md](PRODUCT.md) — who this is for, what it does and doesn't do, product principles.
- [DESIGN.md](DESIGN.md) — the visual design system as built: colours, type, layout, components.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the technical design: data model, API contract,
  agent design, deployment.
- [docs/superpowers/specs/](docs/superpowers/specs/) and
  [docs/superpowers/plans/](docs/superpowers/plans/) — the design spec and implementation plan
  for every build cycle, in order.

## Contributing

Personal project; not currently open to outside contributions. If that changes, `CLAUDE.md`
documents the conventions this codebase follows (Conventional Commits, branch naming, path-filtered
CI per side).
