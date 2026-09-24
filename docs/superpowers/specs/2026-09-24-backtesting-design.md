# Backtesting — Design Spec

First of four related sub-projects for evolving the analysis agent (the
other three — a prebuilt agent harness, long-term memory in a vector DB,
and richer context assembly — are each their own future spec/plan cycle,
decided in that order during brainstorming). This sub-project answers the
highest-value question first: does the technical-signal logic already
built (`analysis/technical.py`, `analysis/recommend.py`) actually produce
good calls on real historical data, before investing in a harness
migration, memory, or context-assembly machinery around it.

## Scope

In scope:
- Historical price fetch: `agents/market_data.py` gains
  `fetch_price_history(ticker, start, end)`, long-TTL cached (24h — a
  closed historical range never changes).
- `backend/app/backtest/engine.py` — pure simulation logic, no I/O:
  walks a closes series day by day with an **expanding window** (no
  lookahead), reusing `analysis/technical.score_technical` and
  `analysis/recommend.synthesize` **unmodified**.
- `backend/app/backtest/jobs.py` — async job wrapper (mirrors
  `agents/jobs.py`'s pattern: Redis status hash, in-process `asyncio`
  background task), writes the finished result to a new
  `BacktestResult` DB table.
- `routers/backtest.py`: `POST /backtest/run`, `GET
  /backtest/run/{job_id}`, `GET /backtest/results?ticker=`.
- Two metrics per run: buy-and-hold comparison, signal hit-rate by type.

**Explicitly technical-only** (per brainstorming decision): yfinance only
exposes *current* fundamentals, not point-in-time historical fundamentals,
so backtesting the fundamental gate would require either a paid data
source or accepting lookahead bias. Every backtested ticker is evaluated
as if `asset_type == "ETF"` regardless of its real type — this is exactly
`recommend.synthesize`'s existing technical-only decision path (no
fundamental gate), reused as-is rather than duplicated. Full-pipeline
(fundamentals-included) backtesting is a possible future extension if a
paid historical-fundamentals source is ever added — not this sub-project.

Out of scope:
- Fundamentals in the backtest (see above).
- Portfolio-level (multi-ticker) backtesting — one ticker per run.
- The other three brainstormed ideas (harness, memory, context assembly).

## Architecture

```
backend/app/backtest/
  __init__.py
  engine.py          # simulate(closes, dates) -> BacktestMetrics — pure, no I/O
  jobs.py             # create_job, run_job, get_job_status — mirrors agents/jobs.py
backend/app/routers/backtest.py
```

`engine.py` has zero Redis/DB/yfinance dependency — same separation
principle as `analysis/`: pure functions, directly unit-testable with a
synthetic closes list (the same hand-constructed OVERSOLD/STRONG_UPTREND/
WEAK_DOWNTREND series pattern already used in `test_analysis_technical.py`).

## Simulation mechanics (`engine.py`)

```python
def simulate(closes: list[float]) -> BacktestMetrics:
```

Takes closes only, no dates — every mechanic below (buy-and-hold
comparison, hit-rate lookback) is indexed by trading-day position, not
calendar date, so there's nothing for a `dates` list to do here.

Starting state: `capital = 10_000.0` (fixed notional, module constant —
not user-configurable, YAGNI), all cash, `is_held = False`, `shares = 0.0`.

For each day `i` in the range (expanding window, `closes[:i+1]`, so day
`i`'s signal only ever sees data through day `i` — no lookahead):

1. `signal = technical.score_technical(closes[: i + 1])`
2. `action, suggested_position_pct, _ = recommend.synthesize(asset_type="ETF", is_held=is_held, fundamental_score=None, technical_signal=signal)`
3. Apply the action to simulated state, at that day's `closes[i]`:
   - `BUY`: invest `suggested_position_pct * capital` (the portion of
     the original notional, not remaining cash), capped at whatever cash
     is actually available (`min(suggested_position_pct * capital,
     cash)`) so repeated buys can never overdraw; into shares, `is_held = True`.
   - `ADD`: invest the same way (same cap), adding to the existing share count.
   - `TRIM`: sell half the current share count (simulator-level
     convention — `synthesize` doesn't return a magnitude for TRIM, only
     BUY/ADD carry `suggested_position_pct`; confirmed with the user
     during brainstorming).
   - `HOLD` / `WATCH` / `None`: no-op.
4. Record `portfolio_value(i) = cash + shares * closes[i]`.

After the walk:
- `final_value = portfolio_value(last day)`
- `buy_and_hold_value = capital / closes[0] * closes[-1]` (buy the full
  notional on day 0, hold, no trading)
- `excess_return_pct = (final_value - buy_and_hold_value) / buy_and_hold_value`

**Signal hit-rate**, computed in the same pass: for every day `i` where
`signal != "NEUTRAL"` and `i + HIT_RATE_LOOKAHEAD_DAYS < len(closes)`
(`HIT_RATE_LOOKAHEAD_DAYS = 20`, a module constant — ~1 month of trading
days), record `(closes[i + 20] - closes[i]) / closes[i]`. Group by signal
type, report `{signal: {count, avg_forward_return_pct}}`.

`BacktestMetrics` (a dataclass or TypedDict): `final_value: float`,
`buy_and_hold_value: float`, `excess_return_pct: float`,
`hit_rate_by_signal: dict[str, dict[str, float]]`.

## Data source

`agents/market_data.py` addition:

```python
async def fetch_price_history(ticker: str, start: date, end: date) -> list[float]:
```

Cache key `history:{ticker}:{start.isoformat()}:{end.isoformat()}`, TTL
86400s (24h) — distinct from `fetch_quote_and_history`'s 300s TTL, since
a closed historical range is immutable while the live 1-year window
shifts daily. Same `asyncio.to_thread`-wrapped `yf.Ticker(...).history(...)`
pattern as the existing function.

## Job lifecycle & API

Simpler than `agents/jobs.py` (one ticker per run, not N tickers
concurrently — no semaphore, no results list):

```
POST /backtest/run {"ticker": "AAPL", "start_date": "2020-01-01", "end_date": "2025-01-01"}
  -> job_id = uuid4()
  -> Redis: HSET backtest_job:{job_id} status=RUNNING; EXPIRE 3600
  -> asyncio.create_task(run_backtest_job(job_id, ticker, start, end))  # same
     retained-reference + done-callback pattern as routers/analysis.py
  -> 202 {"job_id": job_id}

run_backtest_job(job_id, ticker, start, end):
  try:
    closes = await market_data.fetch_price_history(ticker, start, end)
    metrics = engine.simulate(closes)
    result = write BacktestResult row (status=DONE)
    Redis: HSET backtest_job:{job_id} status=DONE backtest_result_id=result.id
  except Exception:
    logger.exception(...)  # full detail server-side
    Redis: HSET backtest_job:{job_id} status=FAILED  # sanitized, no raw exception text

GET /backtest/run/{job_id}
  -> {"status": "RUNNING"|"DONE"|"FAILED", "backtest_result_id": N | null}
  -> 404 if job_id unknown/expired

GET /backtest/results?ticker=AAPL
  -> [BacktestResult...]   # persisted rows, queryable without re-running
```

## Data model

New `BacktestResult` (in `models.py`, alongside `Recommendation`):

```python
class BacktestResult(Base):
    __tablename__ = "backtest_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ticker: Mapped[str] = mapped_column(String(20))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    final_value: Mapped[float] = mapped_column(Numeric(18, 2))
    buy_and_hold_value: Mapped[float] = mapped_column(Numeric(18, 2))
    excess_return_pct: Mapped[float] = mapped_column(Numeric(8, 4))
    hit_rate_by_signal: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(10))  # "DONE" (only successful runs persist a row)
```

Only successful runs write a row — a failed job's `FAILED` status lives
only in Redis (ephemeral, 1h TTL), matching how `agents/jobs.py` handles
per-ticker failures (sanitized, not persisted as a durable record).

Needs an Alembic migration (`alembic revision --autogenerate`).

## Error handling

Same sanitization rule as `agents/jobs.py`: real exceptions logged
server-side via `logging`, never persisted or returned raw. A ticker
yfinance can't resolve, or a date range with no trading days, surfaces as
job `status: "FAILED"` with no `BacktestResult` row — not a 500 on
`POST /backtest/run` itself (mirrors the existing "the job always reaches
a terminal state" design from the analysis sub-project).

## Testing

- `engine.simulate` — pure function, unit tested directly with synthetic
  `(dates, closes)` series (no mocking), reusing the same OVERSOLD/
  STRONG_UPTREND/WEAK_DOWNTREND/NEUTRAL construction patterns from
  `test_analysis_technical.py`. Cases: a pure buy-and-hold-beating series,
  a series with a TRIM event, a series with no non-NEUTRAL signals at all
  (metrics should show `hit_rate_by_signal == {}`).
- `market_data.fetch_price_history` — yfinance and Redis mocked, same
  pattern as `fetch_quote_and_history`'s existing tests.
- `backtest/jobs.py` — real Redis (per this project's established rule:
  job-state semantics aren't meaningfully mockable), `engine.simulate`
  and `fetch_price_history` mocked.
- `routers/backtest.py` — `TestClient` + mocked job functions, same
  pattern as `routers/analysis.py`'s tests.
