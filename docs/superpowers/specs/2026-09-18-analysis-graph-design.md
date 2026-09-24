# Analysis Graph — Design Spec

Sub-project 2 of the trading agent platform (see `docs/ARCHITECTURE.md` for
the full system design). This is the second slice from the build order in
ARCHITECTURE.md §15: wire the LangGraph analysis graph and `POST
/analysis/run`, verified against real tickers with a real
`ANTHROPIC_API_KEY`.

Sub-project 1 (backend scaffold — models, holdings/watchlist/trades CRUD,
CI) is merged to `master`. This sub-project turns the previously-scaffolded
but unused `Recommendation` model, and the previously-unused
`max_single_position_pct`/`rsi_oversold`/`fundamental_buy_threshold`
config fields, into the thing they were built for.

## Scope

In scope:
- `backend/app/analysis/` — pure, deterministic scoring functions
  (fundamental score, technical signal, synthesizer). No I/O.
- `backend/app/agents/` — LangGraph orchestration: `market_data.py`
  (yfinance + Redis cache), `news.py` + `prompts.py` (Claude +
  `web_search_20250305`), `graph.py` (the `StateGraph` wiring), `jobs.py`
  (async job lifecycle backed by Redis)
- `backend/app/routers/analysis.py` — `POST /analysis/run`, `GET
  /analysis/run/{job_id}`, `GET /analysis/recommendations?status=`,
  `POST /analysis/recommendations/{id}/approve`, `.../reject`
- Local dev Redis via `docker-compose.yml` (Docker Desktop confirmed
  installed on this machine, not currently running)
- Unit tests for `analysis/` (no mocking — pure functions) and `agents/`
  (yfinance + Anthropic client mocked, per `backend/CLAUDE.md`)
- One manual verification run against real tickers (VWCE, AAPL) with a
  real `ANTHROPIC_API_KEY` — not part of the automated suite, costs real
  API usage

Out of scope (later sub-projects, per ARCHITECTURE.md §15):
- Frontend dashboard
- Supabase Auth / RLS
- MCP server
- Chat agent (phase 1/2)
- Scheduling `/analysis/run` on a cadence (§16 pre-launch checklist item,
  not this slice)

## Architecture & file structure

```
backend/app/
  analysis/
    fundamental.py     # score_fundamentals(info: dict) -> int | None (0-100, stocks only)
    technical.py         # score_technical(history) -> Literal["OVERSOLD","STRONG_UPTREND","WEAK_DOWNTREND","NEUTRAL"]
    recommend.py           # synthesize(...) -> (action, suggested_position_pct, reasoning)
  agents/
    market_data.py      # fetch_quote_and_history(ticker), fetch_fundamentals(ticker) — yfinance + Redis cache
    prompts.py             # news_agent system prompt, untrusted-web-content guardrail text
    news.py                   # run_news_agent(ticker, action, reasoning) -> str | None (ai_analysis)
    graph.py                   # StateGraph wiring: fetch_data -> {fundamental_agent, technical_agent} -> synthesizer -> news_agent
    jobs.py                     # create_job, run_job (asyncio background task), get_job_status
  routers/
    analysis.py             # the 5 endpoints
```

`analysis/` has zero LangGraph/Redis/HTTP dependency — pure functions,
directly unit-testable, matching `CLAUDE.md`'s "services raise domain
exceptions, not HTTPException" separation. `agents/` holds all
orchestration, caching, and external calls.

Redis has exactly two jobs here: **job status** (`/analysis/run/{job_id}`
polling) and the **quote/fundamentals cache** (5-15 min TTL, per §5). The
**final `Recommendation` rows are written to the DB**, not Redis — that's
the durable record `GET /analysis/recommendations?status=` and the
approve/reject endpoints query against.

## Job lifecycle

Job execution is an in-process `asyncio` background task, not a separate
worker process (RQ/Celery) — proportionate for a single-user tool; a job
dying on a server restart mid-run is an acceptable risk (re-run it), and
this avoids a second process to run locally and deploy.

Job status is stored as **Redis primitives, not a JSON blob**, to avoid a
lost-update race when multiple tickers finish around the same time inside
the same asyncio event loop (each Redis call is an `await` point, so two
concurrent ticker tasks could otherwise both read-modify-write the same
blob and lose an increment):

- `job:{job_id}` — a Redis **hash**: `{status, total, done}`. `done` is
  incremented via `HINCRBY` (atomic).
- `job:{job_id}:results` — a Redis **list**: each entry is a JSON string
  `{"ticker": "...", "recommendation_id": N}` or `{"ticker": "...",
  "error": "..."}`, appended via `RPUSH` (atomic).
- Both keys get `EXPIRE 3600` (1 hour) set at job creation.

```
POST /analysis/run {"tickers": [...]?}   (omit/empty -> all holdings + watchlist)
  -> job_id = uuid4()
  -> Redis: HSET job:{job_id} status=RUNNING total=N done=0; EXPIRE 3600 both keys
  -> asyncio.create_task(run_job(job_id, tickers))
  -> 202 {"job_id": job_id}

run_job(job_id, tickers):
  semaphore = asyncio.Semaphore(3)   # bound concurrent yfinance/Anthropic calls
  for each ticker, concurrently (bounded by semaphore):
    try:
      result_state = await run_graph_for_ticker(ticker, asset_type, is_held)
      recommendation = write Recommendation row to DB (status=PENDING)
      Redis: RPUSH job:{job_id}:results {"ticker": ticker, "recommendation_id": recommendation.id}
    except Exception as exc:
      log exc server-side (full detail)
      Redis: RPUSH job:{job_id}:results {"ticker": ticker, "error": "analysis failed"}  # sanitized, no raw exception text
    finally:
      Redis: HINCRBY job:{job_id} done 1
  Redis: HSET job:{job_id} status=DONE

GET /analysis/run/{job_id}
  -> HGETALL job:{job_id} + LRANGE job:{job_id}:results 0 -1
  -> 404 if the hash doesn't exist (never created, or expired)

GET /analysis/recommendations?status=PENDING
  -> DB query, independent of any job_id — "what's awaiting review right now"
```

`POST /analysis/run` itself only returns 500 if the job can't even be
created (e.g. Redis unreachable) — a per-ticker failure never fails the
job, it's recorded in that ticker's result entry.

## Per-ticker graph (`agents/graph.py`)

Matches ARCHITECTURE.md §6's diagram exactly:

```
fetch_data --> fundamental_agent --> synthesizer --> news_agent --> end
          \--> technical_agent  -->/
```

State (`AnalysisState`, a `TypedDict`): `ticker`, `asset_type`
(`"ETF"|"STOCK"`), `is_held` (bool, from whether the ticker exists in
`Holding`), `quote` (dict), `history` (list of closes/dates),
`fundamentals` (dict, empty for ETFs), `fundamental_score` (int | None),
`technical_signal` (str), `action`, `suggested_position_pct`,
`reasoning` (list[str]), `ai_analysis` (str | None).

- **`fetch_data`**: `market_data.fetch_quote_and_history(ticker)` always;
  `market_data.fetch_fundamentals(ticker)` only if `asset_type == "STOCK"`.
  Both cached in Redis (quote/history 5 min TTL, fundamentals 15 min TTL —
  fundamentals change far less often than price).
- **`fundamental_agent`**: `analysis.fundamental.score_fundamentals(fundamentals)`.
  No-ops (`fundamental_score = None`) for ETFs — still runs, just returns
  immediately, simpler than a conditional edge.
- **`technical_agent`**: `analysis.technical.score_technical(history)`.
- **`synthesizer`**: `analysis.recommend.synthesize(...)` — see Node
  algorithms below.
- **`news_agent`**: runs only if `action` isn't `HOLD`/none (§6). Skipped
  entirely if `ANTHROPIC_API_KEY` unset (already-specified degradation).
  Writes `ai_analysis` only — never touches `action` or
  `suggested_position_pct`.

## Node algorithms

**Fundamental score** (`analysis/fundamental.py`, stocks only, 0-100,
weighted points from yfinance's `info` dict — a missing/`None` metric
scores 0 for that factor rather than erroring, degrading gracefully per
§14's "ETF/thin-data" limitation, which also applies to stocks with
incomplete data):

| Factor | Thresholds → points |
|---|---|
| PEG ratio | ≤1.0→25, ≤2.0→15, else→0 |
| ROE | ≥20%→25, ≥10%→15, ≥0%→5, else→0 |
| Debt/Equity | ≤0.5→20, ≤1.5→10, else→0 |
| Revenue growth YoY | ≥15%→15, ≥5%→10, ≥0%→5, else→0 |
| Profit margin | ≥15%→15, ≥5%→8, else→0 |

Max 100 (25+25+20+15+15).

**Technical signal** (`analysis/technical.py`, all assets — weighted more
heavily for ETFs per §14): computes `sma_50`, `sma_200`, `rsi_14`,
drawdown from 52-week high from the price history, classifies into one
discrete signal (first match wins):
1. `OVERSOLD` — `rsi_14 <= settings.rsi_oversold` (default 30)
2. `STRONG_UPTREND` — `sma_50 > sma_200` and drawdown > -5% (near highs)
3. `WEAK_DOWNTREND` — `sma_50 < sma_200` and drawdown < -20%
4. `NEUTRAL` — none of the above

**Synthesizer** (`analysis/recommend.py`) — **fundamentals gate,
technicals time, never reverse** (§6, non-negotiable):

- Stocks: `fundamental_score >= settings.fundamental_buy_threshold`
  (default 60) gates BUY/ADD eligibility. Within the gate: `OVERSOLD` →
  BUY (not held) / ADD (held); otherwise → WATCH (not held) / HOLD
  (held). Below the gate, held: score <40 → SELL, else → TRIM. Below the
  gate, not held: `WATCH` if score >=40, otherwise no recommendation
  emitted for that ticker at all (not worth surfacing).
- ETFs: no fundamental gate (thin data, §14) — technical signal alone
  drives the action, evaluated in this order: held + `OVERSOLD` → ADD;
  held + `WEAK_DOWNTREND` → TRIM; held + anything else → HOLD; not held +
  (`OVERSOLD` or `STRONG_UPTREND`) → BUY; not held + anything else →
  WATCH.
- `suggested_position_pct`: only set on BUY/ADD, capped at
  `settings.max_single_position_pct`; full cap when conviction is strong
  (fundamental score ≥80 for stocks, or `STRONG_UPTREND` + `OVERSOLD`
  combination for ETFs), half the cap otherwise.
- `reasoning`: the concrete computed numbers (e.g. `"PEG 1.1, ROE 18%,
  D/E 0.4, revenue growth 12%, margin 22%"`, `"RSI 28 (oversold)"`).

These exact thresholds/weights are this spec's proposal (approved in
brainstorming), not a value ARCHITECTURE.md itself mandates numerically —
they're tunable later without a schema change, since they're config
(`settings.*`) or plain constants, not hardcoded in the graph shape.

## Configuration additions

`backend/app/config.py` — no new fields needed; `max_single_position_pct`,
`rsi_oversold`, `fundamental_buy_threshold` already exist (added in
sub-project 1, unused until now).

`backend/.env.example` additions:
```
REDIS_URL=redis://localhost:6379/0
ANTHROPIC_API_KEY=
```

`backend/docker-compose.yml` (new) — single `redis:7-alpine` service,
port 6379, for local dev parity with the hosted Upstash instance (no
divergent code path between local and hosted).

## Error handling

A single ticker's failure (yfinance 404, Anthropic timeout/error, bad
data) never fails the whole job — caught per-ticker inside `run_job`,
recorded in that ticker's result entry as `{"ticker": X, "error": "..."}`.
Exception text is sanitized before storage/return (§16's explicit
checklist item): the real exception is logged server-side with full
detail; only a generic message is persisted to Redis or returned to the
client. Job-level `FAILED` doesn't currently occur in this design — a job
that starts always reaches `DONE` (individual ticker errors are absorbed,
not propagated); only job *creation* itself (e.g. Redis unreachable) can
fail, and that surfaces as a `500` on `POST /analysis/run`, never as a
job state to poll for.

## Testing

- `analysis/fundamental.py`, `analysis/technical.py`, `analysis/recommend.py`
  — pure functions, unit tested directly with plain input dicts/lists, no
  mocking, per §16's highest-value-tests guidance.
- `agents/market_data.py`, `agents/news.py`, `agents/graph.py` — yfinance
  and the Anthropic client mocked in every test, per `backend/CLAUDE.md`'s
  existing rule ("never call real external APIs in tests").
- `agents/jobs.py` — tested against a real Redis (the same
  `docker-compose.yml` service; job-state logic isn't meaningfully
  testable against a mock without re-implementing Redis's semantics).
- `routers/analysis.py` — `TestClient` + mocked graph execution, same
  pattern as the existing `routers/portfolio.py` tests.
- **Manual verification** (not automated): after the above all pass, run
  `POST /analysis/run {"tickers": ["VWCE", "AAPL"]}` against real
  yfinance + a real `ANTHROPIC_API_KEY`, confirm both a `STOCK` and an
  `ETF` path produce a sane `Recommendation` row. Costs real API usage —
  run once by hand, not on every CI push.
