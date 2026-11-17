# Claude token tracking per feature: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count the Claude tokens and web searches each feature, step and trigger uses, keep daily totals in Redis, and show them with an estimated cost to admins.

**Architecture:** A new `app/claude_usage.py` holds a per-run tally in a context variable. Run entry points open it with `track(feature, trigger)`; the three Anthropic call sites add each response's `usage` with `record(response, step)`; leaving `track` flushes the tally to Redis hashes and writes one log line. An admin-only `GET /admin/claude-usage` reads the hashes; the admin Usage & limits page shows them.

**Tech Stack:** Python, FastAPI, Redis (`redis.asyncio`), pytest, ruff, mypy; Next.js, TypeScript, MUI, SWR, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-claude-usage-tracking-design.md`. Work on branch `feature/claude-usage-tracking` (from `master`); the design and this plan are committed first.

## Global Constraints

- Advisory only; nothing here touches orders. No prompt, model, limit or result changes; `_extract` only gains a label argument.
- Counters hold numbers only: never prompts, responses, tickers or holdings. Per feature and trigger, not per user.
- Recording must never fail or slow a Claude call or a run: `record` never raises; the flush is one Redis `MULTI` pipeline awaited with a 2-second timeout, any failure logged by class name only (never raw exception text) and dropped; `CancelledError` is re-raised.
- Features: `scan`, `company`, `analysis`, `chat`, `mentions`. Triggers: `manual`, `auto` (the Preferences weekday jobs). Steps: `research`, `follow_up`, `thesis`, `synthesis`, `news`, `chat`, `mentions`. Metrics: `calls`, `input`, `output`, `cache_read`, `cache_write`, `searches`.
- Redis key `claude_usage:{YYYY-MM-DD}:{feature}:{trigger}` (UTC day), hash fields `{step}:{model}:{metric}`, expiry 40 days.
- `track` opens inside the job body that does the Claude work, never around the HTTP handler or the task kickoff; a `track` opened while another is open is a no-op; the tally is only mutated (under a `threading.Lock`), never rebound with `ContextVar.set` inside a task.
- `record` runs inside the worker thread immediately after `messages.create`, before any `stop_reason` check. A call that fails before the API returns `usage` is not counted (accepted undercount, stated on the admin table).
- Prices per model: Sonnet 5 at $2 per million input, $10 per million output; `cache_read`, `cache_write` (priced as the 5-minute write) and `search` ($0.01 per search) also per model. A model with no price entry shows tokens and no cost. The dollar figure is an estimate.
- Admin-only read; `days` is 1 to 40 (default 30). No migration.
- Backend per `backend/AGENTS.md` (run ruff by hand from `backend/` with `.venv/Scripts/ruff.exe`, `mypy.exe app`, `python -m pytest`); frontend per `frontend/AGENTS.md` (lint, `npx tsc --noEmit`, vitest; run tests from PowerShell). `docs/ARCHITECTURE.md` updated (endpoint and Redis keys). Conventional Commits with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` trailer, GPG-signed, no push.

## Review Focus

1. A call that fills its output cap and is then discarded by `_extract` is still counted (Task 2).
2. Parallel `_extract` calls and `asyncio.to_thread` workers all add into one tally without losing counts (Task 1).
3. A `track` inside a `track` counts once under the outer feature; a Redis outage, a flush timeout or a cancelled run never fails or delays the run (Task 1).
4. `track` is opened inside the job bodies: a run started with `asyncio.create_task` after its request returned still flushes at the end of the run (Task 2).
5. An unknown model shows tokens with no cost; `days` outside 1 to 40 is rejected and days with no data come back empty, not missing (Tasks 1, 3).

---

### Task 1: The tally, `track`, `record`, flush and read helpers

**Files:**
- Create: `backend/app/claude_usage.py`, `backend/tests/test_claude_usage.py`
- Modify: `backend/app/config.py` (price settings)

**Interfaces:**
- Produces, in `app/claude_usage.py`:
  - `track(feature: str, trigger: str = "manual") -> AsyncIterator[None]` (an `@asynccontextmanager`).
  - `record(response: object, step: str) -> None`: reads `response.model`, `response.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, and `server_tool_use.web_search_requests`; missing or `None` counts as 0); no-op with no open tally; never raises.
  - `estimate_cost(model: str, metrics: dict[str, int]) -> float | None`: `None` for a model with no price entry.
  - `async daily_totals(days: int) -> list[DayUsage]`, newest first, one entry per UTC day for the last `days` days (an empty `rows` list for a day with no data), where `DayUsage` has `date: str` and `rows: list[UsageRow]`, and `UsageRow` has `feature: str`, `trigger: str`, `step: str`, `model: str`, `calls`, `input`, `output`, `cache_read`, `cache_write`, `searches: int` and `cost_usd: float | None` (dataclasses or Pydantic, builder's call).
- Produces in `app/config.py`: `Settings.claude_prices: dict[str, dict[str, float]]` (model id to `{"input", "output", "cache_read", "cache_write", "search"}`, dollars per million tokens, and per single search for `search`), default `{"claude-sonnet-5": {"input": 2.0, "output": 10.0, "cache_read": 0.2, "cache_write": 2.5, "search": 0.01}}`.
- Consumes: `get_redis()` from `app.redis_client`.

- [ ] **Step 1: Write the failing tests** in `backend/tests/test_claude_usage.py` (fake responses are `SimpleNamespace` with `model` and a `usage` block; Redis is real, reset `app.redis_client._redis = None` per the repo rule, and use a test-only feature name so keys can be cleaned):
  - `test_record_adds_usage_to_the_open_tally_and_flush_writes_the_hash`: inside `track("scan", "auto")`, `record` a response (input 100, output 20, cache_read 5, cache_creation 7, web_search_requests 2) with step `research`; after exit the hash `claude_usage:<today UTC>:scan:auto` has `research:claude-sonnet-5:input == "100"`, `output "20"`, `cache_read "5"`, `cache_write "7"`, `searches "2"`, `calls "1"`, and the key's TTL is at most 40 days and above 39 days.
  - `test_record_with_no_open_tally_does_nothing_and_never_raises`, including a response with no `usage` attribute and one with `usage.server_tool_use = None`.
  - `test_parallel_threads_and_tasks_sum_exactly`: 8 `asyncio.to_thread` workers each record 50 times inside one `track`; the flushed `calls` is exactly 400.
  - `test_a_nested_track_is_a_no_op`: the inner `track("chat")` inside `track("scan")` writes nothing for `chat`; the calls land under `scan`.
  - `test_a_run_that_raises_or_is_cancelled_still_flushes_and_reraises`: an exception inside `track` propagates and the counts are written; cancelling a task inside `track` ends cancelled.
  - `test_a_redis_failure_or_slow_flush_never_fails_the_run`: patch `get_redis` to raise, and again to a pipeline that sleeps past the 2-second timeout (patch the timeout constant small); the `async with` block completes without raising and a warning with only the exception class name is logged.
  - `test_the_run_logs_one_line_with_its_totals`: one log record naming feature, trigger and per-metric totals.
  - `test_estimate_cost`: Sonnet 5, input 1,000,000, output 100,000, searches 3 gives `2.0 + 1.0 + 0.03`; an unknown model gives `None`.
  - `test_daily_totals_returns_days_newest_first_with_empty_days_and_costs`: write two days' hashes directly, ask for 3 days, expect three entries newest first, the middle or empty day has `rows == []`, and each row carries `cost_usd`; an unknown model's row has `cost_usd is None`.
- [ ] **Step 2: Run them and see them fail** (`cd backend && .venv/Scripts/python.exe -m pytest tests/test_claude_usage.py -q`; expect an import error for `app.claude_usage`).
- [ ] **Step 3: Implement** `app/claude_usage.py` and the settings field per the Interfaces above. A `Tally` class holds a `threading.Lock` and a dict keyed `(step, model)` to metric counters; a module `ContextVar[Tally | None]`; `track` returns immediately if a tally is open, otherwise creates one, sets the variable, `yield`s, and in `finally` resets the variable and flushes via `asyncio.wait_for(..., FLUSH_TIMEOUT_SECONDS = 2.0)` inside `try/except Exception` that logs the class name only (do not catch `CancelledError`); the flush is one `get_redis().pipeline(transaction=True)` with `hincrby` per field and `expire(key, 40 * 86400)`; the UTC day is `datetime.now(UTC).date()`. `daily_totals` reads each day's keys with `scan_iter` or the known feature/trigger lists (builder's call) and parses fields back.
- [ ] **Step 4: Run the tests, ruff (check and format) on the changed files, `mypy.exe app`; see them pass. Commit** `feat: count Claude tokens per feature, step and trigger`.

---

### Task 2: Wire the three call sites and the five entry points

**Files:**
- Modify: `backend/app/agents/research.py` (`_extract`, `research_candidate`, `follow_up_candidate`, `discover_mentions`), `backend/app/agents/discovery_graph.py` (the two `_extract` calls), `backend/app/agents/news.py`, `backend/app/agents/chat.py`, `backend/app/discovery/jobs.py` (`run_job`), `backend/app/discovery/company_jobs.py` (`run_company`), `backend/app/agents/jobs.py` (`run_job`), `backend/app/scheduled.py` (`run_discovery_mentions`, the scan call at the discovery run)
- Test: `backend/tests/test_claude_usage_wiring.py` (new)

**Interfaces:**
- Consumes: `track`, `record` from Task 1.
- Produces: `research._extract(client, prompt, data, schema, step: str = "research")`; the five callers pass `research`, `follow_up`, `mentions` (in `research.py`), `thesis`, `synthesis` (in `discovery_graph.py`). `discovery.jobs.run_job(job_id, user_id, client, *, uses_saved_key=True, trigger: str = "manual")`; the scheduled scan call passes `trigger="auto"`.

- [ ] **Step 1: Write the failing tests** (mock the Anthropic client; never call the real API):
  - `test_extract_records_before_the_max_tokens_check`: a fake `client.with_options(...).messages.create` returns a response with `stop_reason="max_tokens"` and output 8192; inside `track("scan")`, `_extract(...)` raises `ValueError` and the tally still holds `output == 8192` under the given step.
  - `test_extract_steps_are_recorded_under_the_callers_step_names` (one parametrised test over `research`, `follow_up`, `thesis`, `synthesis`, `mentions` using the existing fakes for those callers, or by calling `_extract` with each step).
  - `test_news_agent_records_the_step_news_with_web_searches` and `test_chat_records_the_step_chat`: fake response with `usage.server_tool_use.web_search_requests = 3`.
  - `test_each_entry_point_opens_a_track_inside_the_job_body`: for `discovery.jobs.run_job` (manual and `trigger="auto"`), `company_jobs.run_company`, `agents.jobs.run_job` (`source="manual"` gives `manual`, `source="scheduled"` gives `auto`), and `scheduled.run_discovery_mentions` (`auto`), run with the Claude-calling function patched to `record` one fake response and assert the flushed key's feature and trigger. For the two jobs started with `asyncio.create_task`, start the task, let the "request" finish, and assert the flush still happens at the end of the run.
  - Existing tests for the touched modules still pass unchanged.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `record(response, step)` goes inside each worker-thread function right after `messages.create` (in `_extract`'s `create()` before the `stop_reason` check; in `news.py`'s and `chat.py`'s `_create`). Open `track` in these bodies: `discovery.jobs.run_job` around the `evaluate_scan` call (`track("scan", trigger)`), `run_company` around the `evaluate_candidate` call (`track("company")`), `agents.jobs.run_job` around the `asyncio.gather` (`track("analysis", "manual" if source == "manual" else "auto")`), `run_chat` around the Claude call (`track("chat")`), and `run_discovery_mentions` around `research.discover_mentions()` (`track("mentions", "auto")`; the flush completes inside that coroutine, before `asyncio.run` closes the loop). Do not change any prompt, model, limit or returned value.
- [ ] **Step 4: Run the new and the existing discovery, agents, chat and scheduled tests, ruff, `mypy.exe app`; see them pass. Commit** `feat: record Claude usage at every call site and run entry point`.

---

### Task 3: The admin endpoint

**Files:**
- Modify: `backend/app/routers/admin.py`, `backend/app/schemas.py`
- Test: `backend/tests/test_admin_claude_usage.py` (new)

**Interfaces:**
- Consumes: `daily_totals` and its row type from Task 1.
- Produces: `GET /admin/claude-usage?days=30` (query `days: int = Query(30, ge=1, le=40)`), response model `ClaudeUsageOut = {days: list[{date: str, rows: list[{feature, trigger, step, model, calls, input, output, cache_read, cache_write, searches, cost_usd: float | None}]}]}` in `app/schemas.py`. The route stays thin: it calls `daily_totals` and returns the result.

- [ ] **Step 1: Write the failing tests:** an admin gets the written rows (seed one hash directly) with the exact field names and `cost_usd` for a priced model and `null` for an unknown one; `days=0` and `days=41` give 422; no `days` returns 30 day entries; days with no data return `rows: []`; no counters hold ticker, user or prompt text (assert the response keys). The existing `test_every_admin_route_is_403_for_an_active_non_admin` already covers the 403 for the new route; also add a direct assertion that a non-admin gets 403 for this path.
- [ ] **Step 2: Run them and see them fail. Step 3: Implement** the route and schema. **Step 4: Run the admin tests, ruff, `mypy.exe app`; see them pass. Commit** `feat: add GET /admin/claude-usage`.

---

### Task 4: The admin table and the docs

**Files:**
- Modify: `frontend/lib/api/admin-types.ts` (add `ClaudeUsageOut` and row types matching Task 3), `frontend/app/(shell)/admin/usage/page.tsx`, `docs/ARCHITECTURE.md`
- Create: `frontend/components/admin/ClaudeUsagePanel.tsx`, `frontend/components/admin/ClaudeUsagePanel.test.tsx`

**Interfaces:**
- Consumes: `GET /admin/claude-usage?days=7|30` through `apiFetch` and SWR; the existing `Panel`, `PageHeader`, `SegmentedControl` (or the existing range control) and the page's table styling.
- Produces: `ClaudeUsagePanel` (named export, no props) rendered under the existing user table on the Usage page: a 7 / 30 day switch (default 7); one row per feature and trigger (summed over the days and steps, then expandable or followed by a per-step breakdown, builder's call) with calls, input, output, searches and estimated cost; a total; the note "Estimated from list prices; calls that fail before the API answers are not counted."; an empty state "No Claude calls recorded yet." A row with `cost_usd == null` shows tokens and "no price" for cost. Numbers use `formatAmount`-style grouping; sizes in rem; words, not only colour; works at 390px per the page's phone card pattern.

- [ ] **Step 1: Write the failing tests** (`apiFetch` mocked by path with the `FakeApiError` pattern; fresh `SWRConfig`): the panel shows the feature/trigger rows with their totals and cost, switches to 30 days and refetches with `days=30`, shows the note, shows the empty state, shows "no price" for a null cost, and shows an error message when the request fails.
- [ ] **Step 2: Run them and see them fail. Step 3: Implement** the panel and mount it on the page; add the types. Update `docs/ARCHITECTURE.md`: the new route in the API table (admin only, `days` 1 to 40), the `claude_usage:{date}:{feature}:{trigger}` Redis keys and their meaning, and the rule that counters hold no prompt, ticker or user data.
- [ ] **Step 4: Run the admin frontend tests, lint, `npx tsc --noEmit`; run the full backend suite once** (`docker compose up -d` from `backend/` if Postgres and Redis are not up) **and the full frontend suite; see them pass.** A real-browser look at the admin Usage page (light, dark, 390px) is for the owner. **Commit** `feat: show Claude usage per feature on the admin page`.

---

## Self-review

- **Spec coverage:** counters and the hash layout, `track` rules and flush guarantees, `record` placement and the capped-call case (Tasks 1, 2); all five entry points and three call sites with the step and trigger names (Task 2); per-model prices and unknown models (Task 1); the admin read with its bounds (Task 3); the table, the note about uncounted failures, and the docs (Task 4). The spec's "prices in settings" is `Settings.claude_prices`.
- **Types:** `track`, `record`, `estimate_cost`, `daily_totals`, `UsageRow` and the field names are the same in Tasks 1 to 4; `ClaudeUsageOut` in Task 3 matches the TypeScript types in Task 4.
- **Proportion:** four tasks, each its own test cycle; the plan fixes names, values and tests and leaves bodies to the builder.
