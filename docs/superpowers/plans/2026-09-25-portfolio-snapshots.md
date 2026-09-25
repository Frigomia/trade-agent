# Portfolio Value Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `POST /portfolio/snapshot` and `GET /portfolio/snapshots` —
capturing a portfolio's total market value and cost basis at a point in
time, closing the §16 checklist's "no 'how am I doing over time' chart is
possible" gap at the data-capture level.

**Architecture:** One new model, `PortfolioSnapshot`, and two new routes
added to the existing `routers/portfolio.py`. The capture route reuses
`market_data.fetch_quote_and_history` (already Redis-cached and, as of a
sibling branch, retry-wrapped) for live prices — no new fetching logic.

**Tech Stack:** FastAPI, SQLAlchemy 2 (sync ORM), Alembic, Pydantic v2,
pytest.

**Spec:** `docs/superpowers/specs/2026-09-25-portfolio-snapshots-design.md`

## Global Constraints

- No scheduler/cron. Manual, re-callable endpoint, matching
  `/analysis/run`, `/backtest/run`, `/memory/embed`,
  `/memory/evaluate-outcomes`.
- A snapshot is portfolio-level only — no per-holding breakdown table.
- `GET /portfolio/snapshots` has no date-range filter — nothing consumes
  it yet.
- A price-fetch failure for any holding fails the whole
  `POST /portfolio/snapshot` request (propagates as an error) rather than
  silently omitting that holding from the total.
- `Holding.shares`/`cost_basis` are `Numeric` columns — SQLAlchemy/psycopg
  returns these as `Decimal`, not `float`. Cast with `float(...)` before
  arithmetic, matching the existing `float(holding.shares)` casts already
  in `log_trade` (`routers/portfolio.py`).
- Mock `market_data.fetch_quote_and_history` in every test — never a real
  yfinance call in the automated suite.

## Review Focus

- An empty portfolio (no `Holding` rows at all) — `POST /portfolio/snapshot`
  must return a snapshot with both totals `0`, not divide-by-zero or skip
  creating a row.
- A holding whose live-price fetch fails (e.g. `fetch_quote_and_history`
  raises after retries exhaust, per the Global Constraint above) — the
  endpoint must surface an error, not a 200 with a wrong/partial total.
- `fetch_quote_and_history`'s return shape is `{"price": float | None,
  "closes": list[float]}` — if `price` is `None` (a ticker yfinance
  returned no closes for), the endpoint must not silently treat that as
  `0` in the total (that would understate the portfolio) or crash with a
  `TypeError` multiplying `None`; it should be treated the same as a fetch
  failure.
- Multiple holdings with a mix of `Numeric` `Decimal` values — confirm the
  `float(...)` casts are applied consistently so the sum doesn't raise a
  `TypeError` mixing `Decimal` and `float`.
- `GET /portfolio/snapshots` ordering — snapshots created out of insertion
  order (via manipulated `created_at`, or just multiple snapshots created
  in the same test) must still come back oldest-first, not database
  insertion order or unspecified order.

---

## Task 1: `PortfolioSnapshot` model + migration

**Files:**
- Modify: `backend/app/models.py` (append after `InvestmentPreferences`,
  end of file)
- Modify: `backend/tests/test_models.py` (append)

**Interfaces:**
- Produces: `PortfolioSnapshot` (SQLAlchemy model) — `id: int`,
  `user_id: uuid.UUID`, `created_at: datetime`,
  `total_market_value: float`, `total_cost_basis: float`. Used by Task 2's
  router.

- [ ] **Step 1: Read the existing test file's current import line**

`backend/tests/test_models.py`'s import line currently ends with
`InvestmentPreferences` (added by a prior branch). Read the file first to
copy its exact current text before editing — the exact content may have
shifted since this plan was written.

- [ ] **Step 2: Write the failing test**

Add `PortfolioSnapshot` to the `from app.models import (...)` line
(keep alphabetical order), then append this test to the end of the file:

```python
def test_portfolio_snapshot_roundtrip(db_session):
    snapshot = PortfolioSnapshot(
        user_id=uuid.uuid4(),
        total_market_value=15000.50,
        total_cost_basis=12000.00,
    )
    db_session.add(snapshot)
    db_session.commit()
    db_session.refresh(snapshot)

    assert snapshot.id is not None
    assert snapshot.created_at is not None
    assert float(snapshot.total_market_value) == 15000.50
    assert float(snapshot.total_cost_basis) == 12000.00
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && uv run python -m pytest tests/test_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'PortfolioSnapshot'`

- [ ] **Step 4: Write minimal implementation**

Append to `backend/app/models.py` (after `InvestmentPreferences`, end of
file):

```python
class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    total_market_value: Mapped[float] = mapped_column(Numeric(18, 2))
    total_cost_basis: Mapped[float] = mapped_column(Numeric(18, 2))
```

No new imports needed — `Numeric`, `DateTime`, `Uuid`, `func`, `Mapped`,
`mapped_column` are all already imported at the top of `models.py`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run python -m pytest tests/test_models.py -v`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 6: Generate the migration**

Run: `cd backend && uv run alembic revision --autogenerate -m "add portfolio_snapshots table"`

Open the generated file in `backend/migrations/versions/` and confirm it
contains `op.create_table("portfolio_snapshots", ...)` with all five
columns. Do not hand-edit — if something's missing, fix the model in
Step 4 and regenerate.

- [ ] **Step 7: Apply the migration and verify**

Run: `cd backend && uv run alembic upgrade head`
Expected: no errors. Re-run Step 5's test against the real migrated
schema: `uv run python -m pytest tests/test_models.py -v`

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/tests/test_models.py backend/migrations/versions/
git commit -m "feat: add PortfolioSnapshot model and migration"
```

---

## Task 2: `POST /portfolio/snapshot` + `GET /portfolio/snapshots`

**Files:**
- Modify: `backend/app/routers/portfolio.py`
- Modify: `backend/app/schemas.py` (add `PortfolioSnapshotOut` after
  `PreferencesOut`, end of file)
- Modify: `backend/tests/test_portfolio.py`

**Interfaces:**
- Consumes: `PortfolioSnapshot` model (Task 1),
  `app.agents.market_data.fetch_quote_and_history(ticker: str) ->
  dict[str, Any]` (existing — returns `{"price": float | None, "closes":
  list[float]}`).
- Produces: `POST /portfolio/snapshot` and `GET /portfolio/snapshots`
  endpoints returning `PortfolioSnapshotOut` / `list[PortfolioSnapshotOut]`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_portfolio.py`. Read the file's current
imports first — it currently imports `uuid`, `date`, and `Holding` from
`app.models`. Add `from unittest.mock import AsyncMock, patch` and
`from app.config import settings` (needed only for the last test below,
which inserts a `PortfolioSnapshot` directly — the holding-creation tests
below follow this file's existing convention of creating holdings via
`client.post("/portfolio/holdings", ...)`, not direct ORM construction,
matching every other test in this file except `test_holdings_scoped_to_user_id`):

```python
from unittest.mock import AsyncMock, patch

from app.config import settings
from app.models import PortfolioSnapshot  # add to the existing app.models import line


def test_snapshot_empty_portfolio_has_zero_totals(client):
    response = client.post("/portfolio/snapshot")

    assert response.status_code == 200
    body = response.json()
    assert body["total_market_value"] == 0
    assert body["total_cost_basis"] == 0


def test_snapshot_computes_totals_from_holdings(client):
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": "AAPL",
            "name": "Apple Inc.",
            "asset_type": "STOCK",
            "shares": 10,
            "cost_basis": 150.0,
            "first_purchase_date": "2024-01-01",
        },
    )

    with patch(
        "app.routers.portfolio.fetch_quote_and_history",
        AsyncMock(return_value={"price": 200.0, "closes": [200.0]}),
    ):
        response = client.post("/portfolio/snapshot")

    assert response.status_code == 200
    body = response.json()
    assert body["total_market_value"] == 2000.0  # 10 shares * $200
    assert body["total_cost_basis"] == 1500.0  # 10 shares * $150 cost basis


def test_snapshot_fails_when_price_fetch_raises(client):
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": "AAPL",
            "name": "Apple Inc.",
            "asset_type": "STOCK",
            "shares": 10,
            "cost_basis": 150.0,
            "first_purchase_date": "2024-01-01",
        },
    )

    with patch(
        "app.routers.portfolio.fetch_quote_and_history",
        AsyncMock(side_effect=RuntimeError("yfinance unavailable")),
    ):
        response = client.post("/portfolio/snapshot")

    assert response.status_code == 500


def test_snapshot_fails_when_price_is_none(client):
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": "DELISTED",
            "name": "Delisted Co",
            "asset_type": "STOCK",
            "shares": 10,
            "cost_basis": 150.0,
            "first_purchase_date": "2024-01-01",
        },
    )

    with patch(
        "app.routers.portfolio.fetch_quote_and_history",
        AsyncMock(return_value={"price": None, "closes": []}),
    ):
        response = client.post("/portfolio/snapshot")

    assert response.status_code == 500


def test_list_snapshots_ordered_oldest_first(client, db_session):
    db_session.add(PortfolioSnapshot(
        user_id=settings.default_user_id, total_market_value=100, total_cost_basis=90
    ))
    db_session.commit()
    db_session.add(PortfolioSnapshot(
        user_id=settings.default_user_id, total_market_value=200, total_cost_basis=90
    ))
    db_session.commit()

    response = client.get("/portfolio/snapshots")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert float(body[0]["total_market_value"]) == 100
    assert float(body[1]["total_market_value"]) == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m pytest tests/test_portfolio.py -v`
Expected: FAIL — 404 (no `/portfolio/snapshot` route registered yet)

- [ ] **Step 3: Write minimal implementation**

Add to `backend/app/schemas.py` (after `PreferencesOut`, end of file):

```python
class PortfolioSnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    total_market_value: float
    total_cost_basis: float
```

Modify `backend/app/routers/portfolio.py` — add the import and the two
new routes:

```python
from app.agents.market_data import fetch_quote_and_history
from app.models import Holding, PortfolioSnapshot, Trade, WatchlistItem
from app.schemas import (
    HoldingIn,
    HoldingOut,
    PortfolioSnapshotOut,
    TradeIn,
    TradeOut,
    WatchlistItemIn,
    WatchlistItemOut,
)
```

Add these two routes (anywhere after `router = APIRouter(...)`, e.g. at
the end of the file):

```python
@router.post("/snapshot", response_model=PortfolioSnapshotOut)
async def create_snapshot(db: Session = Depends(get_db)) -> PortfolioSnapshot:
    holdings = db.query(Holding).filter_by(user_id=settings.default_user_id).all()

    total_market_value = 0.0
    total_cost_basis = 0.0
    for holding in holdings:
        quote = await fetch_quote_and_history(holding.ticker)
        price = quote["price"]
        if price is None:
            raise HTTPException(
                status_code=500,
                detail=f"No current price available for {holding.ticker}",
            )
        total_market_value += float(holding.shares) * price
        total_cost_basis += float(holding.shares) * float(holding.cost_basis)

    snapshot = PortfolioSnapshot(
        user_id=settings.default_user_id,
        total_market_value=total_market_value,
        total_cost_basis=total_cost_basis,
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


@router.get("/snapshots", response_model=list[PortfolioSnapshotOut])
def list_snapshots(db: Session = Depends(get_db)) -> list[PortfolioSnapshot]:
    return (
        db.query(PortfolioSnapshot)
        .filter_by(user_id=settings.default_user_id)
        .order_by(PortfolioSnapshot.created_at)
        .all()
    )
```

Note on the "price fetch raises" test: `fetch_quote_and_history` raising
is not caught anywhere in this route, so it propagates as an unhandled
exception → FastAPI's default 500 handler. This is deliberate — the
Global Constraint says a fetch failure should fail the whole request, and
letting the exception propagate (rather than wrapping it in a try/except
that re-raises as `HTTPException`) is the simplest way to satisfy that.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m pytest tests/test_portfolio.py -v`
Expected: PASS (all tests in the file, including the 5 new ones)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/portfolio.py backend/app/schemas.py backend/tests/test_portfolio.py
git commit -m "feat: add POST /portfolio/snapshot and GET /portfolio/snapshots"
```

---

## Task 3: Full suite, lint, typecheck, docs

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§4 data model, §5 API table, §16
  checklist)

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && uv run python -m pytest tests/ -v`
Expected: all tests pass, including the new/updated `test_models.py` and
`test_portfolio.py`.

- [ ] **Step 2: Lint and format**

Run: `cd backend && uv run ruff check . && uv run ruff format --check .`
Expected: clean. Fix any findings.

- [ ] **Step 3: Typecheck**

Run: `cd backend && uv run mypy app`
Expected: clean (strict mode).

- [ ] **Step 4: Update ARCHITECTURE.md**

- §4 (data model): add a `PortfolioSnapshot` entry in the same style as
  the other model entries (`id, user_id, created_at, total_market_value,
  total_cost_basis`).
- §5 (API table): add two rows — `POST /portfolio/snapshot` and
  `GET /portfolio/snapshots` — in the same style as the existing rows.
- §16 checklist: mark "Portfolio value history" as done
  (`- [x]`), noting what it captures and that it's capture-only (no
  chart/UI yet).

- [ ] **Step 5: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: document portfolio value snapshots"
```
