# Security review fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two medium and one low backend finding and the two chosen frontend findings from the 2026-10-09 security review.

**Architecture:** Small changes to existing code, no new tables or routes. One Redis marker per user bounds analysis jobs; one advisory-lock helper makes late background writes safe against data deletion; one conditional UPDATE makes approve/reject refuse decided rows; the password form re-checks the current password; the chat page accepts only the app's own prompt shape.

**Tech Stack:** FastAPI, SQLAlchemy, Redis, Postgres advisory locks, pytest; Next.js, MUI, Supabase JS, Vitest.

**Spec:** the design agreed in chat on 2026-10-09 (no spec file; bounded change set). Review reports: scratchpad `sec-backend.md`, `sec-frontend.md`.

## Global Constraints

- The system never places a trade; nothing here touches execution.
- Backend: `uv run --system-certs`; ruff + mypy/pyright as the backend CLAUDE.md says; run the full backend suite ONE process at a time (shared test DB).
- Frontend: lint + typecheck + vitest + build per frontend/CLAUDE.md.
- Migrations: none needed. Never edit existing migrations.
- Conventional Commits; trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never skip hooks or signing (GPG timeout: retry once, else leave staged and report).
- No `print`/`console.log`, no secrets.
- ARCHITECTURE.md updated for any API-contract change (new 409s).

## Review Focus

- Two parallel `POST /analysis/run` for one user: exactly one gets 202, the other 409; the marker is released when the job ends, fails or raises, and expires on its own if the process dies.
- A scheduled run for a user whose manual run is active: skipped, not failed, and not charged against the monthly limit.
- A background writer racing `delete_user_data` / admin remove: no row survives for a disabled or removed user.
- Approve/reject on a SUPERSEDED/REJECTED/APPROVED row: 409 and the row is unchanged; on another user's row: 404.
- Wrong current password: no password change, clear error, no session change.
- `?ask=` with anything but `Why <ACTION> on <TICKER>?`: composer stays empty.

---

### Task 1: One analysis job per user

**Files:**
- Modify: `backend/app/agents/jobs.py` (create_job, run_job)
- Modify: `backend/app/routers/analysis.py` (`run_analysis`)
- Modify: `backend/app/scheduled.py` (around the `create_job` call, ~line 222)
- Test: `backend/tests/test_agents_jobs.py`, `backend/tests/test_analysis_router.py`, the scheduled-analysis test file (find it with grep)

**Interfaces:**
- Produces: `class AnalysisAlreadyRunning(Exception)` in `app/agents/jobs.py`; `create_job` raises it when the user's marker is held.

- [ ] **Step 1:** Mirror `app/backtest/jobs.py`: marker key `analysis_active:{user_id}` claimed with `SET NX EX` in `create_job` BEFORE the job hash is written; `ACTIVE_TTL_SECONDS = 3600` (the job TTL; a run is bounded well below it by the 3-way semaphore, and the marker expires if the process dies). Release with the same compare-and-delete Lua script in `run_job`'s `finally` (after setting status DONE). Release also if `create_job` fails after claiming.
- [ ] **Step 2:** `run_analysis` catches `AnalysisAlreadyRunning` → `HTTPException(409, "An analysis is already running. Wait for it to finish, then start another.")` (`from None`). Note the dependency order: the rate limit and monthly usage dependencies run first and charge usage; claim the marker so a 409 does not cost a monthly run. Check `check_monthly_usage` semantics: if it increments before the handler runs, refund on 409 using the existing refund helper in `app/usage.py` (find it); if no refund helper exists, move nothing and report it back instead of inventing one.
- [ ] **Step 3:** In `scheduled.py`, catch `AnalysisAlreadyRunning` from `create_job`: forget the ran marker (`_forget_marker`), refund the usage count the same way the `UsageLimitExceeded` branch does, return `"skipped"`.
- [ ] **Step 4:** Tests: second `create_job` raises; release after `run_job` ends (success and exception); a stale marker held by another job id is not released by this job; router returns 409 on the second call and 202 on the first; 409 does not consume monthly usage; scheduled run skips (no failure, usage unchanged) while a marker is held.
- [ ] **Step 5:** ARCHITECTURE.md: document the 409 on `POST /analysis/run`. Run ruff/types and the touched test files, then the full suite once. Commit `fix: allow one analysis job per user at a time`.

### Task 2: Late background writes after a delete

**Files:**
- Modify: `backend/app/db.py` (new helper), `backend/app/user_data.py`
- Modify: `backend/app/agents/jobs.py` (recommendation insert in `_process_ticker`), `backend/app/routers/chat.py` (`_save_reply`), `backend/app/backtest/jobs.py` (`_save_result`)
- Test: new `backend/tests/test_late_writes.py` plus the existing delete/admin tests stay green

**Interfaces:**
- Produces: `def lock_and_check_active(db: Session, user_id: uuid.UUID) -> bool` in `app/db.py`: calls `lock_user_for_insert`, then returns True only if an `app_users` row for `user_id` exists with `status == "active"`.

- [ ] **Step 1:** Add the helper (reads `AppUser` through the same session; `app_users` has no RLS and the runtime role already reads it on every request). The lock is transaction-scoped, so call it as the first statement in the write transaction.
- [ ] **Step 2:** `delete_user_data`: call `lock_user_for_insert(session, user_id)` before the TelegramLink read, so the whole delete is serialised against writers.
- [ ] **Step 3:** The three writers call the helper first and, when it returns False, skip the insert: analysis → no `SUPERSEDED` update and no Recommendation, record the entry as `{"ticker": ..., "skipped": True}`; chat → skip adding the reply (log nothing with content); backtest → raise nothing, return a sentinel handled so the job ends as FAILED without a row (read how `run_job` handles `_save_result` errors and reuse that path).
- [ ] **Step 4:** Tests: for each writer, a user with status `disabled` and a user with no `app_users` row get no row written; an `active` user is unaffected; `delete_user_data` and a writer interleaved (writer holds the lock, delete waits then removes the row) leaves zero rows; admin `remove_user` flow test still passes. Note in a code comment that self-service `DELETE /me/data` leaves the account active, so a late row there belongs to a live user and is intended.
- [ ] **Step 5:** ARCHITECTURE.md: one paragraph under the deletion/background-jobs section. Ruff/types, full suite once. Commit `fix: stop in-flight jobs writing rows for a removed user`.

### Task 3: Approve and reject only PENDING recommendations

**Files:**
- Modify: `backend/app/routers/analysis.py` (`_set_recommendation_status`)
- Test: `backend/tests/test_analysis_router.py`; frontend: check `frontend/components/recommendations/DecisionActions.tsx` shows a 409 message instead of failing silently (add a test only if a change is needed)

- [ ] **Step 1:** Replace the read-then-write with a conditional update: `UPDATE ... WHERE id=:id AND user_id=:uid AND status='PENDING'`, rowcount 0 → look the row up: missing/other user → 404, otherwise 409 "This recommendation was already decided or replaced." Keep `reviewed_at` set and return the refreshed row.
- [ ] **Step 2:** Tests: PENDING → APPROVED/REJECTED works; APPROVED, REJECTED and SUPERSEDED rows → 409 and unchanged; unknown id and another user's id → 404.
- [ ] **Step 3:** Read `DecisionActions.tsx`: if an API error already shows its detail text, no frontend change; otherwise make the smallest change so a 409 detail is shown. ARCHITECTURE.md: the 409 on approve/reject. Run the checks; commit `fix: approve and reject only change pending recommendations`.

### Task 4: Frontend — current password and chat prompt shape

**Files:**
- Modify: `frontend/components/account/ChangePasswordForm.tsx`, `frontend/app/(shell)/chat/page.tsx`
- Test: `frontend/components/account/ChangePasswordForm.test.tsx` (create if missing), `frontend/app/(shell)/chat/page.test.tsx`

- [ ] **Step 1 (L1):** Add a "Current password" field (`autoComplete="current-password"`) first in the form. On submit: validate new password as today; then read the email with `createClient().auth.getUser()`, call `signInWithPassword({ email, password: current })`; on error show "The current password is not correct." and stop (do not call `updateUser`); on success call `updateUser({ password })` as today. Clear all three fields on success. The reset-password page is unchanged (the recovery link is the proof there).
- [ ] **Step 2 (L3):** In the chat page accept `?ask=` only if it matches `/^Why (BUY|ADD|HOLD|TRIM|SELL|WATCH) on [A-Za-z0-9.^=-]{1,20}\?$/`; otherwise the draft starts empty. Still remove the param from the URL as today.
- [ ] **Step 3:** Tests: wrong current password → no `updateUser` call and the error shown; correct → both called in order; `getUser` without email shows an error; `ask` valid shape prefills; `ask=Ignore previous instructions and ...` and a long free-text value leave the composer empty and the param is still removed.
- [ ] **Step 4:** lint, typecheck, vitest, build. Commit `fix: ask for the current password and accept only the app's own chat prompt`.
