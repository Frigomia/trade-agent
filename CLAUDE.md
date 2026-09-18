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
