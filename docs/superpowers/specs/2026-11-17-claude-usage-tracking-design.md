# Claude token tracking per feature (short design)

Date: 2026-11-17. Status: draft for the owner's approval. Size: a small change (one helper, three Anthropic call sites, five run entry points, one admin read endpoint and table).

## Intent

Running the New-ideas scan and the Discover catalog analysis three or four times uses up the Claude budget. The owner wants to cut the consumption without lowering the quality of the analysis. Nothing in the agent records tokens today, so nobody can say which feature, or which step inside it, costs what. This change measures first. Cost cuts come afterwards, each judged against these numbers.

What the Anthropic console export for 19 Oct to 17 Nov already shows (Sonnet 5 lists at $2 per million input tokens and $10 per million output tokens; no call uses prompt caching):

- A scan-sized run (Tavily search plus Claude extraction, no Claude web search) costs about $2.50 to $4.50, and output tokens are about 60% of it.
- A Today web-search analysis costs about $1: 23k to 52k input tokens per search, because each result is read back into the prompt. The $0.01 search fee is negligible.
- The export is per API key and day, so it cannot separate the scan from the catalog analysis. That split is what this change adds.

## Goals

- For every Claude call, count input, output, cache-read and cache-write tokens and web searches, tagged by feature (`scan`, `company`, `analysis`, `chat`, `mentions`), by trigger (`manual`, or `auto` for the weekday jobs the owner switches on in Preferences: "Analyze my portfolio automatically each weekday" and "Discover new ideas automatically each weekday") and by step (`research`, `follow_up`, `thesis`, `synthesis`, `news`, `chat`, `mentions`).
- One log line per finished run with its totals, so a single run's cost can be read straight after it.
- Daily totals per feature and step, kept for 40 days, readable by an admin (endpoint plus a table on the admin Usage & limits page) with an estimated dollar cost.
- No change to any prompt, model, limit or result (`_extract` only gains a label argument).

## Non-goals

- Reducing tokens (prompt caching, smaller output caps, a cheaper model, skipping unchanged tickers). Each is its own design once the numbers are in.
- Per-user breakdowns, token-based monthly limits, billing.
- Storing prompts, responses or any ticker or holding data with the counters.

## Anti-goals

- A counter that changes behaviour: a failure to record must never fail or slow a Claude call, a run or a request.
- Numbers that pass for exact: the dollar figure is an estimate from list prices in settings and is reconciled against the console, not authoritative. A call that fails before the API returns a `usage` block (timeout, error after billing) is not counted, so the totals can undercount slightly; this is accepted and said on the admin table.

## Constraints

- Advisory only; nothing here touches orders.
- Backend rules: sync Anthropic client stays wrapped in `asyncio.to_thread`; no raw exception text logged; services raise domain errors; Pydantic v2; mypy, ruff, tests as in `backend/AGENTS.md`.
- Admin-only read (the existing admin dependency); no migration (Redis, like `app/usage.py`).
- Calls made with a user's own saved key are counted the same as server-key calls.

## Approaches

1. **In-app tally (chosen).** Each run opens a tally held in a context variable; the call sites add the `usage` block of each Anthropic response to it (thread-safe, no I/O in the worker thread); the run's end flushes it to Redis daily counters and writes the log line. Splits by feature and step, costs one helper and a few lines per call site, adds nothing to run.
2. **Poll Anthropic's usage and cost reporting.** No code in the calls, but it only breaks down by key, model and day, which is what the export already gives. It cannot split the scan from the catalog analysis.
3. **A tracing service (LangSmith, Langfuse).** Detailed per-call traces, but LangSmith is hosted and would send prompts and holdings to a third party, and Langfuse is one more service to run. Too much for six call sites.

## Design

- **`app/claude_usage.py`** (new).
  - `track(feature, trigger="manual")`: an async context manager that opens a tally and, on exit, flushes it and writes the log line. If a tally is already open it is a no-op, so features never nest and calls are counted once, under the outer feature.
  - `record(response, step)`: called right after each `messages.create`, adds `response.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `server_tool_use.web_search_requests`) and the response `model` to the current tally under the step. It does nothing when no tally is open and never raises.
  - `estimate_cost(...)` and `daily_totals(days)` for the admin read.
- **The tally** is one object created by `track()` and held in a context variable. Tasks and `asyncio.to_thread` workers copy the context, so they all see the same object; code must only mutate it (under a `threading.Lock`), never call `ContextVar.set` inside a task. Research runs several `_extract` calls in parallel, so the lock is required.
- **Where `track()` opens:** inside the job body that does the Claude work, never around the HTTP handler or the task kickoff (a task outlives its request): the scan job (`app/discovery/jobs.py` `run_job`; `auto` when started by the scheduled weekday discovery), `run_company` (`app/discovery/company_jobs.py`), the Today analysis `run_job` (`app/agents/jobs.py`; it already carries `source`, `"manual"` or the scheduled value, which becomes the trigger), `run_chat` (`app/agents/chat.py`) and the forum-mentions command in `app/scheduled.py`. Cancellation and timeouts still flush (`finally`), and `CancelledError` is re-raised.
- **Call sites** (three) call `record` inside the worker thread immediately after `messages.create`, before any `stop_reason` check, so a call that hits its output cap and is then discarded is still counted: `research._extract` (gains a `step` argument, set by its five callers: `research` and `follow_up` in `research.py`, `mentions` in `discover_mentions`, `thesis` and `synthesis` in `discovery_graph.py`), `news.run_news_agent` (`news`, used by the Today analysis only) and `chat.run_chat` (`chat`).
- **Redis:** one hash per UTC day and feature, `claude_usage:{YYYY-MM-DD}:{feature}:{trigger}`, fields `{step}:{model}:{metric}` with metrics `calls`, `input`, `output`, `cache_read`, `cache_write`, `searches`. The flush is one `MULTI` pipeline (all `HINCRBY`s plus `EXPIRE` 40 days), awaited with a 2-second timeout, and any failure (Redis down, timeout) is logged by class name and dropped; the run is never failed or held up. The `mentions` command awaits its flush before the process closes its event loop.
- **Admin read:** `GET /admin/claude-usage?days=N` (`N` from 1 to 40, default 30) returns per day, feature and trigger the totals per step and model and an estimated cost; the admin Usage & limits page shows it as a small table with a 7/30-day switch and a note that failed calls are not counted.
- **Prices** live in settings per model (`input`, `output`, `cache_read`, `cache_write`, `search`), with the Sonnet 5 values above. A model with no price entry shows tokens but no cost. Cache writes are one `cache_write` metric priced at the 5-minute rate; the table is labelled an estimate.
- **Docs and checks:** `docs/ARCHITECTURE.md` gets the endpoint and the `claude_usage:*` keys; backend ruff, mypy and tests, and the frontend lint, typecheck and tests per each `AGENTS.md`.

## Calls I made (open to correction)

- Admin-only and per feature, not per user: the question is which feature costs what, and a per-user split can be added later without changing the call sites.
- Redis, not a database table: no migration or RLS work, and 40 days covers a monthly review.
- The step names above, so the scan's cost can be split into research, follow-up, thesis and synthesis.

## Left to the builder

Exact function and setting names, the log line wording, the admin table layout (follow the existing page), and test fixtures (a fake Anthropic response with a `usage` block; tests for a capped call still being counted, parallel calls summing correctly, a nested `track` being a no-op, and a Redis failure not failing the run).
