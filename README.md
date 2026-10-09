# Trade Agent

A personal, advisory-only trading assistant. It analyzes a portfolio and watchlist of stocks and
ETFs and produces recommendations (BUY / ADD / HOLD / TRIM / SELL / WATCH) with the reasoning
behind each. You review the recommendation, approve or dismiss it, and — if you approve — place
the trade yourself in your broker's app.

> **This system never places a trade.** No code anywhere calls a broker API to execute an order.
> Every recommendation ends in a human approval step, and approving only updates local state.

## Status

Built, merged and deployed (backend on Fly.io, frontend on Vercel, Supabase for auth and data).
Deploy, manual checks, rollback and backup restore are in [docs/RUNBOOK.md](docs/RUNBOOK.md); the
production checklist is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- **Analysis and review:** analysis agents (fundamentals gate buy/sell, technicals time entries, a
  web-search second opinion kept separate from the numbers), recommendations with approve/dismiss
  and 20-day outcomes, long-term memory, backtests with a stored equity curve, and a
  portfolio-aware chat.
- **Portfolio:** holdings, watchlist (with ISIN search and target weights), trade log and daily
  snapshots.
- **Monthly contribution planner:** enter an amount and get a plan of how much to add to each
  ticker with a target weight, from the gap to target and the pending calls. Plain arithmetic, no
  Claude call. Plans convert to EUR at plan time, can be saved, and show the target tick and the
  tickers left out with the reason. A Today drift card and an optional start-of-month Telegram
  reminder go with it.
- **Order tickets and Orders:** each saved plan line becomes copyable order text (name, optional
  ISIN, amount, about how many shares). "Placed" records that you placed it yourself and logs the
  buy; the Orders view lists every line not yet placed. Nothing is sent to a broker.
- **Notifications:** opt-in weekday Telegram message (tickers, actions and percentages only, never
  amounts), connected from Account.
- **Multi-user:** invitation-only. Supabase Auth with JWT verification, Row Level Security, an
  admin API for inviting and managing users, each user's own Claude key, per-user monthly usage
  limits, rate limits, and self-service data export and deletion.
- **Operations:** scheduled daily snapshot, outcome and analysis jobs, and a database backup
  workflow (GitHub Actions).
- **Frontend:** Today, recommendation detail, Portfolio (Holdings, This month, Saved plans,
  Orders), Track record, Backtests, Chat, Preferences, Account, and the admin screens, with light
  and dark themes and a phone-first shell with desktop layouts. The visual design is in
  [DESIGN.md](DESIGN.md).

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
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — first deploy, manual checks, rollback, backup restore and
  where each secret lives.
- [docs/superpowers/specs/](docs/superpowers/specs/) and
  [docs/superpowers/plans/](docs/superpowers/plans/) — the design spec and implementation plan
  for every build cycle, in order.

## Contributing

Personal project; not currently open to outside contributions. If that changes, `CLAUDE.md`
documents the conventions this codebase follows (Conventional Commits, branch naming, path-filtered
CI per side).
