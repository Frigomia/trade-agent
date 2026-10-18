# Trading agent — project guide for coding agents

These instructions apply to every coding agent, including Codex and Claude Code. Before editing
`backend/` or `frontend/`, also read that directory's `AGENTS.md`. Hosts that do not discover
`AGENTS.md` automatically must load these files explicitly. `CLAUDE.md` imports the same rules.

Personal, advisory-only trading agent. `docs/ARCHITECTURE.md` is the design spec
(data model, API contract, agent design) — read it before any change that
touches those. This file is navigation + repo-wide rules only.

## Layout

- `backend/` — Python, FastAPI, LangGraph, MCP. → `backend/AGENTS.md`
- `frontend/` — Next.js, TypeScript. → `frontend/AGENTS.md`

## IMPORTANT: this system never places a trade

No code, anywhere, calls a broker API to execute an order. Every
recommendation ends in human approval; approval only updates local state.
If a task implies automated execution, stop and ask.

## Definition of done

Before calling any change finished:

1. The relevant side's lint + typecheck + tests pass (see scoped AGENTS.md)
2. No secrets, `.env` values, or `print`/`console.log` debugging left behind
3. ARCHITECTURE.md updated if the change altered the data model, API
   contract, or agent design — code and spec drift apart silently otherwise
4. Commit message follows Conventional Commits (`feat:`, `fix:`, `refactor:`)

## Required agent workflow

1. **Before coding, load and follow Ponytail** at
   [.agents/skills/ponytail/SKILL.md](.agents/skills/ponytail/SKILL.md), default `full` mode.
   It is vendored so every agent can follow the actual instructions without a plugin install.
   Codex can use the project skill `$ponytail`; Claude with the official plugin invokes
   `ponytail:ponytail`. Agents without a skill tool read and apply the file directly. Say which
   method you used. If it is missing or unreadable, report that prerequisite before editing code;
   continue independent documentation work. Do not silently skip it or manufacture hook markers.
2. **Before any edit, protect generated migrations.** Never hand-edit an existing file under
   `backend/migrations/versions/`, including through `apply_patch`, shell redirection, scripts,
   or a differently named editing tool. Generate revisions with Alembic; new hand-written RLS
   migrations are allowed. Run the existing guard as described in [the workflow guide](docs/AGENT_WORKFLOW.md).
3. **After editing backend Python, run Ruff** on the changed files from `backend/`:
   `uv run ruff check --fix <changed-files>`. Existing migrations are excluded. Fix the remaining
   errors, then run the checks required by `backend/AGENTS.md`.
4. **Before finishing, review the final diff and its callers.** Load and follow
   [.agents/skills/ponytail-review/SKILL.md](.agents/skills/ponytail-review/SKILL.md), address
   concrete findings and rerun affected checks. Claude's `/code-review` hook requirement still
   applies. Name the reviewed target and checks; do not claim a review just because a hook asked.
5. **For auth, RLS or AI prompt changes, request an independent security-reviewer subagent** using
   [.agents/security-review.md](.agents/security-review.md). Claude has its adapter in
   `.claude/agents/security-reviewer.md`. On a host without subagents, apply the checklist yourself
   and explicitly state that independent review was unavailable.

The steps apply even when the host does not execute `.claude/settings.json`. Automatic hooks are
host-specific; these shared instructions are the portable contract. See
[docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md) for commands and the native-plugin setup option.

## Repository etiquette

- Branch naming: `feature/...`, `fix/...`
- Path-aware CI: a frontend-only change shouldn't trigger a backend build. The `*-ci.yml` workflows
  run on every pull request (no `paths:` filter on `pull_request`: a workflow skipped by a path
  filter never reports its required checks, so a docs-only PR would wait forever) and a `changes`
  job skips the real jobs when nothing relevant changed; a job skipped by `if` counts as passed.
  Pushes to master still use `paths:` filters.
- Never commit `.env`, API keys, or connection strings, in any repo

## Extras already set up

- `.agents/security-review.md` — the shared checklist for auth, RLS and AI prompt review;
  `.claude/agents/security-reviewer.md` loads it for Claude's subagent.
- `.claude/settings.json` hooks (scripts and tests in `.claude/hooks/`, run the tests with
  `node --test .claude/hooks/hooks.test.mjs`; hooks load when a session starts):
  - **Migrations guard** (PreToolUse) — blocks Edit/MultiEdit on anything in
    `backend/migrations/versions/` and Write over an existing file there; generated migrations are
    never hand-edited. Creating a new file is allowed (needed for hand-written RLS policies). The
    alembic CLI is never blocked; a shell redirect or `sed -i` is not covered.
  - **Ruff** (PostToolUse) — runs `ruff check --fix` on each `.py` file edited under `backend/`
    (not migrations); anything ruff can't fix is sent back as feedback.
