# Scheduled Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-shot command, `uv run python -m app.scheduled <daily|snapshots|outcomes>`, that records the daily portfolio snapshot and evaluates due recommendation outcomes for every active user, so neither depends on someone opening a page.

**Architecture:** Two existing router loops become services (`app/snapshots.py::record_snapshot`, `app/memory/outcomes.py::evaluate_due_outcomes`) and the routers call them. A new `app/scheduled.py` takes a per-command Redis lock, lists active users, and runs each user's steps inside that user's own `scoped_session`, isolating failures per user and reporting through the exit code. An external scheduler (cron, Task Scheduler, a Fly scheduled machine) triggers it; nothing new runs continuously.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 (sync sessions inside async functions, the existing pattern), Redis (`redis.asyncio`), pytest against real Postgres and Redis.

**Spec:** `docs/superpowers/specs/2026-09-30-scheduled-jobs-design.md`

## Global Constraints

- The system never places a trade. No broker calls anywhere.
- Backend rules (`backend/CLAUDE.md`): thin routers and fat services; services raise domain exceptions and `app/main.py` maps them to HTTP (the `AdminError` / `UsageLimitExceeded` handlers are the idiom); Pydantic v2; every function typed; no `print` (use `logging`); user data only through RLS-scoped sessions (`scoped_session(user_id)`); never use the owner database role at runtime; never log or persist raw exception text (log `type(exc).__name__`, keep the existing `logger.exception` calls exactly as they are in moved code); commands are prefixed `uv run` and run inside `backend/`.
- Tests: real Postgres and Redis (`docker compose up -d` from `backend/` or the repo root is already running); never call real yfinance or Anthropic; patch by the consuming module's own name (e.g. `app.snapshots.fetch_quote_and_history`); no assertion changes in existing tests, only patch targets move.
- Only cheap jobs are scheduled (yfinance only). Do not schedule or touch `/analysis/run`, `/backtest/run` or `/memory/embed`.
- No new dependency, process, Dockerfile or compose service. No frontend change.
- Checks before a task is done (in `backend/`): `uv run python -m pytest tests/ -q`, `uv run ruff check . && uv run ruff format .`, `uv run mypy app`. Commits: Conventional Commits with trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never skip hooks or signing; never commit `.env`.
- The repo has Claude Code hooks (`.claude/hooks/`): editing an existing file in `backend/migrations/versions/` is blocked (this plan adds no migration) and `ruff check --fix` runs after Python edits; hooks load at session start.

## Review Focus

- A user who already has a snapshot dated today (UTC), for example one the page-open hook made, gets no duplicate; a snapshot from yesterday does not block today's (T3).
- One user's failure (no price, or an exception) never stops the next user, and the run still ends with exit code 1 (T3, T4).
- Invited and disabled users are never processed, and a user with only zero-share holdings is skipped (T3).
- Two overlapping runs of the same command do not double up (second exits 0 without work), the lock is released after a normal run, and a different command is not blocked by it (T4).
- The refactor changes no endpoint behaviour: an empty portfolio still records a zero snapshot, a raising quote still propagates, `None`/`NaN` prices still return 500 with the same message, and `/memory/evaluate-outcomes` returns the same JSON (T1, T2).

---

### Task 1: `record_snapshot` service and thin snapshot route

**Files:**
- Create: `backend/app/snapshots.py`
- Modify: `backend/app/routers/portfolio.py` (the `create_snapshot` route), `backend/app/main.py` (one exception handler)
- Test: `backend/tests/test_snapshots.py` (create); `backend/tests/test_portfolio.py` (patch targets only)

**Interfaces:**
- Produces:
  ```python
  class PriceUnavailable(Exception):   # .ticker: str ; str(exc) == "No current price available for <TICKER>"
  async def record_snapshot(db: Session, user_id: uuid.UUID) -> PortfolioSnapshot
  ```
  Behaviour is exactly what `create_snapshot` does today: prices every holding with `shares != 0` via `fetch_quote_and_history(ticker)`; a `None` or non-finite price raises `PriceUnavailable(ticker)` (nothing written); any other exception from the quote fetch propagates unchanged; an empty portfolio records a zero snapshot; totals are `sum(shares * price)` and `sum(shares * cost_basis)`; commits and refreshes the row.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_snapshots.py`

```python
import asyncio
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app.models import Holding, PortfolioSnapshot
from app.snapshots import PriceUnavailable, record_snapshot
from tests.auth_support import OTHER_USER_ID, USER_ID


def _holding(db, ticker="AAPL", shares=10, cost=150.0, user_id=USER_ID):
    db.add(
        Holding(
            user_id=user_id,
            ticker=ticker,
            name=ticker,
            asset_type="STOCK",
            shares=shares,
            cost_basis=cost,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    db.commit()


def _record(db, quote, user_id=USER_ID):
    with patch("app.snapshots.fetch_quote_and_history", quote):
        return asyncio.run(record_snapshot(db, user_id))


def test_record_snapshot_totals_priced_holdings(db_session):
    _holding(db_session, "AAPL", 10, 150.0)
    _holding(db_session, "MSFT", 2, 300.0)

    async def quote(ticker):
        return {"price": {"AAPL": 200.0, "MSFT": 400.0}[ticker], "closes": []}

    snapshot = _record(db_session, AsyncMock(side_effect=quote))

    assert float(snapshot.total_market_value) == 2800.0  # 10*200 + 2*400
    assert float(snapshot.total_cost_basis) == 2100.0  # 10*150 + 2*300
    assert db_session.query(PortfolioSnapshot).filter_by(user_id=USER_ID).count() == 1


def test_record_snapshot_of_an_empty_portfolio_is_a_zero_snapshot(db_session):
    quote = AsyncMock()
    snapshot = _record(db_session, quote)

    assert float(snapshot.total_market_value) == 0
    assert float(snapshot.total_cost_basis) == 0
    quote.assert_not_awaited()


def test_record_snapshot_skips_zero_share_holdings(db_session):
    _holding(db_session, "AAPL", 10, 150.0)
    _holding(db_session, "OLD", 0, 50.0)
    quote = AsyncMock(return_value={"price": 200.0, "closes": []})

    snapshot = _record(db_session, quote)

    assert float(snapshot.total_market_value) == 2000.0
    quote.assert_awaited_once_with("AAPL")


def test_record_snapshot_only_counts_the_users_own_holdings(db_session):
    _holding(db_session, "AAPL", 10, 150.0)
    _holding(db_session, "MSFT", 99, 1.0, user_id=OTHER_USER_ID)

    snapshot = _record(db_session, AsyncMock(return_value={"price": 200.0, "closes": []}))

    assert float(snapshot.total_market_value) == 2000.0


@pytest.mark.parametrize("bad_price", [None, float("nan"), float("inf")])
def test_record_snapshot_raises_price_unavailable_and_writes_nothing(db_session, bad_price):
    _holding(db_session, "DELISTED")

    with pytest.raises(PriceUnavailable) as caught:
        _record(db_session, AsyncMock(return_value={"price": bad_price, "closes": []}))

    assert caught.value.ticker == "DELISTED"
    assert str(caught.value) == "No current price available for DELISTED"
    assert db_session.query(PortfolioSnapshot).count() == 0


def test_record_snapshot_lets_a_quote_error_propagate(db_session):
    _holding(db_session, "AAPL")

    with pytest.raises(RuntimeError, match="yfinance unavailable"):
        _record(db_session, AsyncMock(side_effect=RuntimeError("yfinance unavailable")))

    assert db_session.query(PortfolioSnapshot).count() == 0
```

- [ ] **Step 2: Run to verify failure** — `uv run python -m pytest tests/test_snapshots.py -q`. Expected: FAIL (`ModuleNotFoundError: app.snapshots`).

- [ ] **Step 3: Implement.**

`backend/app/snapshots.py`:
```python
"""Portfolio snapshots: what the portfolio is worth right now, recorded as one row.

Used by POST /portfolio/snapshot and by the scheduled job (app/scheduled.py).
"""

import math
import uuid

from sqlalchemy.orm import Session

from app.agents.market_data import fetch_quote_and_history
from app.models import Holding, PortfolioSnapshot


class PriceUnavailable(Exception):
    """A holding has no usable current price, so no honest total can be recorded."""

    def __init__(self, ticker: str) -> None:
        super().__init__(f"No current price available for {ticker}")
        self.ticker = ticker


async def record_snapshot(db: Session, user_id: uuid.UUID) -> PortfolioSnapshot:
    holdings = db.query(Holding).filter_by(user_id=user_id).all()

    total_market_value = 0.0
    total_cost_basis = 0.0
    for holding in holdings:
        if float(holding.shares) == 0:
            continue  # fully sold: not priced, matching /portfolio/summary
        quote = await fetch_quote_and_history(holding.ticker)
        price = quote["price"]
        # A partial total would be misleading, so any missing price aborts the whole snapshot.
        if price is None or not math.isfinite(price):
            raise PriceUnavailable(holding.ticker)
        total_market_value += float(holding.shares) * price
        total_cost_basis += float(holding.shares) * float(holding.cost_basis)

    snapshot = PortfolioSnapshot(
        user_id=user_id,
        total_market_value=total_market_value,
        total_cost_basis=total_cost_basis,
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot
```

`backend/app/routers/portfolio.py`: replace the whole body of `create_snapshot` with
```python
    return await record_snapshot(db, user.id)
```
(keep the decorator and signature), add `from app.snapshots import record_snapshot`, and drop any import that became unused (`math`, `fetch_quote_and_history`, `Holding`, `PortfolioSnapshot` are still used by `_prices_for`, `get_summary` and `list_snapshots`, so check with ruff instead of guessing). The `HTTPException` import stays if still used elsewhere in the file.

`backend/app/main.py`: import `PriceUnavailable` from `app.snapshots` and add, next to the other handlers:
```python
@app.exception_handler(PriceUnavailable)
def price_unavailable_handler(request: Request, exc: PriceUnavailable) -> JSONResponse:
    """Services raise domain errors; this is the one place they become HTTP responses."""
    return JSONResponse(status_code=500, content={"detail": str(exc)})
```

`backend/tests/test_portfolio.py`: in the five snapshot tests that patch `"app.routers.portfolio.fetch_quote_and_history"` (`test_snapshot_computes_totals_from_holdings`, `..._skips_zero_share_holdings`, `..._fails_when_price_fetch_raises`, `..._fails_when_price_is_none`, `..._fails_when_price_is_nan`) change the patch target string to `"app.snapshots.fetch_quote_and_history"`. Leave every assertion and every `/portfolio/summary` test (which still patches the router's own name) untouched.

- [ ] **Step 4: Run backend checks** — `uv run python -m pytest tests/ -q && uv run ruff check . && uv run ruff format . && uv run mypy app`. Expected: all pass, including the unchanged `/portfolio/snapshot` endpoint tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/snapshots.py backend/app/routers/portfolio.py backend/app/main.py backend/tests/test_snapshots.py backend/tests/test_portfolio.py
git commit -m "refactor: move snapshot pricing into a service"
```

---

### Task 2: `evaluate_due_outcomes` service and thin route

**Files:**
- Modify: `backend/app/memory/outcomes.py`, `backend/app/routers/memory.py` (the `evaluate_outcomes` route)
- Test: `backend/tests/test_memory_outcomes.py` (append), `backend/tests/test_memory_router.py` (patch targets only)

**Interfaces:**
- Produces:
  ```python
  OUTCOME_LOOKBACK_DAYS = 20
  OUTCOME_BATCH_SIZE = 50
  async def evaluate_due_outcomes(db: Session, user_id: uuid.UUID) -> tuple[int, int]   # (evaluated, remaining)
  ```
  Behaviour is exactly what `evaluate_outcomes` does today, moved verbatim (same `due_filter`, batch of 50 ordered by id, per-row try/except with `logger.exception` and rollback, a failed row is stamped `outcome_evaluated_at` so it stops blocking, and the final `remaining` count over `due_filter`). `compute_outcome` stays in this module and the function calls it by its module-level name, so tests patch `app.memory.outcomes.compute_outcome`.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_memory_outcomes.py`; add the imports it lacks)

```python
import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from app.memory.outcomes import OUTCOME_BATCH_SIZE, evaluate_due_outcomes
from app.models import Recommendation
from tests.auth_support import OTHER_USER_ID, USER_ID


def _rec(db, *, days_old, user_id=USER_ID, price=100.0, ticker="AAPL"):
    rec = Recommendation(
        user_id=user_id,
        ticker=ticker,
        asset_type="STOCK",
        action="BUY",
        reasoning=["x"],
        price_at_recommendation=price,
        created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=days_old),
    )
    db.add(rec)
    db.commit()
    return rec


def _evaluate(db, compute, user_id=USER_ID):
    with patch("app.memory.outcomes.compute_outcome", compute):
        return asyncio.run(evaluate_due_outcomes(db, user_id))


def test_evaluate_due_outcomes_evaluates_only_due_rows_of_the_user(db_session):
    due = _rec(db_session, days_old=21)
    not_due = _rec(db_session, days_old=5)
    other_users = _rec(db_session, days_old=30, user_id=OTHER_USER_ID)

    evaluated, remaining = _evaluate(db_session, AsyncMock(return_value=0.05))

    assert (evaluated, remaining) == (1, 0)
    db_session.refresh(due)
    db_session.refresh(not_due)
    db_session.refresh(other_users)
    assert float(due.outcome_forward_return_pct) == 0.05
    assert due.outcome_evaluated_at is not None
    assert not_due.outcome_evaluated_at is None
    assert other_users.outcome_evaluated_at is None


def test_evaluate_due_outcomes_reports_what_is_left_after_one_batch(db_session):
    for _ in range(OUTCOME_BATCH_SIZE + 1):
        _rec(db_session, days_old=25)

    first = _evaluate(db_session, AsyncMock(return_value=0.01))
    second = _evaluate(db_session, AsyncMock(return_value=0.01))

    assert first == (OUTCOME_BATCH_SIZE, 1)
    assert second == (1, 0)


def test_evaluate_due_outcomes_stamps_a_permanent_failure_so_it_stops_blocking(db_session):
    bad = _rec(db_session, days_old=25, ticker="NOPE")

    first = _evaluate(db_session, AsyncMock(side_effect=ValueError("no history")))
    second = _evaluate(db_session, AsyncMock(return_value=0.02))

    assert first == (0, 0)
    assert second == (0, 0)
    db_session.refresh(bad)
    assert bad.outcome_forward_return_pct is None
    assert bad.outcome_evaluated_at is not None
```

- [ ] **Step 2: Run to verify failure** — `uv run python -m pytest tests/test_memory_outcomes.py -q`. Expected: FAIL (`ImportError: cannot import name 'evaluate_due_outcomes'`).

- [ ] **Step 3: Implement.** In `backend/app/memory/outcomes.py` add (keeping `compute_outcome` and its imports):
```python
import logging
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy.orm import Session

from app.models import Recommendation

logger = logging.getLogger(__name__)

OUTCOME_LOOKBACK_DAYS = 20
OUTCOME_BATCH_SIZE = 50


async def evaluate_due_outcomes(db: Session, user_id: uuid.UUID) -> tuple[int, int]:
    """Evaluates one batch of the user's due recommendations; returns (evaluated, remaining)."""
    # <move the body of routers/memory.py::evaluate_outcomes here verbatim: the cutoff comment and
    # computation, due_filter, the batch query using OUTCOME_BATCH_SIZE, the try/except loop and the
    # final remaining count. Replace `user.id` by `user_id`, `BATCH_SIZE` by `OUTCOME_BATCH_SIZE`,
    # and `return {"evaluated": ..., "remaining": ...}` by `return evaluated, remaining`.>
```
(The bracketed comment is an instruction, not code: copy the real body; keep its comments, including the note about `created_at` being naive UTC.)

`backend/app/routers/memory.py`: the route becomes
```python
async def evaluate_outcomes(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> dict[str, int]:
    evaluated, remaining = await evaluate_due_outcomes(db, user.id)
    return {"evaluated": evaluated, "remaining": remaining}
```
(keep the decorator with the rate limiter). Import `evaluate_due_outcomes` from `app.memory.outcomes`; keep `BATCH_SIZE` in the router (the embed route still uses it); remove `OUTCOME_LOOKBACK_DAYS`, the `compute_outcome` import and any other import ruff reports unused (`datetime`, `timedelta`, `UTC`, `Recommendation` may still be used by `/embed`; let ruff decide).

`backend/tests/test_memory_router.py`: every patch of `"app.routers.memory.compute_outcome"` (the single-line ones and the multi-line one inside the `with patch(` blocks) becomes `"app.memory.outcomes.compute_outcome"`. Change nothing else there. If any test imports `OUTCOME_LOOKBACK_DAYS` from the router, import it from `app.memory.outcomes` instead.

- [ ] **Step 4: Run backend checks** — `uv run python -m pytest tests/ -q && uv run ruff check . && uv run ruff format . && uv run mypy app`. Expected: all pass, including the unchanged `/memory/evaluate-outcomes` endpoint tests and the rate-limit tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/memory/outcomes.py backend/app/routers/memory.py backend/tests/test_memory_outcomes.py backend/tests/test_memory_router.py
git commit -m "refactor: move outcome evaluation into a service"
```

---

### Task 3: Scheduled job steps (users, snapshots, outcomes)

**Files:**
- Create: `backend/app/scheduled.py`
- Modify: `backend/tests/conftest.py` (flush `scheduled:*` keys), 
- Test: `backend/tests/test_scheduled.py` (create)

**Interfaces:**
- Consumes: `record_snapshot`, `PriceUnavailable` (Task 1); `evaluate_due_outcomes` (Task 2); `scoped_session` and the `app.db` module; `AppUser`, `Holding`, `PortfolioSnapshot`.
- Produces:
  ```python
  MAX_OUTCOME_BATCHES = 20
  @dataclass class Summary: users: int = 0; snapshots_recorded: int = 0; snapshots_skipped: int = 0; outcomes_evaluated: int = 0; failures: int = 0   # plus .line() -> str
  def active_user_ids() -> list[uuid.UUID]
  async def run_snapshots(summary: Summary) -> None
  async def run_outcomes(summary: Summary) -> None
  ```
  `active_user_ids` reads `app_users` with status `"active"` through `app.db.SessionLocal` (referenced as `app_db.SessionLocal` via `from app import db as app_db`, so tests patching `app.db.SessionLocal` reach it), ordered by `created_at` then `email`. `run_snapshots` sets `summary.users = len(ids)` if it is 0, then per user: skip when the user has no holding with `shares > 0` (`snapshots_skipped += 1`); skip when a `PortfolioSnapshot` for the user has `created_at >=` today's UTC midnight (naive datetime); otherwise `await record_snapshot(db, user_id)` (`snapshots_recorded += 1`). Any exception for a user is caught, logged as `"Snapshot failed for user %s: %s"` with the user id and `type(exc).__name__`, and counted in `failures`. `run_outcomes` per user loops up to `MAX_OUTCOME_BATCHES` times calling `evaluate_due_outcomes(db, user_id)`, adding `evaluated` to `outcomes_evaluated`, stopping when `remaining == 0`; exceptions are caught, logged (`"Outcome evaluation failed for user %s: %s"`) and counted in `failures`. Both steps use one `scoped_session(user_id)` per user. `Summary.line()` returns `"users=<n> snapshots_recorded=<n> snapshots_skipped=<n> outcomes_evaluated=<n> failures=<n>"`.

- [ ] **Step 1: conftest** — in `_flush_rate_limit_keys` add one more loop so a leftover lock never leaks between tests:
```python
        async for key in redis.scan_iter("scheduled:*"):
            await redis.delete(key)
```

- [ ] **Step 2: Write the failing tests** — `backend/tests/test_scheduled.py` (Task 4 appends to this file)

```python
import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from app import scheduled
from app.models import Holding, PortfolioSnapshot, Recommendation
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user

THIRD_USER_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
FOURTH_USER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")


def _utc_now():
    return datetime.now(UTC).replace(tzinfo=None)


def _holding(db, user_id, ticker="AAPL", shares=10):
    db.add(
        Holding(
            user_id=user_id,
            ticker=ticker,
            name=ticker,
            asset_type="STOCK",
            shares=shares,
            cost_basis=100.0,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    db.commit()


def _due_rec(db, user_id, days_old=25):
    db.add(
        Recommendation(
            user_id=user_id,
            ticker="AAPL",
            asset_type="STOCK",
            action="BUY",
            reasoning=["x"],
            price_at_recommendation=100.0,
            created_at=_utc_now() - timedelta(days=days_old),
        )
    )
    db.commit()


def _snapshots(db, user_id):
    return db.query(PortfolioSnapshot).filter_by(user_id=user_id).all()


@pytest.fixture()
def env(session_local, app_session_local):
    """Owner session for setup; the job itself runs through the restricted runtime role."""
    with patch("app.db.SessionLocal", app_session_local), session_local() as owner:
        yield owner


PRICE_OK = AsyncMock(return_value={"price": 200.0, "closes": []})


def _run_snapshots(quote=PRICE_OK):
    summary = scheduled.Summary()
    with patch("app.snapshots.fetch_quote_and_history", quote):
        asyncio.run(scheduled.run_snapshots(summary))
    return summary


def _run_outcomes(compute=None):
    summary = scheduled.Summary()
    with patch("app.memory.outcomes.compute_outcome", compute or AsyncMock(return_value=0.05)):
        asyncio.run(scheduled.run_outcomes(summary))
    return summary


def test_active_user_ids_excludes_invited_and_disabled(env):
    add_app_user(env, USER_ID, status="active")
    add_app_user(env, OTHER_USER_ID, status="invited")
    add_app_user(env, THIRD_USER_ID, status="disabled")

    assert scheduled.active_user_ids() == [USER_ID]


def test_snapshots_are_recorded_only_for_active_users_with_open_holdings(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID, status="invited")
    add_app_user(env, THIRD_USER_ID, status="disabled")
    add_app_user(env, FOURTH_USER_ID)  # active, but only a fully sold holding
    for uid in (USER_ID, OTHER_USER_ID, THIRD_USER_ID):
        _holding(env, uid)
    _holding(env, FOURTH_USER_ID, "OLD", shares=0)

    summary = _run_snapshots()

    assert len(_snapshots(env, USER_ID)) == 1
    assert float(_snapshots(env, USER_ID)[0].total_market_value) == 2000.0
    assert _snapshots(env, OTHER_USER_ID) == []
    assert _snapshots(env, THIRD_USER_ID) == []
    assert _snapshots(env, FOURTH_USER_ID) == []
    assert summary.snapshots_recorded == 1
    assert summary.snapshots_skipped == 1  # the active user with nothing open
    assert summary.failures == 0


def test_a_snapshot_from_today_is_not_duplicated_but_yesterdays_does_not_block(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    _holding(env, USER_ID)
    _holding(env, OTHER_USER_ID)
    env.add(PortfolioSnapshot(user_id=USER_ID, total_market_value=1, total_cost_basis=1,
                              created_at=_utc_now()))
    env.add(PortfolioSnapshot(user_id=OTHER_USER_ID, total_market_value=1, total_cost_basis=1,
                              created_at=_utc_now() - timedelta(days=1)))
    env.commit()

    summary = _run_snapshots()

    assert len(_snapshots(env, USER_ID)) == 1  # already recorded today
    assert len(_snapshots(env, OTHER_USER_ID)) == 2  # yesterday's does not count
    assert summary.snapshots_recorded == 1
    assert summary.snapshots_skipped == 1


def test_one_users_missing_price_does_not_stop_the_next_user(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    _holding(env, USER_ID, "DELISTED")
    _holding(env, OTHER_USER_ID, "AAPL")

    async def quote(ticker):
        return {"price": None if ticker == "DELISTED" else 200.0, "closes": []}

    summary = _run_snapshots(AsyncMock(side_effect=quote))

    assert _snapshots(env, USER_ID) == []  # never a partial total
    assert len(_snapshots(env, OTHER_USER_ID)) == 1
    assert summary.failures == 1
    assert summary.snapshots_recorded == 1


def test_a_quote_exception_is_counted_not_raised(env):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID)

    summary = _run_snapshots(AsyncMock(side_effect=RuntimeError("yfinance down")))

    assert summary.failures == 1
    assert _snapshots(env, USER_ID) == []


def test_outcomes_are_evaluated_only_for_active_users(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    add_app_user(env, THIRD_USER_ID, status="invited")
    for uid in (USER_ID, OTHER_USER_ID, THIRD_USER_ID):
        _due_rec(env, uid)

    summary = _run_outcomes()

    evaluated = {
        r.user_id: r.outcome_evaluated_at is not None for r in env.query(Recommendation).all()
    }
    assert evaluated == {USER_ID: True, OTHER_USER_ID: True, THIRD_USER_ID: False}
    assert summary.outcomes_evaluated == 2
    assert summary.failures == 0


def test_outcomes_drain_a_backlog_over_several_batches(env):
    add_app_user(env, USER_ID)
    for _ in range(51):
        _due_rec(env, USER_ID)

    summary = _run_outcomes()

    assert summary.outcomes_evaluated == 51
    assert env.query(Recommendation).filter(Recommendation.outcome_evaluated_at.is_(None)).count() == 0


def test_outcomes_drain_stops_at_the_batch_cap(env):
    add_app_user(env, USER_ID)
    for _ in range(51):
        _due_rec(env, USER_ID)

    with patch.object(scheduled, "MAX_OUTCOME_BATCHES", 1):
        summary = _run_outcomes()

    assert summary.outcomes_evaluated == 50
    assert env.query(Recommendation).filter(Recommendation.outcome_evaluated_at.is_(None)).count() == 1


def test_an_outcome_failure_for_one_user_does_not_stop_the_next(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    _due_rec(env, USER_ID)
    _due_rec(env, OTHER_USER_ID)
    evaluate = AsyncMock(side_effect=[RuntimeError("boom"), (1, 0)])

    summary = scheduled.Summary()
    with patch("app.scheduled.evaluate_due_outcomes", evaluate):
        asyncio.run(scheduled.run_outcomes(summary))

    assert summary.failures == 1
    assert summary.outcomes_evaluated == 1


def test_summary_line_lists_every_counter():
    line = scheduled.Summary(users=3, snapshots_recorded=2, snapshots_skipped=1,
                             outcomes_evaluated=4, failures=0).line()
    assert line == (
        "users=3 snapshots_recorded=2 snapshots_skipped=1 outcomes_evaluated=4 failures=0"
    )
```
(The `Summary(...)` keyword construction and the `line()` format above pin the interface. `active_user_ids` order for two users with equal `created_at` falls back to email, so the ordered-list assertion only uses a single user.)

- [ ] **Step 3: Run to verify failure** — `uv run python -m pytest tests/test_scheduled.py -q`. Expected: FAIL (`ImportError: cannot import name 'scheduled'`).

- [ ] **Step 4: Implement** `backend/app/scheduled.py` per Interfaces (this task: `MAX_OUTCOME_BATCHES`, `Summary`, `active_user_ids`, `run_snapshots`, `run_outcomes`, a module `logger`; the command dispatch, lock and `main` arrive in Task 4). Notes:
  - `from app import db as app_db` and use `app_db.SessionLocal()` in `active_user_ids` (a plain `from app.db import SessionLocal` would not see the tests' patch); use `app.db.scoped_session` for the per-user sessions (it already reads `SessionLocal` through its own module).
  - Import `evaluate_due_outcomes` and `record_snapshot` at module level by name so tests can patch `app.scheduled.evaluate_due_outcomes`.
  - Today's UTC midnight: `datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)`.
  - `Summary.users` is set once per run to the number of active users (`len(active_user_ids())`), never accumulated across steps.
  - Log with `logger` (no `print`); never log exception messages, only the class name.

- [ ] **Step 5: Run backend checks** — `uv run python -m pytest tests/ -q && uv run ruff check . && uv run ruff format . && uv run mypy app`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/scheduled.py backend/tests/test_scheduled.py backend/tests/conftest.py
git commit -m "feat: scheduled steps for daily snapshots and outcome evaluation"
```

---

### Task 4: Lock, commands, exit codes, CLI

**Files:**
- Modify: `backend/app/scheduled.py`
- Test: `backend/tests/test_scheduled.py` (append)

**Interfaces:**
- Consumes: `run_snapshots`, `run_outcomes`, `Summary` (Task 3); `get_redis` from `app.redis_client`.
- Produces:
  ```python
  COMMANDS = ("daily", "snapshots", "outcomes")
  LOCK_SECONDS = 3600
  async def run_command(command: str) -> int      # 0 ok / already running, 1 any failure or Redis unreachable
  def main(argv: list[str] | None = None) -> int  # argparse; unknown command exits 2; logging.basicConfig(INFO)
  ```
  `run_command`: key `scheduled:<command>`; `await redis.set(key, "1", nx=True, ex=LOCK_SECONDS)`; if `set` raises, log `"Scheduled %s: cannot reach Redis (%s)"` with `type(exc).__name__` and return 1 without doing any work; if it returns falsy (lock held) log `"Scheduled %s: already running, nothing to do"` and return 0; otherwise run the steps (`daily`: snapshots then outcomes, both into one `Summary`; `snapshots` or `outcomes` alone), log `"Scheduled %s done: %s"` with `summary.line()`, release the lock in a `finally` (`await redis.delete(key)`, swallowing and logging release errors by class name), and return `1 if summary.failures else 0`. Add `if __name__ == "__main__": raise SystemExit(main())`. `main` parses one positional `command` with `choices=COMMANDS` (argparse's own exit code 2 for an unknown command), calls `asyncio.run(run_command(args.command))` and returns its result.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_scheduled.py`; add `from app.redis_client import get_redis` and `from app.db` needs none)

```python
def _run_command(command, quote=PRICE_OK, compute=None):
    with (
        patch("app.snapshots.fetch_quote_and_history", quote),
        patch("app.memory.outcomes.compute_outcome", compute or AsyncMock(return_value=0.05)),
    ):
        return asyncio.run(scheduled.run_command(command))


async def _lock_exists(key):
    return bool(await get_redis().exists(key))


def test_daily_runs_both_steps_exits_0_and_releases_the_lock(env):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID)
    _due_rec(env, USER_ID)

    code = _run_command("daily")

    assert code == 0
    assert len(_snapshots(env, USER_ID)) == 1
    assert env.query(Recommendation).one().outcome_evaluated_at is not None
    assert asyncio.run(_lock_exists("scheduled:daily")) is False


def test_snapshots_and_outcomes_commands_each_run_only_their_own_step(env):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID)
    _due_rec(env, USER_ID)

    assert _run_command("snapshots") == 0
    assert len(_snapshots(env, USER_ID)) == 1
    assert env.query(Recommendation).one().outcome_evaluated_at is None

    assert _run_command("outcomes") == 0
    assert env.query(Recommendation).one().outcome_evaluated_at is not None


def test_the_exit_code_is_1_when_any_user_failed_but_the_others_still_ran(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    _holding(env, USER_ID, "DELISTED")
    _holding(env, OTHER_USER_ID, "AAPL")

    async def quote(ticker):
        return {"price": None if ticker == "DELISTED" else 200.0, "closes": []}

    code = _run_command("daily", quote=AsyncMock(side_effect=quote))

    assert code == 1
    assert len(_snapshots(env, OTHER_USER_ID)) == 1


def test_nothing_to_do_is_exit_0(env):
    assert _run_command("daily") == 0  # no users at all


def test_a_held_lock_makes_the_run_exit_0_without_work_and_keeps_the_lock(env):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID)

    async def go():
        redis = get_redis()
        await redis.set("scheduled:daily", "1", nx=True, ex=60)
        with patch("app.snapshots.fetch_quote_and_history", PRICE_OK):
            code = await scheduled.run_command("daily")
        still_held = await redis.exists("scheduled:daily")
        await redis.delete("scheduled:daily")
        return code, still_held

    code, still_held = asyncio.run(go())

    assert code == 0
    assert still_held == 1  # the other run's lock is not ours to release
    assert _snapshots(env, USER_ID) == []


def test_a_different_command_is_not_blocked_by_the_daily_lock(env):
    add_app_user(env, USER_ID)
    _due_rec(env, USER_ID)

    async def go():
        redis = get_redis()
        await redis.set("scheduled:daily", "1", nx=True, ex=60)
        with patch("app.memory.outcomes.compute_outcome", AsyncMock(return_value=0.05)):
            code = await scheduled.run_command("outcomes")
        await redis.delete("scheduled:daily")
        return code

    assert asyncio.run(go()) == 0
    assert env.query(Recommendation).one().outcome_evaluated_at is not None


def test_an_unreachable_redis_exits_1_and_does_no_work(env):
    add_app_user(env, USER_ID)
    _holding(env, USER_ID)

    class BrokenRedis:
        async def set(self, *args, **kwargs):
            raise ConnectionError("redis down")

    with patch("app.scheduled.get_redis", return_value=BrokenRedis()):
        code = _run_command("daily")

    assert code == 1
    assert _snapshots(env, USER_ID) == []


def test_main_dispatches_the_command_and_returns_its_exit_code():
    with patch("app.scheduled.run_command", AsyncMock(return_value=0)) as run:
        assert scheduled.main(["snapshots"]) == 0
    run.assert_awaited_once_with("snapshots")

    with patch("app.scheduled.run_command", AsyncMock(return_value=1)):
        assert scheduled.main(["daily"]) == 1


def test_main_rejects_an_unknown_command_with_exit_2():
    with pytest.raises(SystemExit) as caught:
        scheduled.main(["nope"])
    assert caught.value.code == 2
```
Note on the release-only-our-own-lock assertion: `set(..., nx=True)` returned falsy in the held case so `run_command` must NOT reach the `finally` release; structure the code so the release runs only after a successful acquire.

- [ ] **Step 2: Run to verify failure** — `uv run python -m pytest tests/test_scheduled.py -q`. Expected: FAIL (`AttributeError: module 'app.scheduled' has no attribute 'run_command'`).

- [ ] **Step 3: Implement** per Interfaces. The lock is acquired inside a `try` that only covers `redis.set`; the release lives in a `try/finally` opened after a successful acquire.

- [ ] **Step 4: Run backend checks** — `uv run python -m pytest tests/ -q && uv run ruff check . && uv run ruff format . && uv run mypy app`. Then a manual smoke test against the local dev database (Docker up): `uv run python -m app.scheduled outcomes` and `uv run python -m app.scheduled nope; echo $?` (expect a log summary with exit 0, and argparse's usage error with 2). Do not run `daily` against real data unless `ANTHROPIC`-free yfinance access is fine for you; it only records snapshots and outcomes. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/scheduled.py backend/tests/test_scheduled.py
git commit -m "feat: scheduled command with a per-command lock and exit codes"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `backend/CLAUDE.md`

- [ ] **Step 1: `docs/ARCHITECTURE.md`**
  - Add a short "Scheduled jobs" section right after "12. Local development" (renumber nothing; make it a `###`-style subsection or an unnumbered heading inside §12): what runs (`daily` = snapshots then outcomes for every active user; `snapshots`, `outcomes` alone), idempotency (a user with a snapshot dated today is skipped, so the page-open hook and the job coexist), per-command Redis lock (one hour, second run exits 0), the exit code contract (0 success or nothing to do, 1 any user failed or Redis unreachable, 2 unknown command), the recommended cadence (weekdays around 23:00 UTC, after the EU and US closes), and the runtime role (same `DATABASE_URL` as the API, RLS via `scoped_session`).
  - Triggers, copy-paste: cron `0 23 * * 1-5 cd /path/to/backend && uv run python -m app.scheduled daily`; Windows Task Scheduler (action `uv`, arguments `run python -m app.scheduled daily`, start in the `backend` folder, weekdays 23:00 UTC converted to local time); Fly.io (§13): a scheduled machine on the same image, `fly machine run <image> --schedule daily -- python -m app.scheduled daily` (Fly's built-in schedules are hourly, daily, weekly or monthly; because the job is idempotent a daily run at whatever hour the machine was created is fine).
  - §13 Deployment table, Backend row: one sentence that a scheduled machine (or any cron) runs `python -m app.scheduled daily`.
  - Operational checklist: replace the "Scheduling for `/analysis/run`" bullet with two bullets: `[x]` snapshots and outcomes run as a scheduled one-shot command (`app/scheduled.py`); `[ ]` `/analysis/run`, `/backtest/run` and `/memory/embed` stay manual by design (analysis costs Anthropic money: needs the cost/budget alert above first). Keep the cost-alert bullet as is.
  - §5 API table: the `/portfolio/snapshot` and `/memory/evaluate-outcomes` rows gain "also run daily by the scheduled job".
- [ ] **Step 2: `backend/CLAUDE.md`** — add a row to the commands table: `| Scheduled jobs | uv run python -m app.scheduled daily (or snapshots / outcomes) |`.
- [ ] **Step 3: Verify** the two files render sensibly (`git diff`), then commit:

```bash
git add docs/ARCHITECTURE.md backend/CLAUDE.md
git commit -m "docs: scheduled jobs, triggers and the updated operational checklist"
```

---

## Self-review notes

- **Spec coverage:** lock per command, active-user filter, per-user `scoped_session`, snapshot skip rules (no open holding, snapshot today, unpriceable holding), outcomes drain with the 20-batch cap, summary line and exit codes, unknown command exit 2, Redis-down exit 1 (T3, T4); the two refactors and router patch-target moves (T1, T2); docs and the operational checklist (T5). Non-goals respected: no process, Dockerfile, compose service, frontend change, or scheduling of `/analysis/run`.
- **Type consistency:** `Summary`, `MAX_OUTCOME_BATCHES`, `active_user_ids`, `run_snapshots`, `run_outcomes` defined in T3 and used unchanged in T4; `record_snapshot`/`PriceUnavailable` (T1) and `evaluate_due_outcomes` (T2) consumed by name in T3 and patched as `app.scheduled.evaluate_due_outcomes`.
- **Judgement calls for reviewers:** `PriceUnavailable` is mapped in `main.py` (the repo idiom) instead of the router; the existing router tests keep their assertions and only their patch targets move; the job never runs `daily` against real yfinance in tests; the empty-portfolio snapshot endpoint behaviour (a zero snapshot) is preserved, while the job itself skips users with no open holdings.
