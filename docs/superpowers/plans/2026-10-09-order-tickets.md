# Order tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each line of a saved contribution plan into copy-ready order text, and let the person record that they placed it, which logs the buy through the existing trade code and updates the portfolio.

**Architecture:** An optional ISIN per ticker (a dedicated route, never part of the holdings or watchlist upsert bodies), a shared `apply_trade` function extracted from the trade route, and one new route that places a plan line: it creates the holding if needed, applies a BUY through the shared function, and stamps the line, all in one transaction under the per-person insert lock. The ticket text is built in the frontend. Nothing here talks to a broker.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic (hand-written migration), Pydantic v2, pytest; Next.js 16, MUI 9, SWR, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-order-tickets-design.md`

## Global Constraints

- The system never places a trade and never calls a broker. "Placed" only records what the person did. Screens say "Order" and "Placed", never Buy or Sell labels, and carry "Advisory only. Nothing is sent to a broker."
- The plan line's EUR price is NEVER written into the trade log or a cost basis. The person types the fill price in the holding's own currency; only the planned shares are prefilled.
- ISIN: nullable `varchar(12)`, empty or matching `^[A-Z]{2}[A-Z0-9]{9}[0-9]$`, and the API also verifies the ISO 6166 check digit (Luhn over the letters expanded to digits). Lowercase input is uppercased; an empty string clears.
- ISIN is set ONLY through `PUT /portfolio/instruments/{ticker}/isin`. `HoldingIn` and `WatchlistItemIn` do not get an `isin` field (the holdings upsert is a full replace and would wipe it); `HoldingOut` and `WatchlistItemOut` do, so the export and responses carry it.
- Placed route: one placement per line (second call is 409); another person's or missing line is 404; shares and price positive and finite like `TradeIn`; the 100-holding cap and `lock_user_for_insert` apply when a holding is created; all of it in one transaction; rate limited 60 a minute per person.
- No undo for a placed line (the trade log has no delete). A mistaken "Placed" is fixed with a SELL in the trade log.
- The ticket is `Order (amount): 92.30 EUR · <name> · ISIN <isin> · about 1.69 shares at 54.64 EUR` (ISIN part omitted when none; whole-shares plans say `N shares`).
- Hand-written migration only (a new file). Alembic head before this work: `d5f3a9b72e18`.
- Plan data, tickets and ISINs are never logged and never sent to Telegram.
- Conventional Commits; never skip hooks or GPG signing (retry once on a signing timeout, otherwise leave the work staged and report); branch `feature/order-tickets`.

## Rulings (refine the spec)

1. The placed body's `asset_type` is optional: it is required (422) only when the holding does not exist yet; the UI sends it only for a new position.
2. `GET /plans/{id}` and the export resolve each line's ISIN at read time from the holding (wins) or the watchlist item for the same ticker.
3. The trade logic is extracted into `app/trades.py` as `apply_trade(db, user_id, holding, payload) -> Trade` raising `TradeRefused` (a domain exception, per backend/CLAUDE.md); it does not commit. `POST /portfolio/trades` converts `TradeRefused` to the same 422 messages it returned before.

## Review Focus

1. **Double click or two tabs on "Placed":** the second call is 409 and the portfolio is changed once, under the per-person lock. [Task 5]
2. **Placing a new position when the person already has 100 holdings:** 409 with the cap message, nothing written. [Task 5]
3. **A bad ISIN (right shape, wrong check digit; lowercase; 11 characters; empty):** 422 / normalised / cleared, never stored wrong. [Task 2]
4. **Currency:** the sheet never sends the plan's EUR price; the route logs exactly the shares and price the person sent. [Task 5, frontend tasks]
5. **A ticker held and also watched, with an ISIN on only one of them:** the ticket shows the holding's ISIN, else the watchlist's. [Task 4]
6. **Deleting a plan with placed lines:** the trades stay; the plan and its lines go. [Task 5]
7. **A line of another person, or of a deleted plan:** 404, nothing created. [Task 5]

---

## File Structure

- Create `backend/migrations/versions/<new>_add_order_tickets.py`; `backend/app/isin.py` (pure validation); `backend/app/trades.py` (shared trade logic).
- Modify `backend/app/models.py`, `backend/app/schemas.py`, `backend/app/routers/portfolio.py` (ISIN route, trade route uses `apply_trade`), `backend/app/plans.py` (ISIN lookup, `place_line`), `backend/app/routers/plans.py` (placed route), `backend/tests/test_contribution_migration.py` (head assertion).
- Tests: `backend/tests/test_isin.py`, `test_trades_shared.py`, `test_order_tickets_migration.py`, additions to `test_portfolio.py`, `test_plans_router.py`, `test_me_router.py`, `test_models.py`.
- Docs: `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `PRODUCT.md`, the spec if a ruling changes it.
- Frontend (Part 2): `frontend/lib/orders.ts`, `frontend/lib/plans.ts`, `frontend/components/plan/*`, a new `PlacedSheet`.

Hazards for every implementer: the ruff PostToolUse hook strips imports that are unused when you add them (add an import together with its first use); each `asyncio.run` in a test is its own event loop and the cached Redis client is bound to one (reset `app.redis_client._redis = None` after each); the local TLS issue with uv needs `--system-certs`; `HoldingIn` is a full-replace upsert body, so never add `isin` to it; Docker/Postgres must be running for the suite.

---

## Part 1 — Backend

### Task 1: Migration, models, output fields

**Files:**
- Create: `backend/migrations/versions/<revision>_add_order_tickets.py` (new revision id of your choice, 12 hex characters; `down_revision = 'd5f3a9b72e18'`)
- Modify: `backend/app/models.py`, `backend/app/schemas.py` (`HoldingOut`, `WatchlistItemOut`, `PlanLineOut`), `backend/tests/test_contribution_migration.py`
- Test: `backend/tests/test_order_tickets_migration.py`, `backend/tests/test_models.py`

**Interfaces:**
- Produces: `Holding.isin`, `WatchlistItem.isin` (`str | None`); `ContributionPlanLine.placed_at` (`datetime | None`), `ContributionPlanLine.placed_trade_id` (`int | None`); `HoldingOut.isin`, `WatchlistItemOut.isin` (`str | None = None`); `PlanLineOut.id: int | None = None`, `.isin: str | None = None`, `.placed_at: datetime | None = None`, `.placed_trade_id: int | None = None`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_order_tickets_migration.py` (same pattern as `test_contribution_migration.py`):

```python
import importlib.util
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parent.parent


def _migration():
    path = next((BACKEND / "migrations" / "versions").glob("*_add_order_tickets.py"))
    spec = importlib.util.spec_from_file_location("add_order_tickets", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_is_the_single_head_on_top_of_the_planner_revision():
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()

    migration = _migration()
    assert heads == [migration.revision]
    assert migration.down_revision == "d5f3a9b72e18"
```

In `backend/tests/test_contribution_migration.py` replace `assert heads == [migration.revision]` with `assert len(heads) == 1` (keep the `down_revision` assertion): the planner migration is no longer the head.

Append to `backend/tests/test_models.py` (use the file's `db_session` fixture and add the imports with their first use):

```python
def test_isin_and_placed_columns_are_nullable_and_the_isin_check_rejects_junk(db_session):
    uid = uuid.uuid4()
    holding = Holding(user_id=uid, ticker="EIMI.L", name="x", asset_type="ETF", shares=1,
                      cost_basis=1, first_purchase_date=date(2024, 1, 1))
    item = WatchlistItem(user_id=uid, ticker="NVDA", asset_type="STOCK")
    plan = ContributionPlan(user_id=uid, amount_eur=1, whole_shares=False, total_before_eur=0,
                            leftover_eur=0, notes=[])
    db_session.add_all([holding, item, plan])
    db_session.commit()
    line = ContributionPlanLine(user_id=uid, plan_id=plan.id, ticker="EIMI.L", name="x", amount_eur=1,
                                shares=1, price_eur=1, currency="EUR", rate=1, reason="underweight")
    db_session.add(line)
    db_session.commit()
    assert holding.isin is None and item.isin is None
    assert line.placed_at is None and line.placed_trade_id is None
    holding.isin = "IE00BKM4GZ66"
    db_session.commit()
    holding.isin = "not an isin"
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
```

- [ ] **Step 2: Run to verify they fail**

Run (from `backend/`): `uv run --system-certs pytest tests/test_order_tickets_migration.py tests/test_models.py -q`
Expected: FAIL (`StopIteration` on the missing migration file, `AttributeError: isin`).

- [ ] **Step 3: Write the migration** (template: `d5f3a9b72e18_add_contribution_planner.py`)

```python
"""add isin to holdings and watchlist items, placed markers to plan lines

Revision ID: e7b2c4d91a35
Revises: d5f3a9b72e18
Create Date: 2026-10-09 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e7b2c4d91a35'
down_revision: Union[str, Sequence[str], None] = 'd5f3a9b72e18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ISIN_CHECK = "isin IS NULL OR isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'"


def upgrade() -> None:
    for table in ("holdings", "watchlist_items"):
        op.add_column(table, sa.Column("isin", sa.String(length=12), nullable=True))
        op.create_check_constraint(f"ck_{table}_isin", table, ISIN_CHECK)
    op.add_column("contribution_plan_lines", sa.Column("placed_at", sa.DateTime(), nullable=True))
    op.add_column("contribution_plan_lines", sa.Column("placed_trade_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("contribution_plan_lines", "placed_trade_id")
    op.drop_column("contribution_plan_lines", "placed_at")
    for table in ("watchlist_items", "holdings"):
        op.drop_constraint(f"ck_{table}_isin", table, type_="check")
        op.drop_column(table, "isin")
```

(The new columns need no grants or policy changes: the tables already have them.)

- [ ] **Step 4: Models and schemas**

`backend/app/models.py`:

```python
# Holding: after `sector`
    isin: Mapped[str | None] = mapped_column(String(12), nullable=True)

# WatchlistItem: after `target_weight`
    isin: Mapped[str | None] = mapped_column(String(12), nullable=True)

# ContributionPlanLine: after `reason`
    placed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    placed_trade_id: Mapped[int | None] = mapped_column(nullable=True)
```

`backend/app/schemas.py`: add `isin: str | None = None` to `HoldingOut` and `WatchlistItemOut` (NOT to the `...In` classes), and to `PlanLineOut` add

```python
    id: int | None = None
    isin: str | None = None
    placed_at: datetime | None = None
    placed_trade_id: int | None = None
```

- [ ] **Step 5: Apply and run**

Run: `uv run --system-certs alembic upgrade head` (the LOCAL database only: confirm the host in `backend/.env` is localhost first), `alembic downgrade -1`, `alembic upgrade head`, then `uv run --system-certs pytest tests/test_order_tickets_migration.py tests/test_models.py tests/test_contribution_migration.py -q`, then the full suite, ruff and mypy.
Expected: PASS (existing export and plan tests still pass: the new fields default to None).

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat: isin on holdings and watchlist items, placed markers on plan lines"
```

---

### Task 2: ISIN validation and the ISIN route

**Files:**
- Create: `backend/app/isin.py`
- Modify: `backend/app/schemas.py` (`IsinIn`, `IsinOut`), `backend/app/routers/portfolio.py`
- Test: `backend/tests/test_isin.py`, `backend/tests/test_portfolio.py`, `backend/tests/test_me_router.py`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `isin.is_valid_isin(value: str) -> bool`; `schemas.IsinIn(isin: str | None)` (normalises: strip, uppercase, empty to `None`, 422 on bad); `schemas.IsinOut(ticker: str, isin: str | None)`; route `PUT /portfolio/instruments/{ticker}/isin` returning `IsinOut`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_isin.py`:

```python
import pytest

from app.isin import is_valid_isin


@pytest.mark.parametrize(
    "isin", ["US0378331005", "IE00BKM4GZ66", "IE00B4L5Y983", "US5949181045", "IE00B53SZB19"]
)
def test_real_isins_pass(isin):
    assert is_valid_isin(isin)


@pytest.mark.parametrize(
    "isin",
    ["US0378331006", "IE00BKM4GZ65", "us0378331005", "US037833100", "US03783310055", "1E00BKM4GZ66", ""],
)
def test_bad_isins_fail(isin):
    assert not is_valid_isin(isin)
```

Append to `backend/tests/test_portfolio.py` (use its `client` and holding helpers; seed with the file's helper or `client.post("/portfolio/holdings", ...)`):

```python
def _hold(client, ticker="EIMI.L"):
    return client.post("/portfolio/holdings", json={
        "ticker": ticker, "name": "iShares EM IMI", "asset_type": "ETF", "shares": 2,
        "cost_basis": 10, "first_purchase_date": "2024-01-01",
    })


def test_isin_is_set_on_the_holding_and_never_wiped_by_a_holding_upsert(client):
    _hold(client)
    ok = client.put("/portfolio/instruments/EIMI.L/isin", json={"isin": " ie00bkm4gz66 "})
    assert ok.status_code == 200 and ok.json() == {"ticker": "EIMI.L", "isin": "IE00BKM4GZ66"}
    _hold(client)  # a full-replace upsert that omits the isin
    assert [h["isin"] for h in client.get("/portfolio/holdings").json()] == ["IE00BKM4GZ66"]


def test_isin_goes_to_the_watchlist_item_too_and_empty_clears(client):
    client.post("/portfolio/watchlist", json={"ticker": "NVDA", "asset_type": "STOCK"})
    _hold(client, "NVDA")
    client.put("/portfolio/instruments/NVDA/isin", json={"isin": "US0378331005"})
    assert client.get("/portfolio/watchlist").json()[0]["isin"] == "US0378331005"
    assert client.get("/portfolio/holdings").json()[0]["isin"] == "US0378331005"
    cleared = client.put("/portfolio/instruments/NVDA/isin", json={"isin": ""}).json()
    assert cleared["isin"] is None
    assert client.get("/portfolio/holdings").json()[0]["isin"] is None


@pytest.mark.parametrize("bad", ["US0378331006", "IE00BKM4GZ6", "x" * 13, "ie00bkm4gz65"])
def test_a_bad_isin_is_rejected_and_nothing_is_stored(client, bad):
    _hold(client)
    assert client.put("/portfolio/instruments/EIMI.L/isin", json={"isin": bad}).status_code == 422
    assert client.get("/portfolio/holdings").json()[0]["isin"] is None


def test_isin_for_an_unknown_ticker_is_404(client):
    assert client.put("/portfolio/instruments/ZZZZ/isin", json={"isin": "US0378331005"}).status_code == 404


def test_isin_never_touches_another_persons_rows(client, db_session):
    db_session.add(Holding(user_id=OTHER_USER_ID, ticker="EIMI.L", name="x", asset_type="ETF", shares=1,
                           cost_basis=1, first_purchase_date=date(2024, 1, 1)))
    db_session.commit()
    assert client.put("/portfolio/instruments/EIMI.L/isin", json={"isin": "IE00BKM4GZ66"}).status_code == 404
    assert db_session.query(Holding).filter_by(user_id=OTHER_USER_ID).one().isin is None
```

Append to `backend/tests/test_me_router.py`: seed a holding with `isin="IE00BKM4GZ66"` (owner session) and assert `client.get("/me/export").json()["holdings"][0]["isin"] == "IE00BKM4GZ66"`.

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --system-certs pytest tests/test_isin.py tests/test_portfolio.py tests/test_me_router.py -q`
Expected: FAIL (`ModuleNotFoundError: app.isin`, 404 for the route).

- [ ] **Step 3: Implement**

`backend/app/isin.py`:

```python
"""ISIN validation: the shape and the ISO 6166 check digit (Luhn over the letters expanded to digits)."""

import re

_SHAPE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


def is_valid_isin(value: str) -> bool:
    if not _SHAPE.match(value):
        return False
    digits = "".join(str(int(char, 36)) for char in value)  # A=10 ... Z=35
    total = 0
    for index, char in enumerate(reversed(digits)):
        n = int(char)
        if index % 2 == 1:
            n *= 2
            n = n // 10 + n % 10
        total += n
    return total % 10 == 0
```

`backend/app/schemas.py`:

```python
class IsinIn(BaseModel):
    isin: str | None = None

    @field_validator("isin", mode="before")
    @classmethod
    def _normalise(cls, value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("isin must be text")
        text = value.strip().upper()
        if text == "":
            return None
        if not is_valid_isin(text):
            raise ValueError("Not a valid ISIN: 12 characters with a correct check digit.")
        return text


class IsinOut(BaseModel):
    ticker: str
    isin: str | None
```

(Import `field_validator` from pydantic and `is_valid_isin` from `app.isin`, each with its first use.)

`backend/app/routers/portfolio.py`:

```python
@router.put(
    "/instruments/{ticker}/isin",
    response_model=IsinOut,
    dependencies=[Depends(rate_limiter("portfolio_isin", limit=WRITE_LIMIT_PER_MINUTE))],
)
def set_isin(
    ticker: str,
    payload: IsinIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> IsinOut:
    """Sets (or clears) the ISIN on the person's holding and/or watchlist row for this ticker.
    A dedicated route: the holdings upsert replaces the whole record and would wipe it."""
    symbol = ticker.upper()
    holding = db.query(Holding).filter_by(user_id=user.id, ticker=symbol).one_or_none()
    item = db.query(WatchlistItem).filter_by(user_id=user.id, ticker=symbol).one_or_none()
    if holding is None and item is None:
        raise HTTPException(status_code=404, detail="No holding or watchlist item for that ticker")
    for row in (holding, item):
        if row is not None:
            row.isin = payload.isin
    db.commit()
    return IsinOut(ticker=symbol, isin=payload.isin)
```

- [ ] **Step 4: Run** — the three files, then the full suite, ruff, mypy. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: isin validation and the route that sets it on a holding or watchlist item"
```

---

### Task 3: Extract the trade logic into a shared function

**Files:**
- Create: `backend/app/trades.py`
- Modify: `backend/app/routers/portfolio.py` (`log_trade`)
- Test: `backend/tests/test_trades_shared.py`; the existing trade tests in `backend/tests/test_portfolio.py` must pass UNCHANGED.

**Interfaces:**
- Produces: `class TradeRefused(Exception)` (its text is the user-facing detail); `apply_trade(db: Session, user_id: uuid.UUID, holding: Holding, payload: TradeIn) -> Trade` which updates `holding.shares` and `holding.cost_basis` (BUY: weighted average; SELL: refuses more than held), adds the `Trade` row to the session and RETURNS it without committing or refreshing.

- [ ] **Step 1: Write the failing tests** (`backend/tests/test_trades_shared.py`; use the `db_session` owner fixture)

```python
import uuid
from datetime import date

import pytest

from app.models import Holding
from app.schemas import TradeIn
from app.trades import TradeRefused, apply_trade


def _holding(db, shares, cost):
    uid = uuid.uuid4()
    h = Holding(user_id=uid, ticker="AAPL", name="Apple", asset_type="STOCK", shares=shares,
                cost_basis=cost, first_purchase_date=date(2024, 1, 1))
    db.add(h)
    db.flush()
    return uid, h


def test_a_buy_updates_the_weighted_average_and_adds_the_trade(db_session):
    uid, h = _holding(db_session, 10, 100)
    trade = apply_trade(db_session, uid, h,
                        TradeIn(date=date(2026, 10, 1), ticker="AAPL", action="BUY", shares=10, price=120))
    assert (float(h.shares), float(h.cost_basis)) == (20.0, 110.0)
    assert trade.user_id == uid and trade.action == "BUY" and trade in db_session.new


def test_a_sell_reduces_shares_and_keeps_the_cost(db_session):
    uid, h = _holding(db_session, 10, 100)
    apply_trade(db_session, uid, h,
                TradeIn(date=date(2026, 10, 1), ticker="AAPL", action="SELL", shares=4, price=150))
    assert (float(h.shares), float(h.cost_basis)) == (6.0, 100.0)


def test_selling_more_than_held_is_refused_and_changes_nothing(db_session):
    uid, h = _holding(db_session, 10, 100)
    with pytest.raises(TradeRefused, match="Cannot sell 11"):
        apply_trade(db_session, uid, h,
                    TradeIn(date=date(2026, 10, 1), ticker="AAPL", action="SELL", shares=11, price=1))
    assert float(h.shares) == 10.0
```

- [ ] **Step 2: Run to verify they fail** — `uv run --system-certs pytest tests/test_trades_shared.py -q`; expected: FAIL (`ModuleNotFoundError: app.trades`).

- [ ] **Step 3: Implement**

`backend/app/trades.py` (the arithmetic is moved verbatim from `log_trade`):

```python
"""The one place a trade changes a holding. Callers own the transaction: nothing here commits."""

import uuid

from sqlalchemy.orm import Session

from app.models import Holding, Trade
from app.schemas import TradeIn


class TradeRefused(Exception):
    """The trade cannot be applied; the text is safe to show to the person."""


def apply_trade(db: Session, user_id: uuid.UUID, holding: Holding, payload: TradeIn) -> Trade:
    if payload.action == "BUY":
        prior_value = float(holding.shares) * float(holding.cost_basis)
        added_value = payload.shares * payload.price
        total_cost = prior_value + added_value
        holding.shares = float(holding.shares) + payload.shares
        holding.cost_basis = total_cost / float(holding.shares)
    elif payload.action == "SELL":
        if payload.shares > float(holding.shares):
            raise TradeRefused(f"Cannot sell {payload.shares}; holding has {float(holding.shares)}")
        holding.shares = float(holding.shares) - payload.shares
    else:
        raise TradeRefused("action must be BUY or SELL")
    trade = Trade(user_id=user_id, **payload.model_dump())
    db.add(trade)
    return trade
```

`log_trade` in `routers/portfolio.py` keeps the 404 for a missing holding, then:

```python
    try:
        trade = apply_trade(db, user.id, holding, payload)
    except TradeRefused as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    db.commit()
    db.refresh(trade)
    return trade
```

(remove the moved arithmetic from the route; import `apply_trade, TradeRefused`.)

- [ ] **Step 4: Run** — `tests/test_trades_shared.py tests/test_portfolio.py` (the existing trade tests, unchanged), then the full suite, ruff, mypy. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "refactor: one shared apply_trade used by the trade route"
```

---

### Task 4: Plan lines carry their ID, ISIN and placed state

**Files:**
- Modify: `backend/app/plans.py` (`_out`, `load`, `load_all`)
- Test: `backend/tests/test_plans_router.py`, `backend/tests/test_me_router.py`

**Interfaces:**
- Consumes: Task 1 fields on `PlanLineOut` and the models.
- Produces: `GET /plans/{id}` and the export return per line `id`, `isin` (holding's, else the watchlist item's for the same ticker, else `None`), `placed_at`, `placed_trade_id`. Preview lines have `id`, `isin`, `placed_at`, `placed_trade_id` all `None`.
- Internal: `plans._isins(db, user_id) -> dict[str, str]` and `_out(row, lines, isins)`.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_plans_router.py`; reuse `_holding`, `_watch`, `_prices`, `_seed_basic`)

```python
def _saved(client):
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        return client.post("/plans", json={"amount": 500}).json()


def test_saved_lines_carry_their_id_and_the_isin_of_the_holding_or_the_watchlist_item(client, db_session):
    _seed_basic(db_session)
    db_session.query(Holding).filter_by(ticker="AAPL").update({"isin": "US0378331005"})
    db_session.query(WatchlistItem).filter_by(ticker="NVDA").update({"isin": "US5949181045"})
    db_session.commit()
    plan = _saved(client)
    lines = {l["ticker"]: l for l in client.get(f"/plans/{plan['id']}").json()["lines"]}
    assert lines["AAPL"]["isin"] == "US0378331005"
    assert lines["NVDA"]["isin"] == "US5949181045"
    assert all(isinstance(l["id"], int) for l in lines.values())
    assert all(l["placed_at"] is None and l["placed_trade_id"] is None for l in lines.values())


def test_the_holdings_isin_wins_over_the_watchlists(client, db_session):
    _seed_basic(db_session)
    _watch(db_session, "AAPL", 0.1)
    db_session.query(Holding).filter_by(ticker="AAPL").update({"isin": "US0378331005"})
    db_session.query(WatchlistItem).filter_by(ticker="AAPL").update({"isin": "US5949181045"})
    db_session.commit()
    plan = _saved(client)
    line = next(l for l in client.get(f"/plans/{plan['id']}").json()["lines"] if l["ticker"] == "AAPL")
    assert line["isin"] == "US0378331005"


def test_an_isin_added_after_saving_shows_on_the_old_plan(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    assert all(l["isin"] is None for l in client.get(f"/plans/{plan['id']}").json()["lines"])
    client.put("/portfolio/instruments/AAPL/isin", json={"isin": "US0378331005"})
    line = next(l for l in client.get(f"/plans/{plan['id']}").json()["lines"] if l["ticker"] == "AAPL")
    assert line["isin"] == "US0378331005"


def test_a_preview_has_no_line_ids(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert all(l["id"] is None and l["isin"] is None for l in body["lines"])


def test_another_persons_isin_never_leaks_onto_my_lines(client, db_session):
    _seed_basic(db_session)
    _holding(db_session, "AAPL", 1, 0.1, user_id=OTHER_USER_ID)
    db_session.query(Holding).filter_by(user_id=OTHER_USER_ID).update({"isin": "US0378331005"})
    db_session.commit()
    plan = _saved(client)
    assert all(l["isin"] is None for l in client.get(f"/plans/{plan['id']}").json()["lines"])
```

In `backend/tests/test_me_router.py`, extend the plan export test to assert each exported line has `id` and `isin` keys.

- [ ] **Step 2: Run to verify they fail** — `uv run --system-certs pytest tests/test_plans_router.py tests/test_me_router.py -q`; expected: FAIL (`isin` is `None`).

- [ ] **Step 3: Implement** in `backend/app/plans.py`:

```python
def _isins(db: Session, user_id: uuid.UUID) -> dict[str, str]:
    """ticker -> ISIN, the holding's winning over the watchlist item's; only the person's rows."""
    found: dict[str, str] = {}
    for model in (WatchlistItem, Holding):  # holdings last, so they win
        rows = db.query(model.ticker, model.isin).filter(model.user_id == user_id, model.isin.isnot(None))
        found.update({ticker: isin for ticker, isin in rows})
    return found


def _out(row: ContributionPlan, lines: list[ContributionPlanLine], isins: dict[str, str]) -> PlanOut:
    return PlanOut(
        id=row.id,
        created_at=row.created_at,
        amount_eur=float(row.amount_eur),
        whole_shares=row.whole_shares,
        total_before_eur=float(row.total_before_eur),
        leftover_eur=float(row.leftover_eur),
        lines=[
            PlanLineOut.model_validate(line, from_attributes=True).model_copy(
                update={"isin": isins.get(line.ticker)}
            )
            for line in lines
        ],
        notes=list(row.notes or []),
    )
```

(Keep the existing `_out` body for the fields it already builds; the only changes are the `isins` parameter and the line construction above. `load` calls `_out(row, lines, _isins(db, user_id))`; `load_all` computes `isins` once and passes it to every `_out`. `save` still returns `load(...)`.)

- [ ] **Step 4: Run** — the two files, then the full suite, ruff, mypy. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: plan lines expose their id, the live isin and the placed state"
```

---

### Task 5: The placed route

**Files:**
- Modify: `backend/app/schemas.py` (`PlaceIn`), `backend/app/plans.py` (`place_line`), `backend/app/routers/plans.py`
- Test: `backend/tests/test_plans_router.py`

**Interfaces:**
- Consumes: `apply_trade`/`TradeRefused` (Task 3), the line fields (Task 4), `lock_user_for_insert`.
- Produces: `schemas.PlaceIn(date: date, shares: PositiveFloat, price: PositiveFloat, asset_type: AssetType | None = None)`; `plans.place_line(db, user_id, plan_id, line_id, payload) -> PlanLineOut` (sync; raises `HTTPException` 404 / 409 / 422); route `POST /plans/{plan_id}/lines/{line_id}/placed` returning `PlanLineOut`, rate limited 60 a minute, declared with the other `/{plan_id}` routes (after `/drift`).

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_plans_router.py`; `_saved`, `_seed_basic`, `_prices`, `_holding`, `_watch` exist; add `Trade` to the model imports)

```python
def _line(client, plan, ticker):
    return next(l for l in client.get(f"/plans/{plan['id']}").json()["lines"] if l["ticker"] == ticker)


def _place(client, plan, line, **body):
    payload = {"date": "2026-10-09", "shares": 1.5, "price": 210.0, **body}
    return client.post(f"/plans/{plan['id']}/lines/{line['id']}/placed", json=payload)


def test_placing_a_line_of_a_held_ticker_logs_the_buy_like_the_trade_route(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "AAPL")
    res = _place(client, plan, line, shares=2, price=250)
    assert res.status_code == 200 and res.json()["placed_trade_id"] is not None
    assert res.json()["placed_at"] is not None
    holding = db_session.query(Holding).filter_by(user_id=USER_ID, ticker="AAPL").one()
    db_session.refresh(holding)
    assert float(holding.shares) == 7.0 and round(float(holding.cost_basis), 4) == round((5 * 10 + 2 * 250) / 7, 4)
    trade = db_session.query(Trade).filter_by(user_id=USER_ID).one()
    assert (trade.ticker, trade.action, float(trade.shares), float(trade.price)) == ("AAPL", "BUY", 2.0, 250.0)
    assert _line(client, plan, "AAPL")["placed_trade_id"] == trade.id


def test_the_plans_euro_price_is_never_written_to_the_trade(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "AAPL")
    _place(client, plan, line, shares=1, price=999.5)
    assert float(db_session.query(Trade).one().price) == 999.5  # exactly what the person sent


def test_placing_a_new_position_creates_the_holding(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "NVDA")  # on the watchlist, not held
    assert _place(client, plan, line, asset_type="STOCK", shares=2.6, price=130).status_code == 200
    holding = db_session.query(Holding).filter_by(user_id=USER_ID, ticker="NVDA").one()
    assert (holding.asset_type, holding.name) == ("STOCK", line["name"])
    assert (float(holding.shares), float(holding.cost_basis)) == (2.6, 130.0)
    assert str(holding.first_purchase_date) == "2026-10-09"


def test_a_new_position_needs_an_asset_type(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "NVDA")
    assert _place(client, plan, line).status_code == 422
    assert db_session.query(Holding).filter_by(user_id=USER_ID, ticker="NVDA").count() == 0
    assert db_session.query(Trade).count() == 0


def test_a_line_can_be_placed_once(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "AAPL")
    assert _place(client, plan, line).status_code == 200
    assert _place(client, plan, line).status_code == 409
    assert db_session.query(Trade).count() == 1


def test_another_persons_line_is_404_and_changes_nothing(client, db_session):
    other = ContributionPlan(user_id=OTHER_USER_ID, amount_eur=100, whole_shares=False,
                             total_before_eur=0, leftover_eur=0, notes=[])
    db_session.add(other)
    db_session.commit()
    other_line = ContributionPlanLine(user_id=OTHER_USER_ID, plan_id=other.id, ticker="AAPL", name="Apple",
                                      amount_eur=100, shares=1, price_eur=100, currency="EUR", rate=1,
                                      reason="underweight")
    db_session.add(other_line)
    db_session.commit()
    res = client.post(f"/plans/{other.id}/lines/{other_line.id}/placed",
                      json={"date": "2026-10-09", "shares": 1, "price": 1})
    assert res.status_code == 404
    assert db_session.query(Trade).count() == 0
    assert db_session.get(ContributionPlanLine, other_line.id).placed_at is None


def test_a_line_id_from_another_plan_is_404(client, db_session):
    _seed_basic(db_session)
    first, second = _saved(client), _saved(client)
    line = _line(client, first, "AAPL")
    res = client.post(f"/plans/{second['id']}/lines/{line['id']}/placed",
                      json={"date": "2026-10-09", "shares": 1, "price": 1})
    assert res.status_code == 404


@pytest.mark.parametrize("body", [{"shares": 0}, {"shares": -1}, {"price": 0}, {"price": "x"}, {"date": "nope"}])
def test_bad_shares_price_or_date_are_422(client, db_session, body):
    _seed_basic(db_session)
    plan = _saved(client)
    assert _place(client, plan, _line(client, plan, "AAPL"), **body).status_code == 422
    assert db_session.query(Trade).count() == 0


def test_a_new_position_past_the_holding_cap_is_409_and_writes_nothing(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "NVDA")
    for i in range(98):  # 2 held + 98 = 100
        _holding(db_session, f"T{i}", 1, None)
    res = _place(client, plan, line, asset_type="STOCK")
    assert res.status_code == 409
    assert db_session.query(Trade).count() == 0
    assert db_session.get(ContributionPlanLine, line["id"]).placed_at is None


def test_deleting_a_plan_keeps_the_trades_it_produced(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    _place(client, plan, _line(client, plan, "AAPL"))
    assert client.delete(f"/plans/{plan['id']}").status_code == 204
    assert db_session.query(Trade).count() == 1
    assert db_session.query(ContributionPlanLine).filter_by(plan_id=plan["id"]).count() == 0


def test_placing_is_rate_limited_per_person(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    line = _line(client, plan, "AAPL")
    codes = [_place(client, plan, line).status_code for _ in range(62)]
    assert codes[0] == 200 and 429 in codes


def test_placing_requires_authentication(anon_client):
    assert anon_client.post("/plans/1/lines/1/placed",
                            json={"date": "2026-10-09", "shares": 1, "price": 1}).status_code == 401
```

- [ ] **Step 2: Run to verify they fail** — `uv run --system-certs pytest tests/test_plans_router.py -q`; expected: FAIL (404/405 for the route).

- [ ] **Step 3: Implement**

`backend/app/schemas.py`:

```python
class PlaceIn(BaseModel):
    date: date
    shares: PositiveFloat
    price: PositiveFloat
    asset_type: AssetType | None = None  # needed only when the ticker is not a holding yet
```

`backend/app/plans.py`:

```python
MAX_HOLDINGS = 100  # the same cap as the holdings route


def place_line(db: Session, user_id: uuid.UUID, plan_id: int, line_id: int, payload: PlaceIn) -> PlanLineOut:
    """Records that the person placed this line's order in their broker: creates the holding when
    it is new, logs a BUY through the shared trade code, stamps the line. One transaction."""
    try:
        lock_user_for_insert(db, user_id)  # a double click or a second tab cannot place it twice
        line = (
            db.query(ContributionPlanLine)
            .filter_by(id=line_id, plan_id=plan_id, user_id=user_id)
            .one_or_none()
        )
        if line is None:
            raise HTTPException(404, "Plan line not found")
        if line.placed_at is not None:
            raise HTTPException(409, "This line is already recorded as placed.")
        holding = db.query(Holding).filter_by(user_id=user_id, ticker=line.ticker).one_or_none()
        if holding is None:
            if payload.asset_type is None:
                raise HTTPException(422, "asset_type is required for a new position.")
            if db.query(Holding).filter_by(user_id=user_id).count() >= MAX_HOLDINGS:
                raise HTTPException(
                    409, f"You can keep up to {MAX_HOLDINGS} holdings. Remove one before adding another."
                )
            holding = Holding(
                user_id=user_id, ticker=line.ticker, name=line.name, asset_type=payload.asset_type,
                shares=0, cost_basis=0, first_purchase_date=payload.date,
            )
            db.add(holding)
        trade = apply_trade(
            db, user_id, holding,
            TradeIn(date=payload.date, ticker=line.ticker, action="BUY", shares=payload.shares, price=payload.price),
        )
        db.flush()  # assigns trade.id
        line.placed_at = datetime.now(UTC).replace(tzinfo=None)
        line.placed_trade_id = trade.id
        db.commit()
    except TradeRefused as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from None
    except DataError:
        db.rollback()
        raise HTTPException(422, "Those numbers are too large to store.") from None
    except (SQLAlchemyError, HTTPException):
        db.rollback()
        raise
    db.refresh(line)
    return PlanLineOut.model_validate(line, from_attributes=True).model_copy(
        update={"isin": _isins(db, user_id).get(line.ticker)}
    )
```

(Imports with their first use: `datetime, UTC`, `apply_trade, TradeRefused`, `PlaceIn, TradeIn`.) The `Holding` is created with `shares=0, cost_basis=0` and `apply_trade`'s BUY branch then sets `shares = shares_sent` and `cost_basis = price` (prior value 0), so the cost basis is exactly the fill price.

`backend/app/routers/plans.py` (declare it with the other `/{plan_id}` routes, below `/drift`):

```python
@router.post(
    "/{plan_id}/lines/{line_id}/placed",
    response_model=PlanLineOut,
    dependencies=[Depends(rate_limiter("plans_placed", limit=60))],
)
def place_plan_line(
    plan_id: int,
    line_id: int,
    payload: PlaceIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> PlanLineOut:
    return plans.place_line(db, user.id, plan_id, line_id, payload)
```

- [ ] **Step 4: Run** — `tests/test_plans_router.py tests/test_portfolio.py`, then the full suite, ruff, mypy. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: record that a plan line's order was placed, logging the buy"
```

---

### Task 6: Docs

**Files:** `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `PRODUCT.md`, the spec (only if a ruling changes it).

- [ ] **Step 1: ARCHITECTURE.md** — the data model (`isin` on holdings and watchlist items, set only by its own route and why; `placed_at` and `placed_trade_id` on plan lines, no foreign key); the API table (`PUT /portfolio/instruments/{ticker}/isin`, `POST /plans/{plan_id}/lines/{line_id}/placed`, the changed `GET /plans/{id}` and export lines); the shared `app/trades.py`; an "Order tickets" section: the ticket format, the currency rule (the plan's EUR price is never logged; the person types the fill price), what "Placed" does (creates the holding if new, BUY through the shared code, stamps the line), no undo and why, and the future Orders tab.
- [ ] **Step 2: RUNBOOK.md** — a short "Order tickets" section: nothing to configure; what "Placed" records; how to fix a mistaken one (a SELL in the trade log).
- [ ] **Step 3: PRODUCT.md** — order tickets built; the Orders tab is future work.
- [ ] **Step 4: Rulings** — if the spec text differs from the three rulings above (optional `asset_type`, ISIN resolved at read time, `apply_trade`), update the spec.
- [ ] **Step 5: Commit**

```bash
git add docs PRODUCT.md
git commit -m "docs: order tickets in the architecture notes, the runbook and the product record"
```

---

### Task 7: STOP — design the frontend (huashu-design + impeccable)

The backend (Tasks 1-6) is complete and can be pushed on its own. No frontend code is written until this task is finished and the user has picked a direction.

**Files:** create `docs/design/order-tickets/` (draft HTML and screenshots) and `direction-approved.md` there.

- [ ] **Step 1: Run the design skills** — invoke `huashu-design` (three real HTML directions with screenshots, reusing `docs/design/contribution-planner/` `base.css` and `shell.js` and the approved ledger of `c-ledger.html`, and the Portfolio strip of `docs/design/portfolio-nav/`) and `impeccable` (shape, critique, polish). Each direction covers, dark and light, desktop and phone (390px): (a) the **saved plan with tickets** (also shown right after Save plan on This month): each line's ticket text, Copy, "Add ISIN" when missing, a "Placed" button; Copy all lines; a placed line's status chip ("Placed 8 Oct · 1.69 sh at 54.60"); an all-placed plan; (b) the **Record placed order sheet** (drawer on desktop, bottom sheet on phone): ticker fixed, planned shares prefilled, price EMPTY with the hint "Price in the currency of this holding", date today, the extra asset-type choice for a new position, the 409/422 error states; (c) **Add ISIN** inline on the ticket (empty, typing, invalid check digit error, saved). Copy: "Order", "Placed", "Record placed order", never Buy or Sell labels; the "Advisory only. Nothing is sent to a broker." line stays. Ticket text per the spec: `Order (amount): 92.30 EUR · iShares Core MSCI EM IMI UCITS ETF USD (Acc) · ISIN IE00BKM4GZ66 · about 1.69 shares at 54.64 EUR`.
- [ ] **Step 2: Present and stop** — show the three directions and wait for the user's choice or mix. Do not start Task 8 until they answer.
- [ ] **Step 3: Record the decision** — write `direction-approved.md` and commit it with the design folder; then fill Part 2 below.

---

## Part 2 — Frontend (filled in after the design pick)

Each task follows the same rhythm (failing Vitest test, run, implement, run, `eslint` / `tsc` / full suite / build, commit) and uses the existing `useAction`, SWR, `apiFetch`, MUI components and design tokens (`frontend/lib/plans.ts`, `components/plan/PlanResult.tsx`, `components/plan/PlanHistory.tsx`, `components/portfolio/TradeSheet.tsx` are the patterns to follow).

### Task 8: Types, ticket text and API helpers

**Files:** `frontend/lib/plans.ts` (line fields: `id: number | null`, `isin: string | null`, `placed_at: string | null`, `placed_trade_id: number | null`), `frontend/lib/orders.ts` (+ test).

Behaviour to test: `ticketText(line, wholeShares)` returns exactly `Order (amount): 92.30 EUR · <name> · ISIN <isin> · about 1.69 shares at 54.64 EUR` (amounts to two decimals; shares to at most three decimals, trailing zeros trimmed); without an ISIN the ISIN part is omitted; whole-shares plans say `N shares` (singular `1 share`); a name containing the separator character is kept as is; `copyAllText(plan)` joins the tickets of lines with no `placed_at`, one per line, and returns "" when all are placed; `placeLine(planId, lineId, body)` POSTs `/plans/{planId}/lines/{lineId}/placed` with `{date, shares, price}` plus `asset_type` only when given; `setIsin(ticker, isin)` PUTs `/portfolio/instruments/{ticker}/isin` with `{isin}` (empty string sends `""`); errors surface the backend `detail` (409/422/429) like the other hooks.

### Task 9: Tickets on the saved plan

**Files:** `frontend/components/plan/PlanResult.tsx` (an optional tickets mode used only when `plan.id !== null`), a new `TicketRow` component, the plan page (after Save plan the saved plan is shown with tickets) and `PlanHistory` (an opened saved plan), tests beside them.

Behaviour to test (copy and layout from the chosen direction): each line of a saved plan shows its ticket text, a Copy button (copies that text, shows a short "Copied" confirmation, announced to screen readers) and, when `isin` is null, an "Add ISIN" control; "Copy all lines" copies the unplaced tickets and is disabled when none are left; a placed line shows its status chip and no Placed button; a preview (no `id`) shows NO tickets or Placed controls; clipboard failure shows a readable message (no throw); "Add ISIN" validates shape client-side, saves through `setIsin`, shows the server's 422 message for a wrong check digit, and refreshes the plan so the ticket text now includes the ISIN; ticket and ISIN are rendered as plain text; no Buy or Sell wording; layout holds at 390px.

### Task 10: The Record placed order sheet

**Files:** a new `frontend/components/plan/PlacedSheet.tsx` (a drawer on desktop, a bottom sheet on phone, like `TradeSheet`), the wiring in the saved plan view, tests.

Behaviour to test: "Placed" opens the sheet with the ticker fixed, shares prefilled from the line, the price EMPTY with the hint "Price in the currency of this holding", the date today; for a ticker that is not a holding (use the portfolio summary already loaded on the page) it also shows an asset-type choice, prefilled from the watchlist item when one exists and sent as `asset_type`; for an existing holding `asset_type` is not sent; submit is disabled for shares or price not above zero; on success the sheet closes, the line shows the placed chip and the portfolio data is revalidated (SWR mutate of `/portfolio/summary` and the plan); 409 (already placed / holding cap), 422 and 429 show their messages in the sheet and keep it open; the plan's EUR price is never put in the price field or the request; double-clicking submit sends one request; the sheet states that this only records the order and nothing is sent to a broker.

---

### Task 11: Final review, security review and the pull request

- [ ] **Step 1:** Run all checks: backend `uv run --system-certs ruff check . && uv run --system-certs ruff format --check . && uv run --system-certs mypy app && uv run --system-certs pytest -q`; the migration `upgrade`, `downgrade -1`, `upgrade` against the LOCAL database; frontend `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.
- [ ] **Step 2:** Dispatch the `security-reviewer` subagent on `git diff master...HEAD` with this brief: the placed route works only on the caller's own rows (scoped session, `user_id` filters, 404 for another person's line or a line of another plan), cannot place a line twice (409 under the per-person lock) and cannot exceed the 100-holding cap; the trade code is the single shared `apply_trade` and the trade route behaves as before; shares, price and date are validated and bad values cannot cause a 500 or a corrupted cost basis; the plan's EUR price is never written into the trade log; the ISIN route validates the shape and the check digit server side, only touches the caller's rows, and the ISIN can never be wiped by the holdings upsert; export and deletion cover the new columns; ISIN, tickets and amounts are never logged or sent to Telegram; ticket text, names and ISINs are rendered as plain text in the frontend; nothing can call a broker or place a trade; no secrets.
- [ ] **Step 3:** Fix every finding it confirms in one pass, re-run the checks, push the branch and open the pull request. In the description note that no new secrets or settings are needed and that "Placed" records only.
