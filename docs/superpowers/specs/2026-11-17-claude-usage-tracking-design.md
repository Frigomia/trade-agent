# Claude token tracking with LangSmith (short design)

Date: 2026-11-17. Status: draft for the owner's approval. Size: a small change (one module, three Claude call sites, five run entry points, settings and docs). Supersedes the first draft of this file, which proposed an in-app counter with Redis totals and an admin table; the owner chose LangSmith instead (the app has two users, so the privacy cost is small and per-call traces answer the question faster).

## Intent

Running the New-ideas scan and the Discover company analysis three or four times uses up the Claude budget. The owner wants to cut consumption without lowering the quality of the analysis. Nothing in the agent records tokens, and the Anthropic console export only splits by API key and day, so nobody can say which feature or step costs what. This change measures first, through LangSmith traces. Cost cuts come afterwards, each judged against these numbers.

What the console export (19 Oct to 17 Nov) already shows. Sonnet 5 lists at $2 per million input tokens and $10 per million output tokens; no call uses prompt caching.

- A scan-sized run (Tavily search plus Claude extraction) costs about $2.50 to $4.50; output tokens are about 60% of it.
- A Today web-search analysis costs about $1: 23k to 52k input tokens per search, because each result is read back into the prompt. The $0.01 search fee is negligible.
- The two Preferences switches ("Analyze my portfolio automatically each weekday", "Discover new ideas automatically each weekday") fire on their own every weekday, so manual and automatic runs must be told apart.

## Goals

- Every Claude call of the five features appears in LangSmith as a traced call with its input, output and cache tokens, cost and web searches, named by step.
- Calls group under one parent trace per run, tagged with the feature (`scan`, `company`, `analysis`, `chat`, `mentions`) and the trigger (`manual`, or `auto` for the weekday jobs), so a run's total is one click and runs can be filtered by feature or trigger.
- Off by default. Switched on by settings; with no API key nothing is sent and nothing changes.
- No change to any prompt, model, limit or result.

## Non-goals

- Reducing tokens (prompt caching, smaller output caps, a cheaper model, skipping unchanged tickers): each is its own design, judged against these traces.
- Tracing the LangGraph node graphs, Tavily calls or database work, or any admin page, Redis counter or in-app dashboard.
- Per-user breakdowns or billing.

## Anti-goals

- Tracing that can fail or slow a Claude call or a run: a failure to trace is dropped and logged by class name only (the LangSmith SDK already sends in a background thread and swallows its own errors).
- Sending anyone's data without their knowledge: the owner tells the second user their portfolio and chat text go to the owner's LangSmith project, or switches on hiding of inputs and outputs.

## Constraints

- Advisory only; nothing here touches orders.
- Backend rules: the sync Anthropic client stays wrapped in `asyncio.to_thread`; never log raw exception text; mypy, ruff, tests per `backend/AGENTS.md`.
- No new dependency: `langsmith` (0.12.6) is already locked as part of LangGraph. No migration.
- The Anthropic client is traced only where it is called: `_extract` calls `client.with_options(...)`, which copies the client, so a wrapper applied when the client is created would miss the scan, company analysis and mentions calls.
- LangSmith's free Developer plan (1 seat, 5,000 base traces a month, 14-day retention) is enough for a few runs a week; a pricing change is the owner's to watch.

## Approaches

1. **LangSmith tracing (chosen).** Wrap the Anthropic client at its three call sites (`langsmith.wrappers.wrap_anthropic`, run name = the step) and open one `langsmith.trace` parent run per feature run. Per-call detail and a UI for free; about one module plus a few lines per site; data leaves the machine.
2. **An in-app counter** (Redis totals, `GET /admin/claude-usage`, an admin table). Private and permanent, but four tasks of code and less detail. Kept on the shelf: add it later if a permanent in-app number is wanted.
3. **Anthropic console export only.** Already shows per key and day; cannot split the scan from the company analysis.

## Design

- **`app/tracing.py`** (new):
  - `configure_tracing() -> None`: called once at app start (`app/main.py` startup) and at the start of `python -m app.scheduled`. When `settings.langsmith_tracing` is true and `settings.langsmith_api_key` is set, it exports `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` (and `LANGSMITH_HIDE_INPUTS` / `LANGSMITH_HIDE_OUTPUTS` when `settings.langsmith_hide_content`) into `os.environ` before any trace is created (pydantic settings read `.env` but do not export it, and the SDK reads the process environment). Otherwise it does nothing.
  - `traced(client: Anthropic, step: str) -> Anthropic`: returns `wrap_anthropic(client, chat_name=step)` when tracing is on, else the client unchanged. Called on the object that actually makes the call.
  - `trace_feature(feature: str, trigger: str = "manual")`: an async context manager over `langsmith.trace(name=feature, run_type="chain", tags=[feature, trigger], metadata={"feature": feature, "trigger": trigger})`. It is a plain pass-through when tracing is off, so it never changes behaviour, and it re-raises everything including cancellation.
- **Settings** (`app/config.py`, `.env.example`): `langsmith_tracing: bool = False`, `langsmith_api_key: str | None = None`, `langsmith_project: str = "trade-agent"`, `langsmith_hide_content: bool = False`.
- **Call sites** (three): `research._extract` calls `traced(client.with_options(timeout=60.0, max_retries=0), step)` and gains a `step` argument set by its five callers (`research`, `follow_up`, `mentions`, `thesis`, `synthesis`); `news.run_news_agent` traces its client as `news`; `chat.run_chat` as `chat`.
- **Entry points** open `trace_feature` inside the job body that does the Claude work, never around an HTTP handler or a task kickoff (a task outlives its request): the scan job (`app/discovery/jobs.py` `run_job`; `trigger="auto"` when started by the scheduled weekday discovery), `run_company` (`app/discovery/company_jobs.py`), the Today analysis `run_job` (`app/agents/jobs.py`; its `source` is `"manual"` or `"scheduled"`, which becomes the trigger), `run_chat` and the scheduled mentions command (`app/scheduled.py` `run_discovery_mentions`, `auto`). Worker threads and tasks copy the context, so the wrapped calls nest under the run's parent trace.
- **Costs in LangSmith:** token counts come from the Anthropic response. If LangSmith has no price for `claude-sonnet-5`, add a custom model price in its settings ($2 and $10 per million) so cost columns fill in.
- **Docs and checks:** `docs/ARCHITECTURE.md` (the four settings, that tracing is off by default and what leaves the machine); backend ruff, mypy and tests.

## Calls I made (open to correction)

- Wrap at the call site, not at client creation, for the `with_options` reason above.
- The step is the traced run's name, so a scan's calls read `research`, `follow_up`, `thesis`, `synthesis` in the trace tree.
- Off by default, and hiding of content is one switch rather than per-field masking.
- Not tracing the LangGraph node graph: the tokens are in the Anthropic calls, and fewer runs keeps the free trace allowance.

## Left to the builder

Exact function and setting names, where the startup call goes in `main.py`, test fixtures, and the stub client for tests (no network in tests: no real LangSmith endpoint is contacted).

## Owner's checks after it lands

1. Create a LangSmith account and API key, set the four settings in `backend/.env` (the `LANGSMITH_*` names), restart, run one scan and one company analysis on the dev key.
2. Confirm in LangSmith that the runs appear grouped by feature, with the step names and token counts; add the Sonnet 5 price if costs are blank.
3. If `langsmith_hide_content` is on, confirm token counts still show; if they do not, leave it off and rely on the second user's consent.
