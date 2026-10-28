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
  and 20-trading-day outcomes, long-term memory, backtests with a stored equity curve, and a
  portfolio-aware chat.
- **Portfolio:** holdings, trade log and daily snapshots. The companies you watch are on Discover.
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
  Orders), Track record, Signal backtest, Chat, Preferences, Account, and the admin screens, with light
  and dark themes and a phone-first shell with desktop layouts. The visual design is in
  [DESIGN.md](DESIGN.md).

## Layout

```
backend/    FastAPI + LangGraph + Postgres (pgvector) + Redis — the API and the agents
frontend/   Next.js + TypeScript + MUI — the dashboard
docs/       Design spec (ARCHITECTURE.md) and the brainstorming/spec/plan trail for every cycle
```

Each side has its own `AGENTS.md` with its stack, commands, and conventions:
[backend/AGENTS.md](backend/AGENTS.md), [frontend/AGENTS.md](frontend/AGENTS.md). Repo-wide rules
(branch naming, commit conventions, the never-place-a-trade constraint) live in the root
[AGENTS.md](AGENTS.md). Claude Code imports the same rules through its `CLAUDE.md` files.
The [agent workflow](docs/AGENT_WORKFLOW.md) covers the vendored Ponytail skills, migration
protection, Ruff and required reviews for Codex, Claude Code and instruction-only agents.

## Quick start

Local setup, in order. You need Docker, [uv](https://docs.astral.sh/uv/), Node.js, and a Supabase
project (the free tier is enough): Supabase Auth holds the sign-ins, so there is no login without
one.

### 1. Supabase

1. Create a project at supabase.com.
2. Under Authentication, use asymmetric JWT signing keys (the backend does not verify the old
   shared-secret tokens).
3. Note the project URL, the publishable (anon) key, and the secret key. The secret key is for the
   backend only and never goes in the frontend.

### 2. Backend

```bash
cd backend
uv sync                    # creates .venv, installs everything
cp .env.example .env       # then fill in the values below
docker compose up -d       # Postgres + Redis
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

In `backend/.env`, set at least `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `ANTHROPIC_API_KEY`.
Also set `MIGRATION_DATABASE_URL` to the same value as `DATABASE_URL`: the first-admin command
below refuses to run without it.

**The database needs no setup.** `docker compose up -d` starts Postgres with user, password and
database all named `trading_agent`, and `.env.example` already holds the matching
`DATABASE_URL`. If your `.env` is older than that line, copy it over by hand.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev                  # http://localhost:3000
```

`NEXT_PUBLIC_API_URL` is already `http://localhost:8000` in the example.

Optionally set `NEXT_PUBLIC_LOGO_DEV_TOKEN` to a Logo.dev CDN publishable key (`pk_`) for company
logos. Without it, or when a logo is unavailable, the app shows company initials. Set this variable
in your deployment provider before building too; Next.js embeds public variables at build time.
Logos load through the app's own signed-in `/api/logo/<ticker>` route, not from the browser: Logo.dev
sees this server's requests (cached for a day and shared by all users), so a person's IP address,
browser and the tickers they hold or watch are not tied to them. Logo.dev still learns which tickers
the app asks for, never share counts or account identifiers. Leave the token unset to keep initials
and make no requests at all.
The public sign-in page includes the [Logo.dev attribution link](https://www.logo.dev/docs/platform/attribution).
For commercial use on the free plan, submit that production page's URL in the Logo.dev dashboard.

### 4. Create the first admin

A new local database is empty, so nobody can sign in until an admin exists. Sign-ins live in
Supabase, but a user's role and status live in the `app_users` table of the database the backend
uses, so this is done once per environment:

1. In the Supabase dashboard, under Authentication, Users, add your user and copy its uid.
2. From `backend/`:

   ```bash
   uv run python -m app.auth.bootstrap_admin <email> <supabase-uid>
   ```

   It refuses to run when an admin already exists.
3. Sign in at http://localhost:3000. From the admin screen you can invite other people.

Using someone else's Supabase project does not skip this: the Supabase user exists there, but your
local database still needs its own `app_users` row, so run the same command with that user's uid.

More setup details (row-level security locally, invitations, running the tests) are in each side's
`AGENTS.md`.

### Scheduled jobs

The daily portfolio snapshot and the 20-trading-day outcome evaluation also run without anyone opening a
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

Personal project; not currently open to outside contributions. If that changes, `AGENTS.md`
documents the conventions this codebase follows (Conventional Commits, branch naming, path-filtered
CI per side).
