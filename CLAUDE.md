# Trading agent — project guide for Claude Code

Personal, advisory-only trading agent. ARCHITECTURE.md is the design spec
(data model, API contract, agent design) — read it before any change that
touches those. This file is navigation + repo-wide rules only.

## Layout

- `backend/` — Python, FastAPI, LangGraph, MCP. → `backend/CLAUDE.md`
- `frontend/` — Next.js, TypeScript. → `frontend/CLAUDE.md`

## IMPORTANT: this system never places a trade

No code, anywhere, calls a broker API to execute an order. Every
recommendation ends in human approval; approval only updates local state.
If a task implies automated execution, stop and ask.

## Definition of done

Before calling any change finished:

1. The relevant side's lint + typecheck + tests pass (see scoped CLAUDE.md)
2. No secrets, `.env` values, or `print`/`console.log` debugging left behind
3. ARCHITECTURE.md updated if the change altered the data model, API
   contract, or agent design — code and spec drift apart silently otherwise
4. Commit message follows Conventional Commits (`feat:`, `fix:`, `refactor:`)

## Repository etiquette

- Branch naming: `feature/...`, `fix/...`
- Path-filtered CI: a frontend-only change shouldn't trigger a backend
  build (`.github/workflows/*-ci.yml`, `paths:` filters)
- Never commit `.env`, API keys, or connection strings, in any repo

## Extras already set up

- `.claude/agents/security-reviewer.md` — invoke on any diff touching
  auth, RLS, or AI prompts: _"use the security-reviewer subagent on this diff"_
- `.claude/settings.json` hooks (scripts and tests in `.claude/hooks/`, run the tests with
  `node --test .claude/hooks/hooks.test.mjs`; hooks load when a session starts):
  - **Migrations guard** (PreToolUse) — blocks Edit/MultiEdit on anything in
    `backend/migrations/versions/` and Write over an existing file there; generated migrations are
    never hand-edited. Creating a new file is allowed (needed for hand-written RLS policies). The
    alembic CLI is never blocked; a shell redirect or `sed -i` is not covered.
  - **Ruff** (PostToolUse) — runs `ruff check --fix` on each `.py` file edited under `backend/`
    (not migrations); anything ruff can't fix is sent back as feedback.
