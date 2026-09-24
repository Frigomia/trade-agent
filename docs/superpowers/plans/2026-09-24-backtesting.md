# Backtesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replay the existing technical-signal logic (`analysis/technical.py`, `analysis/recommend.py`) against real historical prices, so `POST /backtest/run` produces a persisted `BacktestResult` with buy-and-hold comparison and signal hit-rate for any ticker/date range.

**Architecture:** A pure, I/O-free `simulate()` function in `backend/app/backtest/engine.py` walks a closes series day-by-day with an expanding window, reusing the already-built `technical.score_technical` and `recommend.synthesize` **unmodified** (always called with `asset_type="ETF"`, `fundamental_score=None` — the existing technical-only decision path). `backend/app/backtest/jobs.py` mirrors `agents/jobs.py`'s Redis-status + `asyncio` background-task pattern, simplified for a single ticker per run, and persists the finished result as a `BacktestResult` row.

**Tech Stack:** `yfinance` (historical price fetch), `redis.asyncio`, FastAPI, SQLAlchemy, Alembic — all already-pinned dependencies, no new ones.

**Spec:** `docs/superpowers/specs/2026-09-24-backtesting-design.md`

## Global Constraints

- Python 3.12, managed via `uv` — run tests as `uv run python -m pytest tests/ -v` from `backend/` (needs `-m pytest`, not bare `pytest`, so `backend/` lands on `sys.path`).
- `ruff check .`, `ruff format --check .`, and `mypy app` (strict) must all pass before any commit, per `backend/CLAUDE.md`.
- **Technical-only, by design.** `engine.simulate` always calls `recommend.synthesize(asset_type="ETF", fundamental_score=None, ...)` — the existing ETF (no fundamental gate) decision path. Do not edit `analysis/technical.py` or `analysis/recommend.py` in this plan; they're reused exactly as they are.
- **Never places a trade.** `engine.simulate`'s BUY/ADD/TRIM/SELL actions are in-memory bookkeeping over a `cash`/`shares` pair local to the function — they never touch the `Trade`/`Holding` tables and never call a broker API.
- Every DB query/write scoped to `settings.default_user_id`.
- Blocking calls (`yfinance`) wrapped in `asyncio.to_thread` — same pattern as the existing `agents/market_data.py` functions.
- Exception text is sanitized before persisting/returning: log the real exception server-side via `logging`, never `print`; store/return only a generic status (`"FAILED"`).
- Redis job-status keys are namespaced `backtest_job:{job_id}` — distinct from the analysis pipeline's `job:{job_id}`, same Redis instance.
- Only successful runs persist a `BacktestResult` row; a failed job's `"FAILED"` status lives only in Redis (1h TTL), matching `agents/jobs.py`'s per-ticker failure handling.
- Docker Redis (`docker compose up -d redis` from `backend/`) must be running for Task 4's and Task 5's tests, and for Task 6's manual verification.
- Tests: `backtest/engine.py` is a pure function, unit tested directly with no mocking (synthetic closes lists). `agents/market_data.py`'s new function mocks yfinance and Redis, same pattern as its existing functions. `backtest/jobs.py` tests run against real Redis (job-state semantics aren't meaningfully mockable, established in the analysis-graph sub-project) with the existing `session_local` conftest fixture, and mock `fetch_price_history`/`simulate`. `routers/backtest.py` tests use `TestClient` + mocked job functions, same pattern as `routers/analysis.py`'s tests.

---

### Task 1: Historical price fetch

**Files:**
- Modify: `backend/app/agents/market_data.py`
- Test: `backend/tests/test_agents_market_data.py`

**Interfaces:**
- Produces: `app.agents.market_data.fetch_price_history(ticker: str, start: date, end: date) -> list[float]` — Redis-cached 24h (`history:{ticker}:{start.isoformat()}:{end.isoformat()}`, distinct cache key/TTL from `fetch_quote_and_history`'s 5-minute quote cache, since a closed historical range never changes).

- [ ] **Step 1: Add the import and append the failing tests to `backend/tests/test_agents_market_data.py`**

Change the top of the file from:
```python
from unittest.mock import AsyncMock, MagicMock, patch

from app.agents.market_data import fetch_fundamentals, fetch_quote_and_history
```
to:
```python
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

from app.agents.market_data import fetch_fundamentals, fetch_price_history, fetch_quote_and_history
```

Append at the end of the file:
```python
def test_fetch_price_history_cache_miss_calls_yfinance():
    fake_ticker = MagicMock()
    fake_ticker.history.return_value.__getitem__.return_value.tolist.return_value = [
        200.0,
        201.0,
        202.0,
    ]

    with (
        patch("app.agents.market_data.yf.Ticker", return_value=fake_ticker) as mock_yf,
        patch("app.agents.market_data.get_redis") as mock_get_redis,
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = None
        mock_get_redis.return_value = mock_redis

        import asyncio

        result = asyncio.run(fetch_price_history("AAPL", date(2020, 1, 1), date(2024, 1, 1)))

    mock_yf.assert_called_once_with("AAPL")
    fake_ticker.history.assert_called_once_with(start=date(2020, 1, 1), end=date(2024, 1, 1))
    assert result == [200.0, 201.0, 202.0]
    mock_redis.set.assert_called_once()
    assert mock_redis.set.call_args.kwargs["ex"] == 86400


def test_fetch_price_history_cache_hit_skips_yfinance():
    with (
        patch("app.agents.market_data.yf.Ticker") as mock_yf,
        patch("app.agents.market_data.get_redis") as mock_get_redis,
    ):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = "[199.0, 200.0]"
        mock_get_redis.return_value = mock_redis

        import asyncio

        result = asyncio.run(fetch_price_history("AAPL", date(2020, 1, 1), date(2024, 1, 1)))

    mock_yf.assert_not_called()
    assert result == [199.0, 200.0]
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `uv run python -m pytest tests/test_agents_market_data.py -v`
Expected: FAIL — `ImportError: cannot import name 'fetch_price_history'`

- [ ] **Step 3: Add `fetch_price_history` to `backend/app/agents/market_data.py`**

Change the top of the file from:
```python
import asyncio
import json
from typing import Any

import yfinance as yf

from app.redis_client import get_redis

QUOTE_CACHE_TTL = 300
FUNDAMENTALS_CACHE_TTL = 900
```
to:
```python
import asyncio
import json
from datetime import date
from typing import Any

import yfinance as yf

from app.redis_client import get_redis

QUOTE_CACHE_TTL = 300
FUNDAMENTALS_CACHE_TTL = 900
HISTORY_CACHE_TTL = 86400
```

Append at the end of the file:
```python
async def fetch_price_history(ticker: str, start: date, end: date) -> list[float]:
    redis = get_redis()
    cache_key = f"history:{ticker}:{start.isoformat()}:{end.isoformat()}"
    cached = await redis.get(cache_key)
    if cached is not None:
        return list(json.loads(cached))

    def _fetch() -> list[float]:
        history = yf.Ticker(ticker).history(start=start, end=end)
        closes: list[float] = history["Close"].tolist()
        return closes

    result = await asyncio.to_thread(_fetch)
    await redis.set(cache_key, json.dumps(result), ex=HISTORY_CACHE_TTL)
    return result
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `uv run python -m pytest tests/test_agents_market_data.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/agents/market_data.py backend/tests/test_agents_market_data.py
git commit -m "Add historical price fetch for backtesting"
```

---

### Task 2: Backtest engine (pure simulation)

**Files:**
- Create: `backend/app/backtest/__init__.py` (empty)
- Create: `backend/app/backtest/engine.py`
- Test: `backend/tests/test_backtest_engine.py`

**Interfaces:**
- Consumes: `app.analysis.technical.score_technical(closes: list[float]) -> str` (existing, unmodified), `app.analysis.recommend.synthesize(asset_type, is_held, fundamental_score, technical_signal) -> tuple[str | None, float | None, list[str]]` (existing, unmodified)
- Produces: `app.backtest.engine.BacktestMetrics` — dataclass: `final_value: float`, `buy_and_hold_value: float`, `excess_return_pct: float`, `hit_rate_by_signal: dict[str, dict[str, float]]`
- Produces: `app.backtest.engine.simulate(closes: list[float]) -> BacktestMetrics`
- Produces: `app.backtest.engine.STARTING_CAPITAL: float = 10_000.0` (used by Task 4's tests to build fake metrics)

- [ ] **Step 1: Write the failing tests — `backend/tests/test_backtest_engine.py`**

```python
import pytest

from app.backtest.engine import simulate


def test_simulate_buys_the_dip_and_beats_buy_and_hold():
    flat = [150.0] * 200
    decline = [150.0 - i for i in range(1, 15)]
    recovery = [136.0 + i * 0.5 for i in range(1, 41)]
    closes = flat + decline + recovery

    metrics = simulate(closes)

    assert metrics.final_value == pytest.approx(10675.829534817442)
    assert metrics.buy_and_hold_value == pytest.approx(10400.0)
    assert metrics.excess_return_pct == pytest.approx(0.026522070655523224)
    assert metrics.hit_rate_by_signal.keys() == {"OVERSOLD"}
    assert metrics.hit_rate_by_signal["OVERSOLD"]["count"] == pytest.approx(20.0)
    assert metrics.hit_rate_by_signal["OVERSOLD"]["avg_forward_return_pct"] == pytest.approx(
        0.023849938336244644
    )


def test_simulate_trims_on_weak_downtrend_after_holding():
    # Oscillating baseline (avoids RSI pinning at 0 on the first down-tick
    # after a dead-flat run), a sharp dip that triggers an OVERSOLD buy, a
    # small bounce, then a shallow multi-week bleed that clears 20%+
    # drawdown while staying above the OVERSOLD RSI threshold -- this is
    # what actually reaches the WEAK_DOWNTREND branch (TRIM), since a
    # steady/sharp decline keeps tripping OVERSOLD instead.
    base = [150.0 + (0.5 if i % 2 == 0 else 0.0) for i in range(200)]
    sharp_dip = [150.0 - i for i in range(1, 15)]
    recover = [136.0 + i for i in range(1, 11)]
    gentle: list[float] = []
    price = recover[-1]
    for _ in range(110):
        price -= 1.0
        gentle.append(price)
        price += 0.7
        gentle.append(price)
    closes = (base + sharp_dip + recover + gentle)[:390]

    metrics = simulate(closes)

    # A TRIM fires partway through this series (not directly observable from
    # BacktestMetrics alone) -- final_value/buy_and_hold_value pin down the
    # exact bookkeeping so a regression that breaks TRIM's cash/shares split
    # changes these numbers.
    assert metrics.final_value == pytest.approx(8378.195019304001)
    assert metrics.buy_and_hold_value == pytest.approx(8046.511627906936)
    assert metrics.excess_return_pct == pytest.approx(0.04122076829501117)
    assert metrics.hit_rate_by_signal.keys() == {"OVERSOLD"}


def test_simulate_flat_series_has_no_signals_or_trades():
    closes = [150.0] * 220

    metrics = simulate(closes)

    assert metrics.final_value == pytest.approx(10000.0)
    assert metrics.buy_and_hold_value == pytest.approx(10000.0)
    assert metrics.excess_return_pct == pytest.approx(0.0)
    assert metrics.hit_rate_by_signal == {}
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `uv run python -m pytest tests/test_backtest_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.backtest'`

- [ ] **Step 3: Create `backend/app/backtest/__init__.py`** (empty file)

- [ ] **Step 4: Create `backend/app/backtest/engine.py`**

```python
from dataclasses import dataclass

from app.analysis import recommend, technical

STARTING_CAPITAL = 10_000.0
HIT_RATE_LOOKAHEAD_DAYS = 20


@dataclass
class BacktestMetrics:
    final_value: float
    buy_and_hold_value: float
    excess_return_pct: float
    hit_rate_by_signal: dict[str, dict[str, float]]


def simulate(closes: list[float]) -> BacktestMetrics:
    cash = STARTING_CAPITAL
    shares = 0.0
    is_held = False
    forward_returns_by_signal: dict[str, list[float]] = {}

    for i in range(len(closes)):
        window = closes[: i + 1]
        signal = technical.score_technical(window)
        action, suggested_position_pct, _ = recommend.synthesize(
            asset_type="ETF",
            is_held=is_held,
            fundamental_score=None,
            technical_signal=signal,
        )
        price = closes[i]

        if action in ("BUY", "ADD") and suggested_position_pct is not None:
            # Portion of the original notional, capped by remaining cash so
            # repeated BUY/ADD signals can never overdraw.
            invest = min(suggested_position_pct * STARTING_CAPITAL, cash)
            shares += invest / price
            cash -= invest
            is_held = True
        elif action == "TRIM":
            # synthesize() doesn't return a magnitude for TRIM -- simulator
            # convention: sell half the current position.
            proceeds = shares * 0.5 * price
            shares *= 0.5
            cash += proceeds

        if signal != "NEUTRAL" and i + HIT_RATE_LOOKAHEAD_DAYS < len(closes):
            forward_return = (closes[i + HIT_RATE_LOOKAHEAD_DAYS] - price) / price
            forward_returns_by_signal.setdefault(signal, []).append(forward_return)

    final_value = cash + shares * closes[-1]
    buy_and_hold_value = STARTING_CAPITAL / closes[0] * closes[-1]
    excess_return_pct = (final_value - buy_and_hold_value) / buy_and_hold_value

    hit_rate_by_signal = {
        signal: {
            "count": float(len(returns)),
            "avg_forward_return_pct": sum(returns) / len(returns),
        }
        for signal, returns in forward_returns_by_signal.items()
    }

    return BacktestMetrics(
        final_value=final_value,
        buy_and_hold_value=buy_and_hold_value,
        excess_return_pct=excess_return_pct,
        hit_rate_by_signal=hit_rate_by_signal,
    )
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `uv run python -m pytest tests/test_backtest_engine.py -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/app/backtest/__init__.py backend/app/backtest/engine.py backend/tests/test_backtest_engine.py
git commit -m "Add backtest simulation engine"
```

---

### Task 3: `BacktestResult` model + migration

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/migrations/versions/<autogenerated>.py` (via Alembic, not hand-written)
- Test: `backend/tests/test_models_backtest_result.py`

**Interfaces:**
- Produces: `app.models.BacktestResult` (SQLAlchemy model, table `backtest_results`) — `id: int`, `user_id: UUID`, `created_at: datetime`, `ticker: str`, `start_date: date`, `end_date: date`, `final_value: float`, `buy_and_hold_value: float`, `excess_return_pct: float`, `hit_rate_by_signal: dict[str, dict[str, float]]`, `status: str`

- [ ] **Step 1: Write the failing test — `backend/tests/test_models_backtest_result.py`**

```python
from datetime import date

import pytest

from app.config import settings
from app.models import BacktestResult


def test_backtest_result_roundtrip(db_session):
    result = BacktestResult(
        user_id=settings.default_user_id,
        ticker="AAPL",
        start_date=date(2020, 1, 1),
        end_date=date(2024, 1, 1),
        final_value=12000.50,
        buy_and_hold_value=11000.25,
        excess_return_pct=0.0909,
        hit_rate_by_signal={"OVERSOLD": {"count": 5.0, "avg_forward_return_pct": 0.02}},
        status="DONE",
    )
    db_session.add(result)
    db_session.commit()
    db_session.refresh(result)

    assert result.id is not None
    assert result.final_value == pytest.approx(12000.50)
    assert result.hit_rate_by_signal == {"OVERSOLD": {"count": 5.0, "avg_forward_return_pct": 0.02}}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `uv run python -m pytest tests/test_models_backtest_result.py -v`
Expected: FAIL — `ImportError: cannot import name 'BacktestResult'`

- [ ] **Step 3: Add `BacktestResult` to `backend/app/models.py`**

Change the top-of-file import line from:
```python
from sqlalchemy import JSON, Date, DateTime, Numeric, String, Text, UniqueConstraint, Uuid, func
```
(it already imports everything this model needs — no change required if it already reads this way; confirm before editing.)

Append at the end of the file, after `ChatMessage`:
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
    hit_rate_by_signal: Mapped[dict[str, dict[str, float]]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(10))  # "DONE" -- only successful runs persist a row
```

- [ ] **Step 4: Run test, verify it passes**

Run: `uv run python -m pytest tests/test_models_backtest_result.py -v`
Expected: PASS (1 test) — the test's `db_session` fixture builds its table from `Base.metadata.create_all`, so this passes before any migration exists.

- [ ] **Step 5: Generate and apply the Alembic migration**

Run (from `backend/`):
```bash
uv run alembic revision --autogenerate -m "add backtest_results table"
```
Expected: a new file under `backend/migrations/versions/` containing an `op.create_table("backtest_results", ...)` for exactly the columns above. Do not hand-edit it beyond what autogenerate produced (per `backend/CLAUDE.md`, that directory is autogenerated-only).

Run:
```bash
uv run alembic upgrade head
```
Expected: applies cleanly, no errors.

- [ ] **Step 6: Run the full suite, verify no regressions**

Run: `uv run python -m pytest tests/ -v`
Expected: PASS (full suite)

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/ backend/tests/test_models_backtest_result.py
git commit -m "Add BacktestResult model and migration"
```

---

### Task 4: Backtest job lifecycle

**Files:**
- Create: `backend/app/backtest/jobs.py`
- Test: `backend/tests/test_backtest_jobs.py`

**Interfaces:**
- Consumes: `app.agents.market_data.fetch_price_history` (Task 1); `app.backtest.engine.simulate`, `app.backtest.engine.BacktestMetrics` (Task 2); `app.models.BacktestResult` (Task 3); `app.redis_client.get_redis`; `app.db.SessionLocal`; test fixture `session_local` (already in `backend/tests/conftest.py`, added by the analysis-graph sub-project — no conftest changes needed here)
- Produces: `app.backtest.jobs.create_job(ticker: str, start: date, end: date) -> str` — returns a `job_id`; sets Redis `backtest_job:{job_id}` status to `"RUNNING"`.
- Produces: `app.backtest.jobs.get_job_status(job_id: str) -> dict[str, Any] | None` — `None` if unknown/expired; otherwise `{"status": str, "backtest_result_id": int | None}`.
- Produces: `app.backtest.jobs.run_job(job_id: str, ticker: str, start: date, end: date) -> None` — fetches history, runs `simulate`, writes a `BacktestResult` row, updates job status to `"DONE"` (with `backtest_result_id`) or `"FAILED"` on any exception.

- [ ] **Step 1: Write the failing tests — `backend/tests/test_backtest_jobs.py`**

```python
import asyncio
from datetime import date
from unittest.mock import AsyncMock, patch

from app.backtest.engine import BacktestMetrics
from app.backtest.jobs import create_job, get_job_status, run_job


def test_backtest_job_completes_and_persists_result(session_local):
    fake_metrics = BacktestMetrics(
        final_value=11000.0,
        buy_and_hold_value=10500.0,
        excess_return_pct=0.0476,
        hit_rate_by_signal={"OVERSOLD": {"count": 3.0, "avg_forward_return_pct": 0.02}},
    )

    async def _run() -> None:
        job_id = await create_job("AAPL", date(2020, 1, 1), date(2024, 1, 1))

        status = await get_job_status(job_id)
        assert status == {"status": "RUNNING", "backtest_result_id": None}

        with (
            patch(
                "app.backtest.jobs.fetch_price_history",
                AsyncMock(return_value=[100.0] * 300),
            ),
            patch("app.backtest.jobs.simulate", return_value=fake_metrics),
            patch("app.backtest.jobs.SessionLocal", session_local),
        ):
            await run_job(job_id, "AAPL", date(2020, 1, 1), date(2024, 1, 1))

        final = await get_job_status(job_id)
        assert final is not None
        assert final["status"] == "DONE"
        assert final["backtest_result_id"] is not None

    asyncio.run(_run())


def test_backtest_job_marks_failed_on_error():
    async def _run() -> None:
        job_id = await create_job("NOPE", date(2020, 1, 1), date(2024, 1, 1))

        with patch(
            "app.backtest.jobs.fetch_price_history",
            AsyncMock(side_effect=RuntimeError("boom")),
        ):
            await run_job(job_id, "NOPE", date(2020, 1, 1), date(2024, 1, 1))

        final = await get_job_status(job_id)
        assert final == {"status": "FAILED", "backtest_result_id": None}

    asyncio.run(_run())


def test_get_job_status_returns_none_for_unknown_job():
    result = asyncio.run(get_job_status("does-not-exist"))
    assert result is None
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `uv run python -m pytest tests/test_backtest_jobs.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.backtest.jobs'`

- [ ] **Step 3: Create `backend/app/backtest/jobs.py`**

```python
import logging
import uuid
from datetime import date
from typing import Any

from app.agents.market_data import fetch_price_history
from app.backtest.engine import simulate
from app.config import settings
from app.db import SessionLocal
from app.models import BacktestResult
from app.redis_client import get_redis

logger = logging.getLogger(__name__)

JOB_TTL_SECONDS = 3600


async def create_job(ticker: str, start: date, end: date) -> str:
    job_id = str(uuid.uuid4())
    redis = get_redis()
    await redis.hset(f"backtest_job:{job_id}", mapping={"status": "RUNNING"})
    await redis.expire(f"backtest_job:{job_id}", JOB_TTL_SECONDS)
    return job_id


async def get_job_status(job_id: str) -> dict[str, Any] | None:
    redis = get_redis()
    data = await redis.hgetall(f"backtest_job:{job_id}")
    if not data:
        return None
    result_id = data.get("backtest_result_id")
    return {
        "status": data["status"],
        "backtest_result_id": int(result_id) if result_id is not None else None,
    }


async def run_job(job_id: str, ticker: str, start: date, end: date) -> None:
    redis = get_redis()
    try:
        closes = await fetch_price_history(ticker, start, end)
        metrics = simulate(closes)

        db = SessionLocal()
        try:
            result = BacktestResult(
                user_id=settings.default_user_id,
                ticker=ticker,
                start_date=start,
                end_date=end,
                final_value=metrics.final_value,
                buy_and_hold_value=metrics.buy_and_hold_value,
                excess_return_pct=metrics.excess_return_pct,
                hit_rate_by_signal=metrics.hit_rate_by_signal,
                status="DONE",
            )
            db.add(result)
            db.commit()
            db.refresh(result)
        finally:
            db.close()

        await redis.hset(
            f"backtest_job:{job_id}",
            mapping={"status": "DONE", "backtest_result_id": result.id},
        )
    except Exception:
        logger.exception("Backtest failed for ticker %s", ticker)
        await redis.hset(f"backtest_job:{job_id}", "status", "FAILED")
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `uv run python -m pytest tests/test_backtest_jobs.py -v`
Expected: PASS (3 tests; requires Redis running)

- [ ] **Step 5: Commit**

```bash
git add backend/app/backtest/jobs.py backend/tests/test_backtest_jobs.py
git commit -m "Add backtest job lifecycle"
```

---

### Task 5: `/backtest/*` endpoints

**Files:**
- Create: `backend/app/routers/backtest.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_backtest_router.py`

**Interfaces:**
- Consumes: `app.backtest.jobs.create_job`, `get_job_status`, `run_job` (Task 4); `app.models.BacktestResult` (Task 3)
- Produces: `app.schemas.BacktestResultOut` (Pydantic model)
- Produces: `app.routers.backtest.router` (FastAPI `APIRouter`, prefix `/backtest`)

- [ ] **Step 1: Write the failing tests — `backend/tests/test_backtest_router.py`**

```python
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

from app.config import settings
from app.models import BacktestResult


def _close_coro(coro):
    # Same reasoning as routers/analysis.py's tests: closing the coroutine
    # instead of letting asyncio.create_task actually schedule it avoids a
    # dangling task the test's event loop would otherwise tear down mid-run.
    coro.close()
    return MagicMock()


def test_run_backtest_returns_job_id(client):
    with (
        patch("app.routers.backtest.create_job", AsyncMock(return_value="job-123")),
        patch("app.routers.backtest.run_job", AsyncMock()),
        patch("app.routers.backtest.asyncio.create_task", side_effect=_close_coro),
    ):
        response = client.post(
            "/backtest/run",
            json={"ticker": "AAPL", "start_date": "2020-01-01", "end_date": "2024-01-01"},
        )

    assert response.status_code == 202
    assert response.json() == {"job_id": "job-123"}


def test_get_backtest_run_status_returns_404_for_unknown_job(client):
    with patch("app.routers.backtest.get_job_status", AsyncMock(return_value=None)):
        response = client.get("/backtest/run/unknown-job")
    assert response.status_code == 404


def test_get_backtest_run_status_returns_job_state(client):
    fake_status = {"status": "DONE", "backtest_result_id": 1}
    with patch("app.routers.backtest.get_job_status", AsyncMock(return_value=fake_status)):
        response = client.get("/backtest/run/job-123")
    assert response.status_code == 200
    assert response.json() == fake_status


def test_list_results_filters_by_ticker(client, db_session):
    result = BacktestResult(
        user_id=settings.default_user_id,
        ticker="AAPL",
        start_date=date(2020, 1, 1),
        end_date=date(2024, 1, 1),
        final_value=11000.0,
        buy_and_hold_value=10500.0,
        excess_return_pct=0.0476,
        hit_rate_by_signal={"OVERSOLD": {"count": 3.0, "avg_forward_return_pct": 0.02}},
        status="DONE",
    )
    db_session.add(result)
    db_session.commit()

    response = client.get("/backtest/results?ticker=AAPL")
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["ticker"] == "AAPL"

    response = client.get("/backtest/results?ticker=NOPE")
    assert response.json() == []
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `uv run python -m pytest tests/test_backtest_router.py -v`
Expected: FAIL — 404, no `/backtest` routes mounted yet

- [ ] **Step 3: Add `BacktestResultOut` to `backend/app/schemas.py`**

Append at the end of the file:
```python
class BacktestResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID
    created_at: datetime
    ticker: str
    start_date: date
    end_date: date
    final_value: float
    buy_and_hold_value: float
    excess_return_pct: float
    hit_rate_by_signal: dict[str, dict[str, float]]
    status: str
```
(`date`, `datetime`, `UUID`, `BaseModel`, `ConfigDict` are already imported at the top of this file — no import changes needed.)

- [ ] **Step 4: Create `backend/app/routers/backtest.py`**

```python
import asyncio
import logging
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.backtest.jobs import create_job, get_job_status, run_job
from app.config import settings
from app.db import get_db
from app.models import BacktestResult
from app.schemas import BacktestResultOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/backtest", tags=["backtest"])

_background_tasks: set[asyncio.Task[None]] = set()


def _log_background_task_exception(task: asyncio.Task[None]) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.exception("Background backtest job failed", exc_info=exc)


class BacktestRunIn(BaseModel):
    ticker: str
    start_date: date
    end_date: date


@router.post("/run", status_code=202)
async def run_backtest(payload: BacktestRunIn) -> dict[str, str]:
    job_id = await create_job(payload.ticker, payload.start_date, payload.end_date)
    task = asyncio.create_task(
        run_job(job_id, payload.ticker, payload.start_date, payload.end_date)
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    task.add_done_callback(_log_background_task_exception)
    return {"job_id": job_id}


@router.get("/run/{job_id}")
async def get_run_status(job_id: str) -> dict[str, Any]:
    status = await get_job_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


@router.get("/results", response_model=list[BacktestResultOut])
def list_results(
    ticker: str | None = None, db: Session = Depends(get_db)
) -> list[BacktestResult]:
    query = db.query(BacktestResult).filter_by(user_id=settings.default_user_id)
    if ticker:
        query = query.filter_by(ticker=ticker)
    return query.all()
```

- [ ] **Step 5: Mount the router — modify `backend/app/main.py`**

Change:
```python
from app.routers import analysis, portfolio

app = FastAPI(title="Trading Agent API")
app.include_router(portfolio.router)
app.include_router(analysis.router)
```
to:
```python
from app.routers import analysis, backtest, portfolio

app = FastAPI(title="Trading Agent API")
app.include_router(portfolio.router)
app.include_router(analysis.router)
app.include_router(backtest.router)
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `uv run python -m pytest tests/ -v`
Expected: PASS (full suite, no regressions)

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/backtest.py backend/app/schemas.py backend/app/main.py backend/tests/test_backtest_router.py
git commit -m "Add /backtest/* endpoints"
```

---

### Task 6: Manual verification against a real ticker

**Files:** none (no code changes — confirms the whole pipeline against live data)

- [ ] **Step 1: Confirm Redis is running**

```bash
docker compose ps
```
Expected: `redis` shows up/healthy. If not: `docker compose up -d redis` (from `backend/`).

- [ ] **Step 2: Apply migrations and start the server**

Run (from `backend/`):
```bash
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

- [ ] **Step 3: Run a backtest against a real ticker**

In a second terminal:
```bash
curl -X POST http://localhost:8000/backtest/run -H "Content-Type: application/json" -d '{"ticker":"AAPL","start_date":"2018-01-01","end_date":"2024-01-01"}'
```
Note the returned `job_id`.

- [ ] **Step 4: Poll until done**

```bash
curl http://localhost:8000/backtest/run/<job_id>
```
Expected: `status` eventually reads `"DONE"` with a `backtest_result_id`. If it reads `"FAILED"`, check the server log (uvicorn's stdout) for the real exception — that's where `run_job`'s `logger.exception` call writes it.

- [ ] **Step 5: Inspect the result**

```bash
curl "http://localhost:8000/backtest/results?ticker=AAPL"
```
Expected: one row with plausible values — `final_value` and `buy_and_hold_value` both roughly in the same order of magnitude as the $10,000 starting capital scaled by AAPL's actual price movement over 2018–2024 (a multi-year AAPL window should show substantial growth in `buy_and_hold_value`, not a value close to $10,000 flat — flat would mean the price history came back empty or wrong). `hit_rate_by_signal` should have at least one signal type with a non-zero `count` over a 6-year window.

Report back: the actual `final_value`/`buy_and_hold_value`/`excess_return_pct` numbers, and whether anything looked wrong. No commit for this task.
