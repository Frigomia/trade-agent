# Claude token tracking with LangSmith: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trace every Claude call of the five features in LangSmith, grouped per run and tagged by feature and trigger, so the owner can see which feature and step uses the tokens.

**Architecture:** A new `app/tracing.py` configures LangSmith from settings (off by default), wraps the Anthropic client at its call sites with `wrap_anthropic` (run name = the step), and opens one `langsmith.trace` parent per run (`trace_feature`). Five run entry points open the parent inside their job bodies; three call sites wrap the client that actually makes the call.

**Tech Stack:** Python, FastAPI, `langsmith` 0.12.6 (already locked), pytest, ruff, mypy.

**Spec:** `docs/superpowers/specs/2026-11-17-claude-usage-tracking-design.md`. Work on branch `feature/claude-usage-tracking` (from `master`); the design and this plan are committed first.

## Global Constraints

- Advisory only; nothing here touches orders. No prompt, model, limit or result changes; `_extract` only gains a `step` argument.
- Tracing is off unless `langsmith_tracing` is true and `langsmith_api_key` is set. When off, `traced` returns its client unchanged and `trace_feature` is a pass-through; behaviour is identical to today.
- Tracing never fails or slows a Claude call or a run; nothing in it logs raw exception text (class name only); `trace_feature` re-raises everything, including cancellation.
- Settings (in `app/config.py` and `.env.example`): `langsmith_tracing: bool = False`, `langsmith_api_key: str | None = None`, `langsmith_project: str = "trade-agent"`, `langsmith_hide_content: bool = False`. `configure_tracing()` exports them to `os.environ` (`LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, and `LANGSMITH_HIDE_INPUTS` / `LANGSMITH_HIDE_OUTPUTS` when hiding) before the first trace; it is called at app start and at the start of `python -m app.scheduled`.
- Features `scan`, `company`, `analysis`, `chat`, `mentions`; triggers `manual`, `auto`; steps `research`, `follow_up`, `mentions`, `thesis`, `synthesis`, `news`, `chat`. Parent run: `name=feature`, `run_type="chain"`, `tags=[feature, trigger]`, `metadata={"feature": feature, "trigger": trigger}`. Child call run name = the step.
- Wrap the client where the call is made (`_extract` calls `client.with_options(...)`, a copy): `traced(client.with_options(...), step)` inside `_extract`, not at client creation.
- `trace_feature` opens inside the job body that does the Claude work, never around the HTTP handler or the task kickoff.
- No new dependency, no migration, no network in tests (use a stub LangSmith client or patch the wrapper).
- Backend per `backend/AGENTS.md` (run ruff by hand from `backend/` with `.venv/Scripts/ruff.exe`, `mypy.exe app`, `python -m pytest`; from PowerShell if Bash vitest-style runners misbehave). Conventional Commits with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` trailer, GPG-signed, no push.

## Review Focus

1. The scan, company analysis and mentions calls (all through `_extract` and `with_options`) are wrapped; a client wrapped only at creation would miss them (Task 2).
2. With tracing off (the default) nothing changes: same client object returned, no environment variables set, no run created (Task 1).
3. A failure inside the tracing machinery never fails or delays a Claude call or a run, and cancellation still propagates (Task 1).
4. `trace_feature` is opened inside the job bodies: a run started with `asyncio.create_task` after its request returned still has its calls nested under the run's parent (Task 2).
5. `python -m app.scheduled` configures tracing before its first Claude call, so the weekday jobs are traced as `auto` (Task 2).

---

### Task 1: Settings and the tracing module

**Files:**
- Create: `backend/app/tracing.py`, `backend/tests/test_tracing.py`
- Modify: `backend/app/config.py`, `backend/.env.example`

**Interfaces:**
- Produces in `app/tracing.py`:
  - `configure_tracing() -> None`
  - `traced(client: Anthropic, step: str) -> Anthropic`: `wrap_anthropic(client, chat_name=step)` when tracing is enabled (same check `configure_tracing` used: flag and key set), else `client` itself.
  - `trace_feature(feature: str, trigger: str = "manual") -> AbstractAsyncContextManager[None]` (an `@asynccontextmanager`): `async with langsmith.trace(name=feature, run_type="chain", tags=[feature, trigger], metadata={"feature": feature, "trigger": trigger})` when enabled, else a bare `yield`.
- Produces in `app/config.py`: the four settings named in the Global Constraints.

- [ ] **Step 1: Write the failing tests** in `backend/tests/test_tracing.py` (patch `app.tracing.settings` fields; restore `os.environ` after each test):
  - `test_configure_tracing_does_nothing_when_off_or_without_a_key`: with the flag off, and with the flag on but no key, no `LANGSMITH_*` variable is added.
  - `test_configure_tracing_exports_the_settings_when_on`: flag on and key `ls-test` sets `LANGSMITH_TRACING == "true"`, `LANGSMITH_API_KEY == "ls-test"`, `LANGSMITH_PROJECT == "trade-agent"`, and no `LANGSMITH_HIDE_*`; with `langsmith_hide_content` on, `LANGSMITH_HIDE_INPUTS` and `LANGSMITH_HIDE_OUTPUTS` are `"true"`.
  - `test_traced_returns_the_same_client_when_off_and_a_wrapped_one_when_on`: off gives `traced(c, "research") is c` and `c.messages.create` unchanged; on (patch `app.tracing.wrap_anthropic` with a recorder) it is called once with `chat_name="research"` and its result returned.
  - `test_trace_feature_is_a_pass_through_when_off`: the block runs and no `langsmith.trace` is created (patch it to fail if called); an exception and a cancellation inside the block propagate.
  - `test_trace_feature_opens_a_parent_run_with_feature_and_trigger_when_on`: patch `app.tracing.langsmith.trace` (or `ls.trace`) with a recorder; entering `trace_feature("scan", "auto")` calls it with `name="scan"`, `run_type="chain"`, `tags=["scan", "auto"]`, `metadata={"feature": "scan", "trigger": "auto"}`; an exception inside still propagates.
  - `test_a_tracing_failure_does_not_fail_the_run`: patch `langsmith.trace` so that entering it raises; the `async with trace_feature(...)` block still runs its body and does not raise, and a warning with only the exception class name is logged.
- [ ] **Step 2: Run them and see them fail** (`cd backend && .venv/Scripts/python.exe -m pytest tests/test_tracing.py -q`; expect an import error for `app.tracing`).
- [ ] **Step 3: Implement** `app/tracing.py` and the settings per the Interfaces. `trace_feature` wraps the `langsmith.trace` enter in a `try/except Exception` that logs the class name and falls back to a bare `yield` (an error raised by the body itself must still propagate, so enter and body are separate). Add the four settings to `.env.example` with comments (off by default; what is sent; the hide switch).
- [ ] **Step 4: Run the tests, ruff (check and format) on the changed files, `mypy.exe app`; see them pass. Commit** `feat: add LangSmith tracing helpers, off by default`.

---

### Task 2: Wire the call sites and the entry points, and the docs

**Files:**
- Modify: `backend/app/agents/research.py` (`_extract`, `research_candidate`, `follow_up_candidate`, `discover_mentions`), `backend/app/agents/discovery_graph.py` (the two `_extract` calls), `backend/app/agents/news.py`, `backend/app/agents/chat.py`, `backend/app/discovery/jobs.py` (`run_job`), `backend/app/discovery/company_jobs.py` (`run_company`), `backend/app/agents/jobs.py` (`run_job`), `backend/app/scheduled.py` (start of `main`, `run_discovery_mentions`, the discovery scan call), `backend/app/main.py` (startup), `docs/ARCHITECTURE.md`
- Test: `backend/tests/test_tracing_wiring.py` (new)

**Interfaces:**
- Consumes: `configure_tracing`, `traced`, `trace_feature` from Task 1.
- Produces: `research._extract(client, prompt, data, schema, step: str = "research")`; its five callers pass `research`, `follow_up`, `mentions` (in `research.py`), `thesis`, `synthesis` (in `discovery_graph.py`). `discovery.jobs.run_job(job_id, user_id, client, *, uses_saved_key=True, trigger: str = "manual")`; the scheduled scan call passes `trigger="auto"`.

- [ ] **Step 1: Write the failing tests** (mock the Anthropic client; patch `app.tracing.traced` and `trace_feature` with recorders; never call the real API or LangSmith):
  - `test_extract_wraps_the_with_options_copy_with_its_step`: `_extract(..., step="thesis")` calls `traced` with the object returned by `client.with_options(...)` (not the original `client`) and `"thesis"`, and still returns the tool input exactly as before; the `max_tokens` guard still raises `ValueError`.
  - `test_the_five_extract_callers_use_their_step_names` (parametrised, using the existing fakes or by patching `_extract` to record `step`): `research`, `follow_up`, `mentions`, `thesis`, `synthesis`.
  - `test_news_and_chat_wrap_their_clients_with_their_step`: `news` and `chat`.
  - `test_each_entry_point_opens_its_parent_inside_the_job_body`: for `discovery.jobs.run_job` (manual, and `trigger="auto"`), `company_jobs.run_company`, `agents.jobs.run_job` (`source="manual"` gives `manual`, `source="scheduled"` gives `auto`), `run_chat` and `scheduled.run_discovery_mentions` (`auto`), run with the Claude-calling function patched out and assert `trace_feature` was entered with the right feature and trigger, and that it is entered inside the function (not by the caller): for the two jobs started with `asyncio.create_task`, assert the parent is entered after the "request" has returned.
  - `test_scheduled_main_configures_tracing_first`: `configure_tracing` is called before any command body runs.
  - Existing tests for the touched modules pass unchanged.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** In each call site use `traced(<the object that calls messages.create>, step)`: in `_extract`, around `client.with_options(timeout=60.0, max_retries=0)`; in `news.run_news_agent` and `chat.run_chat`, around `client`. Open `trace_feature` in these bodies: `discovery.jobs.run_job` around the `evaluate_scan` call (`trace_feature("scan", trigger)`), `run_company` around the `evaluate_candidate` call (`trace_feature("company")`), `agents.jobs.run_job` around the `asyncio.gather` (`trace_feature("analysis", "manual" if source == "manual" else "auto")`), `run_chat` around the Claude call (`trace_feature("chat")`), `run_discovery_mentions` around `research.discover_mentions()` (`trace_feature("mentions", "auto")`). Call `configure_tracing()` in the app startup (`main.py`) and at the start of the `app.scheduled` entry point. Do not change any prompt, model, limit or returned value. Update `docs/ARCHITECTURE.md`: the four `langsmith_*` settings, that tracing is off by default, that prompts and responses are sent to LangSmith when on (and the hide switch), and the feature, trigger and step names.
- [ ] **Step 4: Run the new tests and the existing discovery, agents, chat, scheduled and `main` tests, ruff, `mypy.exe app`; run the full backend suite once** (`docker compose up -d` from `backend/` if Postgres and Redis are not up); **see them pass. Commit** `feat: trace Claude calls per feature, trigger and step in LangSmith`.

---

## Owner's checks after it lands

Set the four settings in `backend/.env` (LangSmith account and API key; the second user's agreement or `langsmith_hide_content`), restart, run one scan and one company analysis on the dev key, and confirm in LangSmith that the runs group by feature with the step names and token counts (add the Sonnet 5 price if cost columns are blank). If hiding is on, confirm the token counts still show.

## Self-review

- **Spec coverage:** settings, `configure_tracing`, `traced`, `trace_feature` (Task 1); the three call sites, the five entry points, the scheduled startup, `_extract`'s step and the docs (Task 2); the owner's checks listed. The `with_options` constraint is a review-focus line and a test.
- **Types:** `configure_tracing`, `traced`, `trace_feature` and the setting names are the same in both tasks; the step and feature names match the spec.
- **Proportion:** two tasks, each its own test cycle; the plan fixes names, values and tests and leaves bodies to the builder.
