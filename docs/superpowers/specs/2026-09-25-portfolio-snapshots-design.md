# Portfolio Value Snapshots — Design Spec

§16 pre-launch checklist item (Product category): "Portfolio value history —
no snapshot table exists, so no 'how am I doing over time' chart is
possible yet." No existing flow captures a portfolio's value at a point in
time — this is new capture and storage, same shape as 4b's
`InvestmentPreferences` (a new table plus a new endpoint, no existing flow
to modify).

## Scope

In scope:
- One new table, `PortfolioSnapshot` — one row per capture, holding the
  portfolio's total market value and total cost basis at that moment.
- `POST /portfolio/snapshot` — computes and persists one snapshot from the
  current `Holding` rows and live prices.
- `GET /portfolio/snapshots` — lists all snapshots, ordered oldest-first.

Out of scope:
- Any scheduler/cron triggering captures automatically. Manual, matching
  `/analysis/run`, `/backtest/run`, `/memory/embed`,
  `/memory/evaluate-outcomes` — all manual, re-callable endpoints in this
  project already.
- Per-holding breakdown within a snapshot (ticker-level value/price at
  capture time). A snapshot is a portfolio-level total only; add a
  per-holding table later if a per-holding chart is ever built.
- Date-range filtering on `GET /portfolio/snapshots`. Nothing consumes
  this endpoint yet (no frontend); add a filter once something needs one.
- Any UI/chart. This is capture and storage only — same boundary every
  other backend-only sub-project this session has drawn.
- Coupling snapshot capture to `/analysis/run` or any other existing
  endpoint as a side effect. Keeping it a separate, independently-callable
  endpoint avoids making one route responsible for two unrelated concerns.

## Data Model

New table, `backend/app/models.py`:

```python
class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    total_market_value: Mapped[float] = mapped_column(Numeric(18, 2))
    total_cost_basis: Mapped[float] = mapped_column(Numeric(18, 2))
```

No unique constraint — unlike `InvestmentPreferences`'s single-row-per-user
shape, multiple snapshots over time are the entire point of this table.
`Numeric(18, 2)` matches `BacktestResult.final_value`'s existing precision
for a dollar-value total.

Migration: `alembic revision --autogenerate` — a plain new table, no hand
edits needed.

## `backend/app/routers/portfolio.py` additions

```
POST /portfolio/snapshot
  -> holdings = db.query(Holding).filter_by(user_id=default_user_id).all()
  -> if no holdings: total_market_value = 0, total_cost_basis = 0 (skip fetching)
  -> for each holding: price = await fetch_quote_and_history(holding.ticker); accumulate
     shares * price["price"] into total_market_value,
     shares * cost_basis into total_cost_basis
  -> a price fetch that raises (after market_data._retry_fetch's 3 attempts
     exhaust) propagates and fails the whole request -- a total that
     silently omits a holding is worse than an explicit error
  -> create PortfolioSnapshot(user_id=default_user_id, total_market_value=...,
     total_cost_basis=...), commit, refresh, return

GET /portfolio/snapshots
  -> db.query(PortfolioSnapshot).filter_by(user_id=default_user_id)
     .order_by(PortfolioSnapshot.created_at).all()
```

New schemas in `backend/app/schemas.py`:
```python
class PortfolioSnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    total_market_value: float
    total_cost_basis: float
```
No `*In` schema — the endpoint takes no request body, it's computed
entirely from existing `Holding` rows.

## Testing

- Model roundtrip test in `test_models.py`, matching its existing
  per-model pattern.
- Router tests in `test_portfolio.py` (or a new file if that one is
  already large — check first), mocking
  `app.routers.portfolio.fetch_quote_and_history` (never a real yfinance
  call in tests, matching this project's established rule):
  - Empty portfolio (no holdings) → snapshot with both totals `0`.
  - Single holding → `total_market_value`/`total_cost_basis` computed
    correctly from `shares × price` / `shares × cost_basis`.
  - A price fetch failure → the endpoint returns an error (not a 200 with
    a partial/wrong total).
  - `GET /portfolio/snapshots` returns snapshots ordered oldest-first.
