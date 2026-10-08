# Monthly contribution planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person types a monthly amount (or uses their saved one) and gets a plan that splits it across the holdings and watchlist items that have a target weight, so the portfolio moves toward those targets; plus a saved history, a drift card on Today and a start-of-month Telegram reminder.

**Architecture:** A pure calculation module (`app/planner.py`, `Decimal` arithmetic, no I/O) fed by a small service that loads the person's rows inside their scoped session, prices and converts the targeted tickers to EUR at plan time (`app/fx.py`), and hands plain data to the planner. A new `/plans` router previews, saves, lists and deletes plans; saved plans live in two owner-only tables. The reminder is one extra line in the existing weekday Telegram message. Nothing here calls Claude or a broker.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic (hand-written migration), Redis, yfinance, `decimal`, pytest; Next.js 16, MUI 9, SWR, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-contribution-planner-design.md` (rulings that refine it are recorded in "Rulings" below and are folded into the spec by Task 8).

## Global Constraints

- The system never places a trade. A plan line is advice on a screen; every plan screen and response carries the line "Advisory only. Nothing is sent to a broker." No Buy/Sell/Deposit/Withdraw wording in plan UI copy, no broker call anywhere.
- No Claude call, no Claude cost, no key needed for any of this.
- Base currency EUR, fixed. Amounts are `Decimal` internally and rounded to whole cents; the lines of a plan add up to the contribution exactly (or to the contribution minus the stated leftover in whole-shares mode).
- Constants: `FAVOUR_FACTOR = 1.25`, `MIN_LINE_EUR = 25`, contribution `0 < amount <= 1,000,000`, drift threshold default 5 (range 1 to 50) points, shares shown to 3 decimals, a person keeps at most `MAX_PLANS = 120` saved plans.
- The server computes every plan itself; a saved plan is never built from client-supplied lines.
- Plan amounts, tickers and weights are never sent to Telegram and never logged; the reminder line carries no financial data.
- A failing, missing, non-finite, zero or negative price, currency or rate drops that ticker from the plan with a visible note; it never produces a NaN, infinite or negative amount.
- Hand-written migration only (a new file; existing migrations are never edited). Alembic head before this work: `c8e2f6a41d37`.
- Frontend copy: page title "Plan"; button "Make plan"; "Save plan"; switch "Whole shares only"; the disclaimer above; no emoji.
- Conventional Commits; never skip hooks or GPG signing; branch `feature/contribution-planner`.

## Rulings (refine the spec; Task 8 updates the spec text)

1. **The pool.** Weights and gaps are computed on the pool of targeted items only: `pool_before` = sum of the EUR values of items that have a target, `pool = pool_before + A`; `desired = normalised_target * pool`. A holding without a target is outside the pool: it neither receives money nor counts in any weight. (The spec said `V` covered all holdings; that would make the targets add up to more than the whole.)
2. **Rounding.** Largest-remainder rounding to cents (ties: larger amount, then ticker), instead of "the difference goes to the largest line".
3. **No second reminder marker.** The reminder is only added on the first weekday of the month, and the existing once-a-day marker already limits the day to one message, so a month's reminder cannot repeat. (The spec's `telegram:plan:{user}:{YYYY-MM}` marker is dropped.)
4. **Plan page address:** `/portfolio/plan` (the reminder link is `<APP_URL>/portfolio/plan`).
5. **Drift** looks at open holdings with a target only (watchlist items at 0 % would show as drifting forever); weights are within that pool.
6. **No ticker cap beyond the existing lists:** only targeted items are priced (never more than the 100 holdings + 100 watchlist items a person can have), 8 lookups at a time, and the preview is rate limited. (The spec said 50.)
7. **No foreign keys** from `contribution_plan_lines` to `contribution_plans` (like every other user table); the delete route and data deletion remove lines explicitly.

## Review Focus

Failure modes the spec implies that no happy path exercises (each pinned by a test in the task named in brackets):

1. **Targets that do not add up to 1, a holding without a target, a target of 0, nothing with a target:** normalised, ignored, ignored, and an explanatory note with the whole contribution left over; never a crash or a division by zero. [Task 3]
2. **Exact cents:** a contribution that does not divide evenly (100.00 over three equal targets, 0.01, 333.33) still adds up to the cent; a contribution below the minimum line becomes one line. [Task 3]
3. **Everyone excluded or ineligible:** every targeted ticker has a TRIM or SELL call, or none is priced: an empty plan with the reason, never money assigned to an excluded ticker. [Tasks 3, 5]
4. **Bad market data:** NaN, infinity, zero, negative or missing prices, a missing or unsupported currency, a failing rate lookup, pence quotes (`GBp`): the ticker is left out with a note. [Task 4]
5. **Whole shares where one share costs more than the line:** the line is dropped with a note and its money joins the leftover. [Task 3]
6. **Isolation:** one person's plan never uses another's holdings, targets or calls; `/plans/{id}` of someone else is a 404 and cannot be deleted. [Task 5]
7. **The reminder:** months that start on a Saturday or Sunday, a person with no targets, the switch off, a Telegram link that is blocked: the right (or no) message, and no amounts in the text. [Task 7]

---

## File Structure

- Create `backend/migrations/versions/d5f3a9b72e18_add_contribution_planner.py` — columns and tables.
- Modify `backend/app/models.py` (columns; `ContributionPlan`, `ContributionPlanLine`), `backend/app/rls.py` (`USER_TABLES`), `backend/app/schemas.py` (target and settings fields; plan schemas; export), `backend/app/routers/portfolio.py` (nothing new: the watchlist upsert already writes the schema fields), `backend/app/routers/preferences.py` (`_save`), `backend/app/routers/telegram.py` (nothing new: PATCH writes the schema fields), `backend/app/agents/market_data.py` (`fetch_currency`), `backend/app/notify.py` (reminder), `backend/app/routers/me.py` (export), `backend/app/main.py` (router), `backend/tests/auth_support.py` (`ROW_FACTORIES`).
- Create `backend/app/planner.py` — the pure calculation and the drift helper.
- Create `backend/app/fx.py` — trading currency and EUR conversion.
- Create `backend/app/plans.py` — loads rows, prices them, calls the planner, saves and reads plans.
- Create `backend/app/routers/plans.py` — the `/plans` routes.
- Tests: `backend/tests/test_planner.py`, `test_fx.py`, `test_plans_router.py`, `test_planner_drift.py` (new), `test_contribution_migration.py` (new), plus edits to `test_models.py`, `test_telegram_migration.py`, `test_me_router.py`, `test_preferences_router.py`, `test_portfolio.py`, `test_telegram_router.py`, `test_notify.py`, `test_routes_require_auth.py` (no change expected).
- Docs: `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `PRODUCT.md`, the spec file.
- Frontend (Part 2): `frontend/lib/plans.ts`, `frontend/lib/api/portfolio-types.ts`, `frontend/app/(shell)/portfolio/plan/page.tsx`, the Today page, the portfolio page and watchlist form, `frontend/components/account/TelegramPanel.tsx`, the Preferences page.

Hazards for every implementer: `WatchlistItem` has no `name` column; the ruff PostToolUse hook strips imports that are unused at the moment you add them (add an import together with its first use); each `asyncio.run` in a test is its own event loop and the cached Redis client is bound to one (reset `app.redis_client._redis = None` after each run); `POST /preferences` writes only the fields sent and a NOT NULL column must never be set to `None`; the local TLS issue with uv needs `--system-certs`, never a disabled certificate check.

---

## Part 1 — Backend

### Task 1: Migration, models, row-level security

**Files:**
- Create: `backend/migrations/versions/d5f3a9b72e18_add_contribution_planner.py`
- Modify: `backend/app/models.py`, `backend/app/rls.py:10-21`, `backend/tests/auth_support.py` (`ROW_FACTORIES`), `backend/tests/test_telegram_migration.py` (its head assertion), `backend/tests/test_me_router.py` (the export seeding exclusion set)
- Test: new `backend/tests/test_contribution_migration.py`, `backend/tests/test_models.py`

**Interfaces:**
- Produces: `WatchlistItem.target_weight: float | None`; `InvestmentPreferences.monthly_contribution: float | None`, `InvestmentPreferences.drift_threshold_pct: float` (default 5.0); `TelegramLink.plan_reminder_enabled: bool` (default True); models `ContributionPlan(id, user_id, created_at, amount_eur, whole_shares, total_before_eur, leftover_eur, notes JSON list[str])` and `ContributionPlanLine(id, user_id, plan_id, ticker, name, amount_eur, shares, price_eur, currency, rate, weight_before nullable, weight_after nullable, reason)`; `"contribution_plans"` and `"contribution_plan_lines"` in `rls.USER_TABLES`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_contribution_migration.py` (same pattern as `test_telegram_migration.py`):

```python
import importlib.util
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parent.parent


def _migration():
    path = next((BACKEND / "migrations" / "versions").glob("*_add_contribution_planner.py"))
    spec = importlib.util.spec_from_file_location("add_contribution_planner", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_is_the_single_head_on_top_of_the_telegram_revision():
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()

    migration = _migration()
    assert heads == [migration.revision]
    assert migration.down_revision == "c8e2f6a41d37"
```

In `backend/tests/test_telegram_migration.py` replace the `heads == [migration.revision]` assertion with `assert len(heads) == 1` (keep the `down_revision` assertion).

Append to `backend/tests/test_models.py` (file's owner-session fixture is `db_session`; add the model names to its imports):

```python
def test_planner_columns_and_tables_have_the_documented_defaults(db_session):
    uid = uuid.uuid4()
    pref = InvestmentPreferences(user_id=uid)
    link = TelegramLink(user_id=uid, chat_id=4242)
    item = WatchlistItem(user_id=uid, ticker="NVDA", asset_type="STOCK")
    plan = ContributionPlan(
        user_id=uid, amount_eur=500, whole_shares=False, total_before_eur=4000,
        leftover_eur=0, notes=["a note"],
    )
    db_session.add_all([pref, link, item, plan])
    db_session.commit()
    db_session.add(
        ContributionPlanLine(
            user_id=uid, plan_id=plan.id, ticker="NVDA", name="NVDA", amount_eur=264.71,
            shares=2.647, price_eur=100, currency="USD", rate=0.8, reason="new_position",
        )
    )
    db_session.commit()
    for row in (pref, link, item, plan):
        db_session.refresh(row)
    assert pref.monthly_contribution is None and float(pref.drift_threshold_pct) == 5.0
    assert link.plan_reminder_enabled is True
    assert item.target_weight is None
    assert plan.created_at is not None and plan.notes == ["a note"]
```

- [ ] **Step 2: Run to verify they fail**

Run (from `backend/`): `uv run --system-certs pytest tests/test_contribution_migration.py tests/test_models.py -q`
Expected: FAIL (`StopIteration`, `ImportError: ContributionPlan`).

- [ ] **Step 3: Write the migration**

Template for grants and policy: `backend/migrations/versions/c8e2f6a41d37_add_telegram_links.py`.

```python
"""add the contribution planner: targets on the watchlist, planner settings, plan tables

Revision ID: d5f3a9b72e18
Revises: c8e2f6a41d37
Create Date: 2026-10-08 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app import rls

# revision identifiers, used by Alembic.
revision: str = 'd5f3a9b72e18'
down_revision: Union[str, Sequence[str], None] = 'c8e2f6a41d37'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PLANS = "contribution_plans"
LINES = "contribution_plan_lines"


def upgrade() -> None:
    op.add_column(
        "watchlist_items",
        sa.Column("target_weight", sa.Numeric(5, 4), nullable=True),
    )
    op.create_check_constraint(
        "ck_watchlist_target_weight", "watchlist_items", "target_weight >= 0 AND target_weight <= 1"
    )
    op.add_column(
        "investment_preferences",
        sa.Column("monthly_contribution", sa.Numeric(12, 2), nullable=True),
    )
    op.add_column(
        "investment_preferences",
        sa.Column("drift_threshold_pct", sa.Numeric(4, 1), nullable=False, server_default="5.0"),
    )
    op.create_check_constraint(
        "ck_preferences_drift_threshold",
        "investment_preferences",
        "drift_threshold_pct >= 1 AND drift_threshold_pct <= 50",
    )
    op.add_column(
        "telegram_links",
        sa.Column("plan_reminder_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    op.create_table(
        PLANS,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("amount_eur", sa.Numeric(12, 2), nullable=False),
        sa.Column("whole_shares", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("total_before_eur", sa.Numeric(16, 2), nullable=False),
        sa.Column("leftover_eur", sa.Numeric(12, 2), nullable=False),
        sa.Column("notes", sa.JSON(), nullable=False),
    )
    op.create_index(op.f("ix_contribution_plans_user_id"), PLANS, ["user_id"])
    op.create_table(
        LINES,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("plan_id", sa.Integer(), nullable=False),
        sa.Column("ticker", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("amount_eur", sa.Numeric(12, 2), nullable=False),
        sa.Column("shares", sa.Numeric(18, 6), nullable=False),
        sa.Column("price_eur", sa.Numeric(18, 6), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("rate", sa.Numeric(18, 8), nullable=False),
        sa.Column("weight_before", sa.Numeric(7, 6), nullable=True),
        sa.Column("weight_after", sa.Numeric(7, 6), nullable=True),
        sa.Column("reason", sa.String(length=20), nullable=False),
    )
    op.create_index(op.f("ix_contribution_plan_lines_user_id"), LINES, ["user_id"])
    op.create_index(op.f("ix_contribution_plan_lines_plan_id"), LINES, ["plan_id"])
    # No foreign key (like every other user table): the delete route and data deletion remove the
    # lines explicitly.
    for table in (PLANS, LINES):
        for statement in rls.grant_table_sql(table):
            op.execute(statement)
        for statement in rls.policy_sql(table):
            op.execute(statement)


def downgrade() -> None:
    for table in (LINES, PLANS):
        op.execute(f"DROP POLICY IF EXISTS {table}_owner ON {table}")
    op.drop_table(LINES)
    op.drop_table(PLANS)
    op.drop_column("telegram_links", "plan_reminder_enabled")
    op.drop_constraint("ck_preferences_drift_threshold", "investment_preferences", type_="check")
    op.drop_column("investment_preferences", "drift_threshold_pct")
    op.drop_column("investment_preferences", "monthly_contribution")
    op.drop_constraint("ck_watchlist_target_weight", "watchlist_items", type_="check")
    op.drop_column("watchlist_items", "target_weight")
```

- [ ] **Step 4: Models, lists, factories**

`backend/app/models.py` (add `Numeric` imports as needed, each with its first use):

```python
# WatchlistItem: after `note`
    target_weight: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)

# InvestmentPreferences: after `auto_analysis`
    monthly_contribution: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    drift_threshold_pct: Mapped[float] = mapped_column(
        Numeric(4, 1), default=5.0, server_default="5.0"
    )

# TelegramLink: after `moves_enabled`
    plan_reminder_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=expression.true()
    )


class ContributionPlan(Base):
    """A saved contribution plan (advice on a screen, never an order)."""

    __tablename__ = "contribution_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    amount_eur: Mapped[float] = mapped_column(Numeric(12, 2))
    whole_shares: Mapped[bool] = mapped_column(Boolean, default=False, server_default=expression.false())
    total_before_eur: Mapped[float] = mapped_column(Numeric(16, 2))
    leftover_eur: Mapped[float] = mapped_column(Numeric(12, 2))
    notes: Mapped[list[str]] = mapped_column(JSON, default=list)


class ContributionPlanLine(Base):
    __tablename__ = "contribution_plan_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    plan_id: Mapped[int] = mapped_column(index=True)
    ticker: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    amount_eur: Mapped[float] = mapped_column(Numeric(12, 2))
    shares: Mapped[float] = mapped_column(Numeric(18, 6))
    price_eur: Mapped[float] = mapped_column(Numeric(18, 6))
    currency: Mapped[str] = mapped_column(String(8))
    rate: Mapped[float] = mapped_column(Numeric(18, 8))
    weight_before: Mapped[float | None] = mapped_column(Numeric(7, 6), nullable=True)
    weight_after: Mapped[float | None] = mapped_column(Numeric(7, 6), nullable=True)
    reason: Mapped[str] = mapped_column(String(20))
```

`backend/app/rls.py`: append `"contribution_plans", "contribution_plan_lines",` to `USER_TABLES`.

`backend/tests/auth_support.py` `ROW_FACTORIES` (the lines factory needs no plan row because there is no foreign key):

```python
    "contribution_plans": lambda uid: ContributionPlan(
        user_id=uid, amount_eur=500, whole_shares=False, total_before_eur=0, leftover_eur=0, notes=[]
    ),
    "contribution_plan_lines": lambda uid: ContributionPlanLine(
        user_id=uid, plan_id=1, ticker="AAPL", name="Apple", amount_eur=100, shares=1,
        price_eur=100, currency="EUR", rate=1, reason="underweight",
    ),
```

In `backend/tests/test_me_router.py` add both new table names to the exclusion set of the export seeding test (like `telegram_links`); Task 5 adds the explicit export assertions.

- [ ] **Step 5: Apply and run**

Run: `uv run --system-certs alembic upgrade head` (the LOCAL database only: confirm the host in `backend/.env` is localhost first), then `uv run --system-certs pytest tests/test_contribution_migration.py tests/test_models.py tests/test_telegram_migration.py tests/test_rls.py -q`, then the full suite, ruff and mypy.
Expected: PASS (`test_rls.py` runs its isolation tests over `USER_TABLES`).

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat: contribution planner tables, target weights on the watchlist and planner settings"
```

---

### Task 2: The new fields through the existing routes

**Files:**
- Modify: `backend/app/schemas.py` (`WatchlistItemIn`, `PreferencesIn`, `PreferencesOut`, `TelegramOut`, `TelegramSettingsIn`), `backend/app/routers/preferences.py` (`_save`), `backend/app/routers/telegram.py` (`_out`)
- Test: `backend/tests/test_portfolio.py`, `backend/tests/test_preferences_router.py`, `backend/tests/test_telegram_router.py`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `WatchlistItemIn.target_weight: float | None` (0 to 1, optional; inherited by `WatchlistItemOut`); `PreferencesIn/Out.monthly_contribution: float | None` (> 0, <= 1,000,000) and `PreferencesIn/Out.drift_threshold_pct: float` (1 to 50; in `PreferencesIn` optional, `None` = leave unchanged); `TelegramOut.plan_reminder_enabled: bool = True`; `TelegramSettingsIn.plan_reminder_enabled: bool | None`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_portfolio.py` (use its client fixture and helpers):

```python
def test_a_watchlist_item_can_carry_a_target_and_an_omitted_target_keeps_it(client):
    body = {"ticker": "NVDA", "asset_type": "STOCK", "target_weight": 0.2}
    assert client.post("/portfolio/watchlist", json=body).json()["target_weight"] == 0.2
    # the add-ticker form does not send it: it must not be wiped
    again = client.post("/portfolio/watchlist", json={"ticker": "NVDA", "asset_type": "STOCK", "note": "hi"})
    assert again.json()["target_weight"] == 0.2
    cleared = client.post("/portfolio/watchlist", json={**body, "target_weight": None})
    assert cleared.json()["target_weight"] is None


@pytest.mark.parametrize("value", [-0.1, 1.01])
def test_a_watchlist_target_must_be_between_0_and_1(client, value):
    body = {"ticker": "NVDA", "asset_type": "STOCK", "target_weight": value}
    assert client.post("/portfolio/watchlist", json=body).status_code == 422
```

`backend/tests/test_preferences_router.py`:

```python
def test_planner_settings_default_and_round_trip(client):
    body = client.get("/preferences").json()
    assert body["monthly_contribution"] is None and body["drift_threshold_pct"] == 5.0
    saved = client.post("/preferences", json={"monthly_contribution": 500, "drift_threshold_pct": 7.5}).json()
    assert (saved["monthly_contribution"], saved["drift_threshold_pct"]) == (500.0, 7.5)
    # a save that does not mention them leaves them alone
    other = client.post("/preferences", json={"risk_tolerance": "moderate"}).json()
    assert (other["monthly_contribution"], other["drift_threshold_pct"]) == (500.0, 7.5)
    # an explicit null clears the amount but cannot null the threshold
    cleared = client.post("/preferences", json={"monthly_contribution": None, "drift_threshold_pct": None}).json()
    assert cleared["monthly_contribution"] is None and cleared["drift_threshold_pct"] == 7.5


@pytest.mark.parametrize(
    "body",
    [{"monthly_contribution": 0}, {"monthly_contribution": -5}, {"monthly_contribution": 1_000_001},
     {"drift_threshold_pct": 0.5}, {"drift_threshold_pct": 51}],
)
def test_planner_settings_are_bounded(client, body):
    assert client.post("/preferences", json=body).status_code == 422
```

`backend/tests/test_telegram_router.py`:

```python
def test_the_plan_reminder_switch_defaults_on_and_can_be_turned_off(client, configured, db_session):
    _link(db_session)
    assert client.get("/me/telegram").json()["plan_reminder_enabled"] is True
    body = client.patch("/me/telegram", json={"plan_reminder_enabled": False}).json()
    assert body["plan_reminder_enabled"] is False and body["digest_enabled"] is True
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --system-certs pytest tests/test_portfolio.py tests/test_preferences_router.py tests/test_telegram_router.py -q`
Expected: FAIL (`KeyError: 'target_weight'` etc.).

- [ ] **Step 3: Implement**

`backend/app/schemas.py`:

```python
class WatchlistItemIn(BaseModel):
    ticker: Ticker
    asset_type: AssetType
    note: str | None = Field(default=None, max_length=500)  # matches WatchlistItem.note String(500)
    target_weight: float | None = Field(default=None, ge=0, le=1)
```

`PreferencesIn`: add

```python
    monthly_contribution: float | None = Field(default=None, gt=0, le=1_000_000)
    drift_threshold_pct: float | None = Field(default=None, ge=1, le=50)  # None: leave as it is
```

`PreferencesOut`: add `monthly_contribution: float | None = None` and `drift_threshold_pct: float = 5.0`. `TelegramOut`: `plan_reminder_enabled: bool = True`; `TelegramSettingsIn`: `plan_reminder_enabled: bool | None = None`.

`backend/app/routers/preferences.py` `_save`: `drift_threshold_pct` is a NOT NULL column, so pop it like `auto_analysis`:

```python
    values = payload.model_dump(exclude_unset=True)
    auto = values.pop("auto_analysis", None)  # an explicit null is ignored (the column is not null)
    drift = values.pop("drift_threshold_pct", None)  # same: the column is not null
    ...
    if auto is not None:
        pref.auto_analysis = auto
    if drift is not None:
        pref.drift_threshold_pct = drift
```

(`monthly_contribution` stays in `values`: an explicit null clears it, an omitted field leaves it. When creating a new row the `**values` spread works for it.) In `backend/app/routers/telegram.py` `_out`, pass `plan_reminder_enabled=link.plan_reminder_enabled` for a linked user; the unlinked default stays `True` through the schema.

The preferences `float(...)` conversions: the `PreferencesOut` model reads `Decimal` columns through `from_attributes`; pydantic converts them to `float` for these `float` fields.

- [ ] **Step 4: Run**

Run the three test files, then the full suite, ruff, mypy.
Expected: PASS (update the preferences export expectation in `test_me_router.py` if it lists preference keys).

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: watchlist targets, planner settings and the plan reminder switch through the existing routes"
```

---

### Task 3: The calculation (`app/planner.py`)

**Files:**
- Create: `backend/app/planner.py`
- Test: `backend/tests/test_planner.py`, `backend/tests/test_planner_drift.py`

**Interfaces:**
- Produces (all pure, no I/O):
  - `Candidate(ticker: str, name: str, held: bool, current_value: Decimal, target: Decimal | None, price_eur: Decimal, currency: str, rate: Decimal, call: str | None = None)` (frozen dataclass).
  - `PlanLine(ticker, name, amount_eur: Decimal, shares: Decimal, price_eur: Decimal, currency: str, rate: Decimal, weight_before: Decimal | None, weight_after: Decimal | None, reason: str)`; `reason` is one of `"new_position"`, `"favoured"`, `"underweight"`, `"remainder"`.
  - `Plan(lines: list[PlanLine], notes: list[str], total_before: Decimal, leftover: Decimal)`.
  - `build_plan(candidates: list[Candidate], amount: Decimal, *, whole_shares: bool = False) -> Plan`.
  - `DriftItem(ticker, name, weight: Decimal, target: Decimal, points: Decimal)` and `drift_items(candidates: list[Candidate], threshold_points: Decimal) -> list[DriftItem]`.
  - Constants `FAVOUR_FACTOR`, `MIN_LINE_EUR`, `EXCLUDING_CALLS`, `FAVOURING_CALLS`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_planner.py`:

```python
from decimal import Decimal as D

import pytest

from app.planner import Candidate, build_plan


def cand(ticker, value, target, *, price=100, held=None, call=None, currency="EUR", rate=1):
    return Candidate(
        ticker=ticker, name=ticker, held=(D(value) > 0 if held is None else held),
        current_value=D(value), target=None if target is None else D(str(target)),
        price_eur=D(price), currency=currency, rate=D(rate), call=call,
    )


def basic():
    # pool 4000 now, 4500 with the contribution: desired AAPL 1800, MSFT 1800, NVDA 900
    return [cand("AAPL", 1000, 0.4, price=200), cand("MSFT", 3000, 0.4, price=400), cand("NVDA", 0, 0.2, price=100)]


def amounts(plan):
    return {line.ticker: line.amount_eur for line in plan.lines}


def test_the_split_follows_the_gaps_and_adds_up_to_the_cent():
    plan = build_plan(basic(), D("500"))
    assert amounts(plan) == {"AAPL": D("235.29"), "NVDA": D("264.71")}
    assert plan.leftover == D("0.00") and plan.total_before == D("4000")
    by = {line.ticker: line for line in plan.lines}
    assert by["AAPL"].shares == D("1.176") and by["NVDA"].shares == D("2.647")
    assert by["AAPL"].reason == "underweight" and by["NVDA"].reason == "new_position"
    assert round(float(by["AAPL"].weight_before), 4) == 0.25
    assert round(float(by["AAPL"].weight_after), 4) == 0.2745
    assert by["NVDA"].weight_before == D("0")


def test_lines_are_sorted_by_amount_then_ticker():
    plan = build_plan(basic(), D("500"))
    assert [line.ticker for line in plan.lines] == ["NVDA", "AAPL"]


def test_an_add_call_favours_a_ticker():
    cands = basic()
    cands[0] = cand("AAPL", 1000, 0.4, price=200, call="ADD")  # gap 800 * 1.25 = 1000
    assert amounts(build_plan(cands, D("500"))) == {"AAPL": D("263.16"), "NVDA": D("236.84")}
    cands[0] = cand("AAPL", 1000, 0.4, price=200, call="BUY")
    assert amounts(build_plan(cands, D("500"))) == {"AAPL": D("263.16"), "NVDA": D("236.84")}
    assert {l.ticker: l.reason for l in build_plan(cands, D("500")).lines}["AAPL"] == "favoured"


@pytest.mark.parametrize("call", ["TRIM", "SELL"])
def test_a_trim_or_sell_call_gets_no_money_and_the_others_share_it(call):
    cands = basic()
    cands[0] = cand("AAPL", 1000, 0.4, price=200, call=call)
    plan = build_plan(cands, D("500"))
    assert amounts(plan) == {"NVDA": D("500.00")}
    assert any("AAPL" in n and call in n for n in plan.notes)


@pytest.mark.parametrize("call", ["HOLD", "WATCH", None])
def test_other_calls_change_nothing(call):
    cands = basic()
    cands[0] = cand("AAPL", 1000, 0.4, price=200, call=call)
    assert amounts(build_plan(cands, D("500"))) == {"AAPL": D("235.29"), "NVDA": D("264.71")}


def test_when_the_remaining_gaps_are_smaller_than_the_contribution_the_rest_goes_by_target_weight():
    cands = [cand("AAPL", 2000, 0.5, call="SELL"), cand("MSFT", 2000, 0.5)]
    # pool 4500, MSFT desired 2250 so its gap is 250; the other 250 follows the target weight
    assert amounts(build_plan(cands, D("500"))) == {"MSFT": D("500.00")}


def test_an_item_above_target_can_receive_only_the_remainder():
    cands = [cand("AAPL", 1000, 0.5, call="SELL"), cand("MSFT", 3000, 0.5)]
    plan = build_plan(cands, D("500"))
    assert amounts(plan) == {"MSFT": D("500.00")}
    assert plan.lines[0].reason == "remainder"


def test_targets_that_do_not_add_up_to_one_are_normalised():
    cands = [cand("AAA", 0, 0.3), cand("BBB", 0, 0.3)]
    assert amounts(build_plan(cands, D("1000"))) == {"AAA": D("500.00"), "BBB": D("500.00")}


def test_a_holding_without_a_target_is_outside_the_pool():
    cands = basic() + [cand("OLD", 5000, None)]
    plan = build_plan(cands, D("500"))
    assert amounts(plan) == {"AAPL": D("235.29"), "NVDA": D("264.71")}
    assert plan.total_before == D("4000")


def test_a_target_of_zero_counts_as_no_target():
    cands = basic() + [cand("ZERO", 0, 0)]
    assert "ZERO" not in amounts(build_plan(cands, D("500")))


def test_nothing_with_a_target_gives_an_empty_plan_and_the_whole_amount_left():
    plan = build_plan([cand("AAPL", 1000, None)], D("500"))
    assert plan.lines == [] and plan.leftover == D("500") and plan.notes


def test_every_targeted_ticker_excluded_gives_an_empty_plan():
    cands = [cand("AAPL", 1000, 0.5, call="SELL"), cand("MSFT", 1000, 0.5, call="TRIM")]
    plan = build_plan(cands, D("500"))
    assert plan.lines == [] and plan.leftover == D("500")


@pytest.mark.parametrize("amount", ["0", "-5"])
def test_a_contribution_of_zero_or_less_gives_an_empty_plan(amount):
    plan = build_plan(basic(), D(amount))
    assert plan.lines == [] and plan.notes


def test_an_amount_that_does_not_divide_evenly_still_adds_up_exactly():
    cands = [cand("A", 0, 1), cand("B", 0, 1), cand("C", 0, 1)]
    plan = build_plan(cands, D("100"))
    assert sorted(l.amount_eur for l in plan.lines) == [D("33.33"), D("33.33"), D("33.34")]
    assert sum(l.amount_eur for l in plan.lines) == D("100.00")


@pytest.mark.parametrize("amount", ["0.01", "333.33", "1234.56", "999999.99"])
def test_the_lines_always_add_up_to_the_contribution(amount):
    cands = [cand("A", 700, 0.5), cand("B", 100, 0.3), cand("C", 0, 0.2)]
    plan = build_plan(cands, D(amount))
    assert sum(l.amount_eur for l in plan.lines) == D(amount)
    assert all(l.amount_eur > 0 for l in plan.lines)


def test_lines_under_the_minimum_are_merged_into_the_largest():
    cands = [cand("X", 0, 0.5), cand("Y", 0, 0.4), cand("Z", 0, 0.1)]
    plan = build_plan(cands, D("60"))  # raw 30 / 24 / 6: only X reaches 25
    assert amounts(plan) == {"X": D("60.00")}


def test_when_every_line_is_under_the_minimum_the_largest_takes_it_all():
    cands = [cand("X", 0, 0.5), cand("Y", 0, 0.3), cand("Z", 0, 0.2)]
    assert amounts(build_plan(cands, D("20"))) == {"X": D("20.00")}


def test_whole_shares_round_down_and_report_the_leftover():
    plan = build_plan(basic(), D("500"), whole_shares=True)
    assert amounts(plan) == {"AAPL": D("200.00"), "NVDA": D("200.00")}
    assert {l.ticker: l.shares for l in plan.lines} == {"AAPL": D("1"), "NVDA": D("2")}
    assert plan.leftover == D("100.00")


def test_whole_shares_drop_a_line_that_cannot_buy_one_share():
    plan = build_plan([cand("BIG", 0, 1, price=150)], D("100"), whole_shares=True)
    assert plan.lines == [] and plan.leftover == D("100.00")
    assert any("BIG" in n for n in plan.notes)


def test_a_converted_price_is_used_for_the_shares():
    cands = [cand("US", 0, 1, price="80", currency="USD", rate="0.8")]
    line = build_plan(cands, D("160")).lines[0]
    assert (line.shares, line.currency, line.rate) == (D("2.000"), "USD", D("0.8"))
```

`backend/tests/test_planner_drift.py`:

```python
from decimal import Decimal as D

from app.planner import drift_items
from tests.test_planner import cand


def test_drift_lists_holdings_beyond_the_threshold_biggest_first():
    cands = [cand("AAPL", 1000, 0.4), cand("MSFT", 3000, 0.4)]  # weights 25 / 75 against 50 / 50
    items = drift_items(cands, D("5"))
    assert [(i.ticker, round(float(i.points), 1)) for i in items] == [("AAPL", -25.0), ("MSFT", 25.0)]


def test_drift_below_the_threshold_is_not_listed():
    cands = [cand("AAPL", 1000, 0.4), cand("MSFT", 3000, 0.4)]
    assert drift_items(cands, D("30")) == []


def test_watchlist_items_and_untargeted_holdings_are_ignored():
    cands = [cand("AAPL", 1000, 0.5), cand("MSFT", 1000, 0.5), cand("NVDA", 0, 0.5, held=False),
             cand("OLD", 9000, None)]
    assert drift_items(cands, D("1")) == []


def test_a_single_targeted_holding_never_drifts():
    assert drift_items([cand("AAPL", 1000, 0.3)], D("1")) == []


def test_the_boundary_counts():
    cands = [cand("AAPL", 55, 0.5), cand("MSFT", 45, 0.5)]  # exactly 5 points either way
    assert len(drift_items(cands, D("5"))) == 2
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --system-certs pytest tests/test_planner.py tests/test_planner_drift.py -q`
Expected: FAIL (`ModuleNotFoundError: app.planner`).

- [ ] **Step 3: Implement `backend/app/planner.py`**

```python
"""The monthly contribution plan: pure arithmetic, no I/O, no Claude, no broker.

Everything is in EUR and `Decimal`. Weights and gaps are computed on the pool of items that have a
target (an item without a target is outside the pool). See the design spec for the rules.
"""

from dataclasses import dataclass
from decimal import ROUND_FLOOR, ROUND_HALF_EVEN, Decimal

ZERO = Decimal(0)
CENT = Decimal("0.01")
SHARE_PLACES = Decimal("0.001")
FAVOUR_FACTOR = Decimal("1.25")
MIN_LINE_EUR = Decimal("25")
EXCLUDING_CALLS = frozenset({"TRIM", "SELL"})
FAVOURING_CALLS = frozenset({"ADD", "BUY"})


@dataclass(frozen=True)
class Candidate:
    ticker: str
    name: str
    held: bool  # open position (shares > 0); a watchlist item or a closed position is not held
    current_value: Decimal  # EUR, 0 when not held
    target: Decimal | None
    price_eur: Decimal
    currency: str
    rate: Decimal  # EUR per 1 unit of the quote currency (1 for EUR)
    call: str | None = None  # action of the newest PENDING recommendation, if any


@dataclass(frozen=True)
class PlanLine:
    ticker: str
    name: str
    amount_eur: Decimal
    shares: Decimal
    price_eur: Decimal
    currency: str
    rate: Decimal
    weight_before: Decimal | None
    weight_after: Decimal | None
    reason: str  # "new_position" | "favoured" | "underweight" | "remainder"


@dataclass(frozen=True)
class Plan:
    lines: list[PlanLine]
    notes: list[str]
    total_before: Decimal  # EUR value of the pool before the contribution
    leftover: Decimal  # part of the contribution no line uses


@dataclass(frozen=True)
class DriftItem:
    ticker: str
    name: str
    weight: Decimal
    target: Decimal
    points: Decimal  # weight minus target, in percentage points


def _targeted(candidates: list[Candidate]) -> list[Candidate]:
    return [c for c in candidates if c.target is not None and c.target > ZERO]


def _round_to_total(raw: dict[str, Decimal], total: Decimal) -> dict[str, Decimal]:
    """Whole cents that add up to `total`: floor each, then hand the missing cents to the largest
    fractions (ties: larger amount, then ticker)."""
    floors = {k: int((v * 100).to_integral_value(rounding=ROUND_FLOOR)) for k, v in raw.items()}
    missing = int((total * 100).to_integral_value()) - sum(floors.values())
    order = sorted(raw, key=lambda k: (raw[k] * 100 - floors[k], raw[k], k), reverse=True)
    for ticker in order[: max(missing, 0)]:
        floors[ticker] += 1
    return {k: Decimal(c) / 100 for k, c in floors.items()}


def _merge_small(raw: dict[str, Decimal]) -> dict[str, Decimal]:
    """Lines under MIN_LINE_EUR join the largest line, so nobody is told to buy 3 EUR of a stock."""
    big = {k: v for k, v in raw.items() if v >= MIN_LINE_EUR}
    small = sum((v for k, v in raw.items() if k not in big), ZERO)
    if small == ZERO:
        return raw
    pool = big or raw
    top = max(pool, key=lambda k: (pool[k], k))
    if not big:
        return {top: sum(raw.values(), ZERO)}
    big[top] += small
    return big


def build_plan(candidates: list[Candidate], amount: Decimal, *, whole_shares: bool = False) -> Plan:
    targeted = _targeted(candidates)
    pool_before = sum((c.current_value for c in targeted), ZERO)
    if amount <= ZERO:
        return Plan([], ["The contribution must be more than zero."], pool_before, ZERO)
    if not targeted:
        return Plan(
            [], ["No holding or watchlist item has a target weight yet."], pool_before, amount
        )

    notes: list[str] = []
    total_target = sum((c.target for c in targeted if c.target is not None), ZERO)
    weight = {c.ticker: (c.target or ZERO) / total_target for c in targeted}
    pool = pool_before + amount

    eligible = []
    for c in sorted(targeted, key=lambda c: c.ticker):
        if c.call in EXCLUDING_CALLS:
            notes.append(f"{c.ticker} gets no money: its newest pending call is {c.call}.")
        else:
            eligible.append(c)
    if not eligible:
        notes.append("Every ticker with a target has a TRIM or SELL call, so nothing is proposed.")
        return Plan([], notes, pool_before, amount)

    gap: dict[str, Decimal] = {}
    for c in eligible:
        g = max(weight[c.ticker] * pool - c.current_value, ZERO)
        gap[c.ticker] = g * FAVOUR_FACTOR if c.call in FAVOURING_CALLS else g
    gap_sum = sum(gap.values(), ZERO)
    if gap_sum >= amount:
        raw = {t: amount * g / gap_sum for t, g in gap.items() if g > ZERO}
    else:  # fill every gap, then share the rest by target weight
        weight_sum = sum((weight[c.ticker] for c in eligible), ZERO)
        rest = amount - gap_sum
        raw = {c.ticker: gap[c.ticker] + rest * weight[c.ticker] / weight_sum for c in eligible}

    cents = _round_to_total(_merge_small(raw), amount)
    by_ticker = {c.ticker: c for c in eligible}
    drafts: list[tuple[Candidate, Decimal, Decimal]] = []
    for ticker, cash in sorted(cents.items(), key=lambda kv: (-kv[1], kv[0])):
        c = by_ticker[ticker]
        if whole_shares:
            shares = (cash / c.price_eur).to_integral_value(rounding=ROUND_FLOOR)
            if shares <= ZERO:
                notes.append(f"{ticker}: {cash} EUR is less than one share ({c.price_eur:.2f} EUR).")
                continue
            cash = (shares * c.price_eur).quantize(CENT, ROUND_HALF_EVEN)
        else:
            shares = (cash / c.price_eur).quantize(SHARE_PLACES, ROUND_HALF_EVEN)
        drafts.append((c, cash, shares))

    spent = sum((cash for _, cash, _ in drafts), ZERO)
    total_after = pool_before + spent
    lines = []
    for c, cash, shares in drafts:
        if gap[c.ticker] == ZERO:
            reason = "remainder"
        elif not c.held:
            reason = "new_position"
        elif c.call in FAVOURING_CALLS:
            reason = "favoured"
        else:
            reason = "underweight"
        lines.append(
            PlanLine(
                ticker=c.ticker, name=c.name, amount_eur=cash, shares=shares,
                price_eur=c.price_eur, currency=c.currency, rate=c.rate,
                weight_before=c.current_value / pool_before if pool_before > ZERO else None,
                weight_after=(c.current_value + cash) / total_after if total_after > ZERO else None,
                reason=reason,
            )
        )
    return Plan(lines, notes, pool_before, amount - spent)


def drift_items(candidates: list[Candidate], threshold_points: Decimal) -> list[DriftItem]:
    """Open holdings with a target whose weight is at least `threshold_points` away from it (both
    weights taken within the pool of such holdings)."""
    held = [c for c in _targeted(candidates) if c.held and c.current_value > ZERO]
    pool = sum((c.current_value for c in held), ZERO)
    if pool <= ZERO:
        return []
    total_target = sum((c.target for c in held if c.target is not None), ZERO)
    items = []
    for c in held:
        weight_now = c.current_value / pool
        weight_target = (c.target or ZERO) / total_target
        points = (weight_now - weight_target) * 100
        if abs(points) >= threshold_points:
            items.append(DriftItem(c.ticker, c.name, weight_now, weight_target, points))
    return sorted(items, key=lambda i: (-abs(i.points), i.ticker))
```

- [ ] **Step 4: Run**

Run: `uv run --system-certs pytest tests/test_planner.py tests/test_planner_drift.py -q`, then the full suite, ruff and mypy (`Decimal` typing must pass `mypy --strict`).
Expected: PASS. If an exact-cent assertion differs, re-derive it by hand from the formulas in the spec before changing the code; the examples in this task were worked out by hand (AAPL 500 * 800 / 1700 = 235.294..., NVDA 264.705...).

- [ ] **Step 5: Commit**

```bash
git add backend/app/planner.py backend/tests/test_planner.py backend/tests/test_planner_drift.py
git commit -m "feat: contribution plan calculation and the drift helper"
```

---

### Task 4: Trading currency and EUR prices (`app/fx.py`)

**Files:**
- Create: `backend/app/fx.py`
- Modify: `backend/app/agents/market_data.py` (add `fetch_currency`)
- Test: `backend/tests/test_fx.py`, `backend/tests/test_agents_market_data.py`

**Interfaces:**
- Consumes: `market_data.fetch_quote_and_history(ticker) -> {"price", "closes"}`.
- Produces:
  - `market_data.fetch_currency(ticker: str) -> str | None` (yfinance `fast_info["currency"]`, cached 24 h in Redis under `currency:{ticker}`; failures raise like the other fetchers).
  - `fx.EurPrice(price_eur: Decimal, currency: str, rate: Decimal)` (frozen dataclass; `rate` = EUR per 1 unit of the quote currency; for `GBp` the pence factor is folded in, so `rate` is EUR per 1 penny).
  - `async fx.eur_prices(tickers: set[str]) -> tuple[dict[str, EurPrice], dict[str, str]]`: priced tickers, and for every other ticker a short reason text (for example `"AAPL: no price available"`). 8 lookups at a time; one rate lookup per currency per call.
  - `fx.SUPPORTED`: `EUR` plus `USD, GBP, GBp, CHF, JPY, CAD, AUD, SEK, NOK, DKK, PLN`; the rate symbol for a currency is built from this fixed table only, never from user text.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_fx.py`:

```python
import asyncio
from decimal import Decimal as D
from unittest.mock import AsyncMock, patch

import pytest

import app.redis_client as redis_client_module
from app import fx


def run(coro):
    try:
        return asyncio.run(coro)
    finally:
        redis_client_module._redis = None


def run_prices(tickers, quotes, currencies, rates=None):
    """quotes: ticker -> price; currencies: ticker -> currency; rates: symbol -> price."""
    rates = rates or {}

    async def quote(symbol):
        if symbol in rates:
            value = rates[symbol]
            if isinstance(value, Exception):
                raise value
            return {"price": value, "closes": [value]}
        if symbol not in quotes:
            raise RuntimeError("no quote")
        return {"price": quotes[symbol], "closes": [quotes[symbol]]}

    async def currency(ticker):
        return currencies.get(ticker)

    with patch("app.fx.fetch_quote_and_history", AsyncMock(side_effect=quote)) as q, patch(
        "app.fx.fetch_currency", AsyncMock(side_effect=currency)
    ):
        return run(fx.eur_prices(set(tickers))), q


def test_a_euro_ticker_passes_through():
    (prices, skipped), _ = run_prices(["SAP.DE"], {"SAP.DE": 120.0}, {"SAP.DE": "EUR"})
    assert prices["SAP.DE"] == fx.EurPrice(D("120.0"), "EUR", D("1"))
    assert skipped == {}


def test_a_dollar_ticker_is_converted_with_the_eurusd_rate():
    (prices, _), _ = run_prices(["AAPL"], {"AAPL": 100.0}, {"AAPL": "USD"}, {"EURUSD=X": 1.25})
    assert prices["AAPL"].price_eur == D("80")
    assert prices["AAPL"].currency == "USD" and prices["AAPL"].rate == D("0.8")


def test_pence_quotes_are_converted_through_pounds():
    (prices, _), _ = run_prices(["VOD.L"], {"VOD.L": 5000.0}, {"VOD.L": "GBp"}, {"EURGBP=X": 0.8})
    assert prices["VOD.L"].price_eur == D("62.5")  # 5000p = 50 GBP = 62.5 EUR


def test_one_rate_lookup_per_currency():
    (prices, _), quotes = run_prices(
        ["A", "B"], {"A": 10.0, "B": 20.0}, {"A": "USD", "B": "USD"}, {"EURUSD=X": 1.0}
    )
    assert len(prices) == 2
    assert [c.args[0] for c in quotes.await_args_list].count("EURUSD=X") == 1


@pytest.mark.parametrize("price", [None, float("nan"), float("inf"), 0.0, -3.0])
def test_a_bad_price_leaves_the_ticker_out_with_a_note(price):
    (prices, skipped), _ = run_prices(["AAPL"], {"AAPL": price}, {"AAPL": "EUR"})
    assert prices == {} and "AAPL" in skipped["AAPL"]


def test_a_failing_quote_leaves_the_ticker_out():
    (prices, skipped), _ = run_prices(["AAPL"], {}, {"AAPL": "EUR"})
    assert prices == {} and "AAPL" in skipped["AAPL"]


def test_a_missing_currency_leaves_the_ticker_out():
    (prices, skipped), _ = run_prices(["AAPL"], {"AAPL": 10.0}, {})
    assert prices == {} and "currency" in skipped["AAPL"]


def test_an_unsupported_currency_leaves_the_ticker_out():
    (prices, skipped), _ = run_prices(["AAPL"], {"AAPL": 10.0}, {"AAPL": "XYZ"})
    assert prices == {} and "XYZ" in skipped["AAPL"]


@pytest.mark.parametrize("rate", [None, float("nan"), 0.0, -1.0, RuntimeError("down")])
def test_a_bad_rate_leaves_the_ticker_out(rate):
    (prices, skipped), _ = run_prices(["AAPL"], {"AAPL": 10.0}, {"AAPL": "USD"}, {"EURUSD=X": rate})
    assert prices == {} and "AAPL" in skipped["AAPL"]


def test_no_amount_can_be_non_finite():
    (prices, _), _ = run_prices(["AAPL"], {"AAPL": 1e308}, {"AAPL": "USD"}, {"EURUSD=X": 1e-300})
    assert all(p.price_eur.is_finite() for p in prices.values())
```

Add to `backend/tests/test_agents_market_data.py` (follow that file's style for patching `yf.Ticker` and Redis): `fetch_currency` returns the currency string from `fast_info`, caches it (a second call does not touch yfinance), and returns `None` when the field is missing.

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --system-certs pytest tests/test_fx.py tests/test_agents_market_data.py -q`
Expected: FAIL (`ModuleNotFoundError: app.fx`, `ImportError: fetch_currency`).

- [ ] **Step 3: Implement**

`backend/app/agents/market_data.py` (follow `fetch_quote_and_history`'s cache and retry idiom):

```python
CURRENCY_CACHE_TTL = 86400


async def fetch_currency(ticker: str) -> str | None:
    """The currency a ticker is quoted in (for example "EUR", "USD", "GBp"), or None if unknown."""
    redis = get_redis()
    cache_key = f"currency:{ticker}"
    cached = await redis.get(cache_key)
    if cached:
        return str(cached)

    def _fetch() -> str | None:
        value = yf.Ticker(ticker).fast_info["currency"]
        return str(value) if value else None

    currency = await _retry_fetch(_fetch)
    if currency:
        await redis.set(cache_key, currency, ex=CURRENCY_CACHE_TTL)
    return currency
```

`backend/app/fx.py`:

```python
"""Trading currency and EUR conversion for the contribution plan.

Nothing is stored: the quote source tells each ticker's currency and a cached rate converts it. The
rate symbol comes from a fixed table, never from user text. A ticker that cannot be priced in EUR is
left out with a short reason; a plan never gets a NaN, infinite or negative amount from here.
"""

import asyncio
import logging
import math
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from app.agents.market_data import fetch_currency, fetch_quote_and_history

logger = logging.getLogger(__name__)

# currency -> the Yahoo symbol that gives units of that currency per 1 EUR
RATE_SYMBOLS = {
    "USD": "EURUSD=X", "GBP": "EURGBP=X", "CHF": "EURCHF=X", "JPY": "EURJPY=X",
    "CAD": "EURCAD=X", "AUD": "EURAUD=X", "SEK": "EURSEK=X", "NOK": "EURNOK=X",
    "DKK": "EURDKK=X", "PLN": "EURPLN=X",
}
SUBUNITS = {"GBp": ("GBP", Decimal("0.01"))}  # pence: 1/100 of a pound
SUPPORTED = frozenset({"EUR", *RATE_SYMBOLS, *SUBUNITS})
LOOKUP_CONCURRENCY = 8


@dataclass(frozen=True)
class EurPrice:
    price_eur: Decimal
    currency: str  # the currency the ticker is quoted in
    rate: Decimal  # EUR per 1 unit of that currency (per 1 penny for GBp)


def _positive(value: object) -> Decimal | None:
    """A finite number above zero as a Decimal, else None."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() and number > 0 else None


async def _rate(currency: str) -> Decimal | None:
    """EUR per 1 unit of `currency` (per 1 penny for GBp); None when it cannot be found."""
    if currency == "EUR":
        return Decimal(1)
    base, factor = SUBUNITS.get(currency, (currency, Decimal(1)))
    symbol = RATE_SYMBOLS.get(base)
    if symbol is None:
        return None
    try:
        data = await fetch_quote_and_history(symbol)
    except Exception as exc:
        logger.warning("Rate lookup failed for %s (%s)", base, type(exc).__name__)
        return None
    per_eur = _positive(data.get("price"))
    return factor / per_eur if per_eur is not None else None


async def eur_prices(tickers: set[str]) -> tuple[dict[str, EurPrice], dict[str, str]]:
    ordered = sorted(tickers)
    sem = asyncio.Semaphore(LOOKUP_CONCURRENCY)

    async def one(ticker: str) -> tuple[str, Decimal | None, str | None, str | None]:
        try:
            async with sem:
                data = await fetch_quote_and_history(ticker)
                currency = await fetch_currency(ticker)
        except Exception as exc:
            logger.warning("Price lookup failed for %s (%s)", ticker, type(exc).__name__)
            return ticker, None, None, f"{ticker} is left out: no price available."
        price = _positive(data.get("price"))
        if price is None:
            return ticker, None, None, f"{ticker} is left out: no price available."
        if not currency:
            return ticker, None, None, f"{ticker} is left out: its currency is unknown."
        if currency not in SUPPORTED:
            return ticker, None, None, f"{ticker} is left out: currency {currency} is not supported."
        return ticker, price, currency, None

    found = await asyncio.gather(*(one(t) for t in ordered))
    currencies = {c for _, _, c, _ in found if c is not None}
    rates = dict(zip(sorted(currencies), await asyncio.gather(*(_rate(c) for c in sorted(currencies))), strict=True))

    prices: dict[str, EurPrice] = {}
    skipped: dict[str, str] = {}
    for ticker, price, currency, reason in found:
        if reason is not None or price is None or currency is None:
            skipped[ticker] = reason or f"{ticker} is left out: no price available."
            continue
        rate = rates[currency]
        if rate is None:
            skipped[ticker] = f"{ticker} is left out: no exchange rate for {currency}."
            continue
        price_eur = price * rate
        if not price_eur.is_finite() or price_eur <= 0:
            skipped[ticker] = f"{ticker} is left out: its price could not be converted."
            continue
        prices[ticker] = EurPrice(price_eur, currency, rate)
    return prices, skipped
```

Note on the expected values: `EURUSD=X` is USD per 1 EUR, so the rate for a dollar ticker is `1 / 1.25 = 0.8` EUR per USD and `100 USD = 80 EUR`; for pence it is `0.01 / 0.8 = 0.0125` EUR per penny, and `5000 p = 62.5 EUR`. `Decimal(str(1.25))` keeps the arithmetic exact for the test values.

- [ ] **Step 4: Run**

Run: `uv run --system-certs pytest tests/test_fx.py tests/test_agents_market_data.py -q`, then the full suite, ruff and mypy.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat: trading currency lookup and EUR conversion for the contribution plan"
```

---

### Task 5: The plan service and the `/plans` routes (preview, save, list, read, delete) and the export

**Files:**
- Create: `backend/app/plans.py`, `backend/app/routers/plans.py`
- Modify: `backend/app/schemas.py` (plan schemas, `ExportOut`), `backend/app/routers/me.py` (export), `backend/app/main.py`
- Test: `backend/tests/test_plans_router.py`, `backend/tests/test_me_router.py`

**Interfaces:**
- Consumes: Task 1 models, Task 3 `build_plan`/`Candidate`, Task 4 `fx.eur_prices`.
- Produces:
  - Schemas: `PlanIn(amount: float (gt 0, le 1_000_000), whole_shares: bool = False)`; `PlanLineOut(ticker, name, amount_eur: float, shares: float, price_eur: float, currency: str, rate: float, weight_before: float | None, weight_after: float | None, reason: str, reason_text: str)`; `PlanOut(id: int | None, created_at: datetime | None, amount_eur: float, whole_shares: bool, total_before_eur: float, leftover_eur: float, lines: list[PlanLineOut], notes: list[str], disclaimer: str)`; `PlanSummaryOut(id, created_at, amount_eur, line_count: int)`.
  - `plans.compute(db, user_id, payload) -> PlanOut` (async; builds the plan and never saves); `plans.save(db, user_id, plan: PlanOut) -> PlanOut` (sync; one transaction; raises `HTTPException 409` past `MAX_PLANS`); `plans.load(db, user_id, plan_id) -> PlanOut | None`; `plans.list_summaries(db, user_id)`; `plans.delete(db, user_id, plan_id) -> bool`.
  - Routes (all under `/plans`, router-level `get_current_user` and `no_store`): `POST /plans/preview`, `POST /plans` (201), `GET /plans`, `GET /plans/{plan_id}`, `DELETE /plans/{plan_id}` (204). `/plans/drift` is added in Task 6 and must be declared BEFORE `/{plan_id}`.
  - `ExportOut.contribution_plans: list[PlanOut]`.
  - Constants: `DISCLAIMER = "Advisory only. Nothing is sent to a broker."`, `MAX_PLANS = 120`, `MAX_AMOUNT = 1_000_000`; reason texts: `new_position` "A new position that starts at 0 %", `underweight` "Below its target weight", `favoured` "Below its target, and its newest call is ADD or BUY", `remainder` "Extra money shared by target weight".

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_plans_router.py` (fixtures: `client`, `anon_client`, `db_session` owner session; `fx.eur_prices` patched at `app.plans.eur_prices`; seed holdings/watchlist/recommendations with the same helpers the other router tests use):

```python
from decimal import Decimal as D
from unittest.mock import AsyncMock, patch

import pytest

from app.fx import EurPrice
from app.models import ContributionPlan, ContributionPlanLine, Holding, Recommendation, WatchlistItem
from tests.auth_support import OTHER_USER_ID, USER_ID


def _holding(db, ticker, shares, target, user_id=USER_ID):
    db.add(Holding(user_id=user_id, ticker=ticker, name=ticker, asset_type="STOCK", shares=shares,
                   cost_basis=10, first_purchase_date=date(2024, 1, 1), target_weight=target))
    db.commit()


def _watch(db, ticker, target, user_id=USER_ID):
    db.add(WatchlistItem(user_id=user_id, ticker=ticker, asset_type="STOCK", target_weight=target))
    db.commit()


def _prices(**eur):
    async def fake(tickers):
        got = {t: EurPrice(D(str(eur[t])), "EUR", D(1)) for t in tickers if t in eur}
        return got, {t: f"{t} is left out: no price available." for t in tickers if t not in eur}
    return patch("app.plans.eur_prices", AsyncMock(side_effect=fake))


def _seed_basic(db):
    _holding(db, "AAPL", 5, 0.4)      # 5 x 200 = 1000
    _holding(db, "MSFT", 7.5, 0.4)    # 7.5 x 400 = 3000
    _watch(db, "NVDA", 0.2)           # not held


def test_preview_computes_and_saves_nothing(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert body["id"] is None and body["amount_eur"] == 500
    assert {l["ticker"]: l["amount_eur"] for l in body["lines"]} == {"AAPL": 235.29, "NVDA": 264.71}
    assert body["leftover_eur"] == 0 and body["total_before_eur"] == 4000
    assert body["disclaimer"] == "Advisory only. Nothing is sent to a broker."
    assert db_session.query(ContributionPlan).count() == 0


def test_save_stores_the_plan_computed_on_the_server(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        saved = client.post("/plans", json={"amount": 500, "lines": [{"ticker": "HACK", "amount_eur": 500}]})
    assert saved.status_code == 201
    body = saved.json()
    assert body["id"] is not None and {l["ticker"] for l in body["lines"]} == {"AAPL", "NVDA"}
    assert db_session.query(ContributionPlanLine).filter_by(plan_id=body["id"]).count() == 2
    again = client.get(f"/plans/{body['id']}").json()
    assert again["lines"] == body["lines"] and again["created_at"] is not None


def test_a_pending_trim_or_sell_call_excludes_a_ticker(client, db_session):
    _seed_basic(db_session)
    db_session.add(Recommendation(user_id=USER_ID, ticker="AAPL", asset_type="STOCK", action="SELL",
                                  reasoning=["x"], status="PENDING"))
    db_session.commit()
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert [l["ticker"] for l in body["lines"]] == ["NVDA"]
    assert any("AAPL" in n for n in body["notes"])


def test_an_approved_or_old_decided_call_does_not_exclude(client, db_session):
    _seed_basic(db_session)
    db_session.add(Recommendation(user_id=USER_ID, ticker="AAPL", asset_type="STOCK", action="SELL",
                                  reasoning=["x"], status="APPROVED"))
    db_session.commit()
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert {l["ticker"] for l in body["lines"]} == {"AAPL", "NVDA"}


def test_an_unpriced_ticker_is_left_out_with_a_note(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400):  # NVDA has no price
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert [l["ticker"] for l in body["lines"]] == ["AAPL"]
    assert any("NVDA" in n for n in body["notes"])


def test_holdings_without_a_target_are_not_priced_and_are_noted(client, db_session):
    _seed_basic(db_session)
    _holding(db_session, "OLD", 3, None)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert "OLD" not in {l["ticker"] for l in body["lines"]}
    assert any("target" in n for n in body["notes"])


def test_nothing_with_a_target_gives_an_empty_plan(client, db_session):
    _holding(db_session, "AAPL", 5, None)
    with _prices(AAPL=200):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert body["lines"] == [] and body["leftover_eur"] == 500 and body["notes"]


@pytest.mark.parametrize("amount", [0, -1, 1_000_001, "abc", None])
def test_the_amount_is_validated(client, amount):
    assert client.post("/plans/preview", json={"amount": amount}).status_code == 422


def test_whole_shares_mode_reports_the_leftover(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500, "whole_shares": True}).json()
    assert body["leftover_eur"] == 100 and all(l["shares"] == int(l["shares"]) for l in body["lines"])


def test_a_user_never_sees_or_uses_another_users_data(client, db_session):
    _seed_basic(db_session)
    _holding(db_session, "TSLA", 100, 0.9, user_id=OTHER_USER_ID)
    with _prices(AAPL=200, MSFT=400, NVDA=100, TSLA=50):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert "TSLA" not in {l["ticker"] for l in body["lines"]}
    other = ContributionPlan(user_id=OTHER_USER_ID, amount_eur=100, whole_shares=False,
                             total_before_eur=0, leftover_eur=0, notes=[])
    db_session.add(other)
    db_session.commit()
    assert client.get(f"/plans/{other.id}").status_code == 404
    assert client.delete(f"/plans/{other.id}").status_code == 404
    assert db_session.query(ContributionPlan).filter_by(id=other.id).count() == 1
    assert client.get("/plans").json() == []


def test_list_is_newest_first_and_delete_removes_the_lines(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        first = client.post("/plans", json={"amount": 500}).json()
        second = client.post("/plans", json={"amount": 600}).json()
    listed = client.get("/plans").json()
    assert [p["id"] for p in listed] == [second["id"], first["id"]]
    assert listed[0]["line_count"] == 2 and listed[0]["amount_eur"] == 600
    assert client.delete(f"/plans/{first['id']}").status_code == 204
    assert db_session.query(ContributionPlanLine).filter_by(plan_id=first["id"]).count() == 0
    assert client.get(f"/plans/{first['id']}").status_code == 404


def test_a_person_can_keep_at_most_120_plans(client, db_session):
    for _ in range(120):
        db_session.add(ContributionPlan(user_id=USER_ID, amount_eur=1, whole_shares=False,
                                        total_before_eur=0, leftover_eur=0, notes=[]))
    db_session.commit()
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        assert client.post("/plans", json={"amount": 500}).status_code == 409


def test_the_preview_is_rate_limited(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        statuses = [client.post("/plans/preview", json={"amount": 500}).status_code for _ in range(11)]
    assert statuses[:10] == [200] * 10 and statuses[10] == 429


def test_plans_require_authentication(anon_client):
    assert anon_client.post("/plans/preview", json={"amount": 5}).status_code == 401
    assert anon_client.get("/plans").status_code == 401
```

Export tests in `backend/tests/test_me_router.py`:

```python
def test_the_export_lists_saved_plans_with_their_lines(client, db_session):
    plan = ContributionPlan(user_id=USER_ID, amount_eur=500, whole_shares=False, total_before_eur=4000,
                            leftover_eur=0, notes=["n"])
    db_session.add(plan)
    db_session.commit()
    db_session.add(ContributionPlanLine(user_id=USER_ID, plan_id=plan.id, ticker="AAPL", name="Apple",
                                        amount_eur=500, shares=2, price_eur=250, currency="EUR", rate=1,
                                        reason="underweight"))
    db_session.commit()
    body = client.get("/me/export").json()
    assert [p["amount_eur"] for p in body["contribution_plans"]] == [500.0]
    assert body["contribution_plans"][0]["lines"][0]["ticker"] == "AAPL"
```

and extend `test_delete_my_data_wipes_only_the_callers_rows` so it asserts the caller's plans and lines are gone and another user's remain.

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --system-certs pytest tests/test_plans_router.py tests/test_me_router.py -q`
Expected: FAIL (404 for the routes, `KeyError: 'contribution_plans'`).

- [ ] **Step 3: Implement the schemas**

`backend/app/schemas.py`:

```python
class PlanIn(BaseModel):
    amount: float = Field(gt=0, le=1_000_000)
    whole_shares: bool = False


class PlanLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ticker: str
    name: str
    amount_eur: float
    shares: float
    price_eur: float
    currency: str
    rate: float
    weight_before: float | None
    weight_after: float | None
    reason: str
    reason_text: str = ""


class PlanOut(BaseModel):
    id: int | None = None
    created_at: datetime | None = None
    amount_eur: float
    whole_shares: bool
    total_before_eur: float
    leftover_eur: float
    lines: list[PlanLineOut]
    notes: list[str]
    disclaimer: str = "Advisory only. Nothing is sent to a broker."


class PlanSummaryOut(BaseModel):
    id: int
    created_at: datetime
    amount_eur: float
    line_count: int
```

Add `contribution_plans: list[PlanOut] = Field(default_factory=list)` to `ExportOut`.

- [ ] **Step 4: Implement the service `backend/app/plans.py`**

```python
"""Builds, saves and reads contribution plans. The calculation is app/planner.py; this module loads
the person's rows, prices them (app/fx.py) and turns the result into API shapes."""

import uuid
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import planner
from app.fx import eur_prices
from app.models import (
    ContributionPlan, ContributionPlanLine, Holding, Recommendation, WatchlistItem,
)
from app.schemas import PlanIn, PlanLineOut, PlanOut, PlanSummaryOut

MAX_PLANS = 120
REASON_TEXT = {
    "new_position": "A new position that starts at 0 %",
    "underweight": "Below its target weight",
    "favoured": "Below its target, and its newest call is ADD or BUY",
    "remainder": "Extra money shared by target weight",
}


def _load(db: Session, user_id: uuid.UUID) -> dict[str, object]:
    holdings = db.query(Holding).filter_by(user_id=user_id).all()
    watch = db.query(WatchlistItem).filter_by(user_id=user_id).all()
    targeted = {h.ticker for h in holdings if h.target_weight} | {
        w.ticker for w in watch if w.target_weight
    }
    calls: dict[str, str] = {}
    rows = (
        db.query(Recommendation.ticker, Recommendation.action)
        .filter(
            Recommendation.user_id == user_id,
            Recommendation.status == "PENDING",
            Recommendation.ticker.in_(targeted or [""]),
        )
        .order_by(Recommendation.created_at.desc(), Recommendation.id.desc())
        .all()
    )
    for ticker, action in rows:  # newest first: keep the first one per ticker
        calls.setdefault(ticker, action)
    return {
        "holdings": [(h.ticker, h.name, Decimal(str(h.shares)), h.target_weight) for h in holdings],
        "watch": [(w.ticker, w.target_weight) for w in watch],
        "calls": calls,
    }


async def compute(db: Session, user_id: uuid.UUID, payload: PlanIn) -> PlanOut:
    data = await run_in_threadpool(_load, db, user_id)
    db.close()  # release the connection before the (possibly slow) price lookups

    notes: list[str] = []
    targets: dict[str, tuple[str, Decimal, Decimal]] = {}  # ticker -> (name, shares, target)
    untargeted = 0
    for ticker, name, shares, target in data["holdings"]:
        if target and target > 0:
            targets[ticker] = (name, shares, Decimal(str(target)))
        elif shares > 0:
            untargeted += 1
    for ticker, target in data["watch"]:
        if target and target > 0 and ticker not in targets:
            targets[ticker] = (ticker, Decimal(0), Decimal(str(target)))
    if untargeted:
        noun = "holding has" if untargeted == 1 else "holdings have"
        notes.append(f"{untargeted} {noun} no target weight and {'is' if untargeted == 1 else 'are'} left out of the plan.")

    prices, skipped = await eur_prices(set(targets))
    notes += [skipped[t] for t in sorted(skipped)]

    candidates = []
    for ticker, (name, shares, target) in targets.items():
        price = prices.get(ticker)
        if price is None:
            continue
        candidates.append(
            planner.Candidate(
                ticker=ticker, name=name, held=shares > 0, current_value=shares * price.price_eur,
                target=target, price_eur=price.price_eur, currency=price.currency, rate=price.rate,
                call=data["calls"].get(ticker),
            )
        )
    result = planner.build_plan(candidates, Decimal(str(payload.amount)), whole_shares=payload.whole_shares)
    return PlanOut(
        amount_eur=payload.amount,
        whole_shares=payload.whole_shares,
        total_before_eur=float(result.total_before),
        leftover_eur=float(result.leftover),
        lines=[
            PlanLineOut(
                ticker=l.ticker, name=l.name, amount_eur=float(l.amount_eur), shares=float(l.shares),
                price_eur=float(l.price_eur), currency=l.currency, rate=float(l.rate),
                weight_before=None if l.weight_before is None else float(l.weight_before),
                weight_after=None if l.weight_after is None else float(l.weight_after),
                reason=l.reason, reason_text=REASON_TEXT[l.reason],
            )
            for l in result.lines
        ],
        notes=notes + result.notes,
    )
```

Notes: a closed position (shares 0) with a target is treated as not held. `payload.amount` is already validated (0 < amount <= 1,000,000).

`save(db, user_id, plan: PlanOut) -> PlanOut`: count the person's plans, raise `HTTPException(409, "You can keep up to 120 saved plans. Delete one before saving another.")` at `MAX_PLANS`; insert the `ContributionPlan` then its lines in one transaction with explicit rollback on `SQLAlchemyError`; return `PlanOut` with the new `id` and `created_at`. `load`, `list_summaries` (newest first, with the line count) and `delete` (removes the lines and then the plan in one transaction; returns False when the plan is not the caller's) all filter on `user_id`.

- [ ] **Step 5: Implement the router `backend/app/routers/plans.py`**

```python
router = APIRouter(
    prefix="/plans", tags=["plans"], dependencies=[Depends(get_current_user), Depends(no_store)]
)

PREVIEW_LIMIT_PER_MINUTE = 10


@router.post("/preview", response_model=PlanOut,
             dependencies=[Depends(rate_limiter("plans_preview", limit=PREVIEW_LIMIT_PER_MINUTE))])
async def preview_plan(payload: PlanIn, user: CurrentUser = Depends(get_current_user),
                       db: Session = Depends(get_user_db)) -> PlanOut:
    return await plans.compute(db, user.id, payload)


@router.post("", response_model=PlanOut, status_code=201,
             dependencies=[Depends(rate_limiter("plans_save", limit=PREVIEW_LIMIT_PER_MINUTE))])
async def save_plan(payload: PlanIn, user: CurrentUser = Depends(get_current_user),
                    db: Session = Depends(get_user_db)) -> PlanOut:
    plan = await plans.compute(db, user.id, payload)
    return await run_in_threadpool(plans.save, db, user.id, plan)
```

plus `GET ""` (summaries), `GET "/{plan_id}"` (404 `"Plan not found"`), `DELETE "/{plan_id}"` (204, 404 when not the caller's). Register `plans.router` in `main.py`. `routers/me.py` `export_data` adds `contribution_plans=[plans.load(db, user.id, p.id) for p in ...]` (one query for plans and one for all lines, not one per plan; keep it simple and bounded by `MAX_PLANS`).

- [ ] **Step 6: Run**

Run: `uv run --system-certs pytest tests/test_plans_router.py tests/test_me_router.py tests/test_routes_require_auth.py -q`, then the full suite, ruff, mypy.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat: contribution plan routes to preview, save, list and delete, plus the export"
```

---

### Task 6: The drift endpoint

**Files:**
- Modify: `backend/app/plans.py`, `backend/app/routers/plans.py`, `backend/app/schemas.py`
- Test: `backend/tests/test_plans_router.py`

**Interfaces:**
- Consumes: Task 3 `drift_items`, Task 5 `plans._load` and `eur_prices`, Task 1 `InvestmentPreferences.drift_threshold_pct`.
- Produces: `DriftItemOut(ticker: str, name: str, weight: float, target: float, points: float)`; `plans.drift(db, user_id) -> list[DriftItemOut]`; route `GET /plans/drift` (rate limited 30 a minute), declared before `/{plan_id}`.

- [ ] **Step 1: Write the failing tests** (append to `test_plans_router.py`)

```python
def test_drift_lists_holdings_beyond_the_threshold(client, db_session):
    _holding(db_session, "AAPL", 5, 0.4)     # 1000
    _holding(db_session, "MSFT", 7.5, 0.4)   # 3000: weights 25 / 75 against 50 / 50
    with _prices(AAPL=200, MSFT=400):
        body = client.get("/plans/drift").json()
    assert [(i["ticker"], round(i["points"], 1)) for i in body] == [("AAPL", -25.0), ("MSFT", 25.0)]
    assert body[0]["weight"] == pytest.approx(0.25) and body[0]["target"] == pytest.approx(0.5)


def test_drift_uses_the_persons_own_threshold(client, db_session):
    _holding(db_session, "AAPL", 5, 0.4)
    _holding(db_session, "MSFT", 7.5, 0.4)
    client.post("/preferences", json={"drift_threshold_pct": 30})
    with _prices(AAPL=200, MSFT=400):
        assert client.get("/plans/drift").json() == []


def test_drift_is_empty_without_targets_and_never_lists_the_watchlist(client, db_session):
    _holding(db_session, "AAPL", 5, None)
    _watch(db_session, "NVDA", 0.5)
    with _prices(AAPL=200, NVDA=100):
        assert client.get("/plans/drift").json() == []


def test_drift_is_not_confused_with_a_plan_id(client):
    assert client.get("/plans/drift").status_code == 200


def test_drift_ignores_other_users(client, db_session):
    _holding(db_session, "TSLA", 100, 0.5, user_id=OTHER_USER_ID)
    _holding(db_session, "GOOG", 1, 0.5, user_id=OTHER_USER_ID)
    with _prices(TSLA=50, GOOG=100):
        assert client.get("/plans/drift").json() == []
```

- [ ] **Step 2: Run to verify they fail** — `uv run --system-certs pytest tests/test_plans_router.py -q`; expected: FAIL (422 for `drift` as a plan id).

- [ ] **Step 3: Implement**

In `plans.py` add `async def drift(db, user_id)`: reuse `_load` (plus the person's `drift_threshold_pct`, default 5 when no preferences row) and `eur_prices` for the targeted open holdings only; build `Candidate`s (`held` only for shares > 0; call not needed), call `planner.drift_items(candidates, Decimal(str(threshold)))`, and map to `DriftItemOut` (weights as fractions, `points` in percentage points). In `routers/plans.py` declare `@router.get("/drift", response_model=list[DriftItemOut], dependencies=[Depends(rate_limiter("plans_drift", limit=30))])` ABOVE the `/{plan_id}` route.

- [ ] **Step 4: Run** — the file, then the full suite, ruff, mypy. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: drift endpoint for holdings far from their target weight"
```

---

### Task 7: The start-of-month reminder in the Telegram message

**Files:**
- Modify: `backend/app/notify.py`
- Test: `backend/tests/test_notify.py`

**Interfaces:**
- Consumes: Task 1 `TelegramLink.plan_reminder_enabled`, `Holding.target_weight`, `WatchlistItem.target_weight`; the existing `build_message` and `notify_user`.
- Produces: `notify.is_first_weekday(day: date) -> bool`; `build_message(new_recs, moves, app_url, reminder: bool = False)`; the reminder line is `Plan this month's contribution: <app_url>/portfolio/plan` (without the address: `Plan this month's contribution in the app.`), placed after the digest and moves lines and before the "Open Today" line, and it counts as content (a message with only the reminder is sent).

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_notify.py`, using its `env`, `_user`, `_hold`, `_rec`, `_notify`, `FOOT`, `MONDAY` helpers; add a `TUESDAY_FIRST = datetime(2026, 9, 1, 6, 0, tzinfo=UTC)` constant (1 September 2026 is a Tuesday) and `MONDAY_THIRD = datetime(2026, 8, 3, 6, 0, tzinfo=UTC)` (1 and 2 August 2026 are a Saturday and Sunday))

```python
import calendar
from datetime import date


def test_is_first_weekday_picks_exactly_one_day_each_month():
    for year in (2026, 2027, 2028):
        for month in range(1, 13):
            days = [d for d in range(1, calendar.monthrange(year, month)[1] + 1)
                    if notify.is_first_weekday(date(year, month, d))]
            first = next(d for d in range(1, 8) if date(year, month, d).weekday() < 5)
            assert days == [first], (year, month)


def test_build_message_with_the_reminder():
    text = notify.build_message([], [], "https://app.example.com", reminder=True)
    assert text == (
        "Plan this month's contribution: https://app.example.com/portfolio/plan\n"
        "Open Today: https://app.example.com/today\n" + FOOT
    )
    assert notify.build_message([], [], None, reminder=True) == (
        "Plan this month's contribution in the app.\n" + FOOT
    )
    assert notify.build_message([], [], "https://x", reminder=False) is None


def _with_target(db):
    _hold(db, USER_ID, "AAPL")
    db.query(Holding).update({"target_weight": 0.5})
    db.commit()


def test_the_reminder_alone_is_sent_on_the_first_weekday_to_someone_with_a_target(env):
    _user(env)
    _with_target(env)
    outcome, bot = _notify(now=TUESDAY_FIRST, quotes=_quotes({"AAPL": [100.0, 100.0]}))
    assert outcome == "sent"
    assert bot.sent[0][1].startswith("Plan this month's contribution")
    assert not any(ch.isdigit() and "EUR" in bot.sent[0][1] for ch in bot.sent[0][1])


def test_the_reminder_joins_the_days_message_instead_of_a_second_one(env):
    _user(env)
    _with_target(env)
    _rec(env, USER_ID, "MSFT")  # a new scheduled recommendation today
    _, bot = _notify(now=TUESDAY_FIRST, quotes=_quotes({"AAPL": [100.0, 100.0]}))
    assert len(bot.sent) == 1 and "1 new: MSFT ADD" in bot.sent[0][1] and "Plan this month" in bot.sent[0][1]


def test_a_month_starting_on_a_weekend_reminds_on_the_following_monday(env):
    _user(env)
    _with_target(env)
    assert _notify(now=MONDAY_THIRD, quotes=_quotes({"AAPL": [100.0, 100.0]}))[0] == "sent"


def test_no_reminder_on_other_days(env):
    _user(env)
    _with_target(env)
    outcome, bot = _notify(now=MONDAY, quotes=_quotes({"AAPL": [100.0, 100.0]}))  # 5 October 2026
    assert (outcome, bot.sent) == ("skipped", [])


def test_no_reminder_without_a_target_or_with_the_switch_off(env):
    _user(env)
    _hold(env, USER_ID, "AAPL")  # no target
    assert _notify(now=TUESDAY_FIRST, quotes=_quotes({"AAPL": [100.0, 100.0]}))[0] == "skipped"
    env.query(Holding).update({"target_weight": 0.5})
    env.query(TelegramLink).update({"plan_reminder_enabled": False})
    env.commit()
    assert _notify(now=TUESDAY_FIRST, quotes=_quotes({"AAPL": [100.0, 100.0]}))[0] == "skipped"


def test_a_watchlist_target_also_counts(env):
    _user(env)
    env.add(WatchlistItem(user_id=USER_ID, ticker="NVDA", asset_type="STOCK", target_weight=0.2))
    env.commit()
    assert _notify(now=TUESDAY_FIRST, quotes=_quotes({}))[0] == "sent"


def test_the_reminder_respects_the_once_a_day_marker_and_a_blocked_link(env):
    _user(env)
    _with_target(env)
    first, bot = _notify(now=TUESDAY_FIRST, quotes=_quotes({"AAPL": [100.0, 100.0]}))
    second, _ = _notify(bot=bot, now=TUESDAY_FIRST, quotes=_quotes({"AAPL": [100.0, 100.0]}))
    assert (first, second, len(bot.sent)) == ("sent", "skipped", 1)
    env.query(TelegramLink).update({"status": "blocked"})
    env.commit()
```

(Import `date`, `WatchlistItem`, `TelegramLink`, `Holding` in that file as needed; the existing tests keep passing because `reminder` defaults to `False`.)

- [ ] **Step 2: Run to verify they fail** — `uv run --system-certs pytest tests/test_notify.py -q`; expected: FAIL (`AttributeError: is_first_weekday`).

- [ ] **Step 3: Implement**

In `notify.py`:

```python
def is_first_weekday(day: date) -> bool:
    """The first Monday-to-Friday day of its month (the 1st, or the Monday of the 2nd or 3rd when the
    month starts on a weekend)."""
    return day.weekday() < 5 and (day.day == 1 or (day.weekday() == 0 and day.day <= 3))
```

`build_message(new_recs, moves, app_url, reminder=False)`: after the digest and moves lines, `if reminder: lines.append(f"Plan this month's contribution: {app_url.rstrip('/')}/portfolio/plan" if app_url else "Plan this month's contribution in the app.")`; the existing `if not lines: return None` stays after it so a reminder-only message is built. In `notify_user`, inside the scoped session: `remind = False; if link.plan_reminder_enabled and is_first_weekday(now.date()): remind = (db.query(Holding.id).filter(Holding.user_id == user_id, Holding.target_weight.isnot(None), Holding.target_weight > 0).first() is not None) or (same for WatchlistItem)` (import `date` and the two models with their first use); pass `reminder=remind` to `build_message`. Nothing else in the sending, marker, blocked and failure logic changes.

- [ ] **Step 4: Run** — `tests/test_notify.py tests/test_scheduled.py`, then the full suite, ruff, mypy. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: start-of-month plan reminder line in the Telegram message"
```

---

### Task 8: Docs and the spec

**Files:** `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `PRODUCT.md`, `docs/superpowers/specs/2026-10-08-contribution-planner-design.md`

- [ ] **Step 1: ARCHITECTURE.md** — the data model (the three new columns, the two plan tables, no foreign key and why, row security); the API (`/plans/*` table rows, `GET /plans/drift`, the new fields on `/preferences`, `/portfolio/watchlist` and `/me/telegram`); a "Contribution planner" section that describes the calculation exactly as implemented (pool of targeted items, gaps, `FAVOUR_FACTOR`, TRIM/SELL exclusion, remainder rule, minimum line, largest-remainder cents, whole shares, currency conversion and its fixed currency list, what is left out and noted); the reminder (first weekday of the month, one line in the day's single message, the switch); the drift card rules; the export block. Remove the stale `rebalance.py` remark in the testing checklist.
- [ ] **Step 2: RUNBOOK.md** — a short "Contribution planner" section: no secrets or settings; the plan screen needs quotes and exchange rates from the price source (what a "left out" note means); the reminder line and its switch; how to check it by hand (run `python -m app.scheduled notify` on the first weekday of a month with a linked chat and a target set).
- [ ] **Step 3: PRODUCT.md** — the planner is built; the mixed-currency gap is closed for the plan and still open for the portfolio totals.
- [ ] **Step 4: Fold the rulings into the spec** — update the spec text: the pool rule (replace `V`/`T` with `pool_before`/`pool`), largest-remainder rounding, the dropped second reminder marker, the page address `/portfolio/plan`, drift scope (open holdings with a target only), the pricing scope (only targeted items, 8 at a time, no 50 cap), and "no foreign key between plan lines and plans".
- [ ] **Step 5: Commit**

```bash
git add docs PRODUCT.md
git commit -m "docs: contribution planner in the architecture notes, the runbook and the product record"
```

---

### Task 9: STOP — design the frontend (huashu-design + impeccable)

The backend (Tasks 1-8) is complete and can be pushed on its own. No frontend code is written until this task is finished and the user has picked a direction.

**Files:**
- Create: `docs/design/contribution-planner/` (draft HTML and screenshots, kept as the design reference once chosen)
- Create: `direction-approved.md` in that folder

- [ ] **Step 1: Run the design skills** — invoke `huashu-design` (three real HTML directions with screenshots, using `docs/design/claude-keys/base.css` and `shell.js`, which carry the app's tokens) and `impeccable` (shape, then critique and polish of the chosen one). Each direction covers, in dark and light and at phone width: (a) the **Plan page**: the amount field pre-filled with the saved amount, the "Whole shares only" switch, "Make plan", the result (lines with euro amount, approximate shares, weight before and after, the reason text), the notes (skipped tickers), the leftover, "Save plan", and the disclaimer; the empty states (no targets yet: how to set them; nothing to fund); (b) the **history**: saved plans by month and one opened plan; (c) the **Today drift card** ("AAPL is 7.2 points above its target, NVDA 6.1 below" with a link to the plan); (d) the **targets** field on the watchlist add form and on the holding form, and the saved monthly amount and drift threshold in Preferences; (e) the **Telegram panel** with its third switch "Monthly plan reminder" and a sample reminder message. Use the spec's copy; no emoji; no Buy/Sell wording on the screens (lines say "Add 235.29 EUR", never "Buy").
- [ ] **Step 2: Present and stop** — show the three directions and wait for the user's choice or mix. Do not start Task 10 until they answer.
- [ ] **Step 3: Record the decision** — write `direction-approved.md` (what was shown, screenshot paths, the user's words), fill Part 2 below with the chosen structure and commit both.

---

## Part 2 — Frontend (filled in after the design pick)

Each task follows the same rhythm (failing Vitest test, run, implement, run, `eslint` / `tsc` / full suite / build, commit) and uses the existing `useAction`, SWR, `apiFetch`, MUI components and design tokens. Follow the structure of the earlier panels (`ClaudeKeyPanel`, `TelegramPanel`).

### Task 10: Types and hooks

**Files:** `frontend/lib/api/portfolio-types.ts` (`target_weight` on `WatchlistSummary`), `frontend/lib/plans.ts` (+ test), `frontend/lib/preferences.ts` (`monthly_contribution`, `drift_threshold_pct`), `frontend/lib/telegram.ts` (`plan_reminder_enabled`).

Behaviour to test: `usePlans()` returns the saved plans (`GET /plans`) with `preview({amount, whole_shares})` (`POST /plans/preview`), `save(...)` (`POST /plans`, revalidates the list), `remove(id)` and `load(id)`; `useDrift()` reads `GET /plans/drift` once per page view (no polling); amounts and weights are used as numbers; errors surface their `detail` (422 on a bad amount, 429, 409 at the plan cap); a preview result is held only in the page's state, never in storage.

### Task 11: The Plan page and history

**Files:** `frontend/app/(shell)/portfolio/plan/page.tsx`, its components (`PlanForm`, `PlanResult`, `PlanHistory`) and tests; a "Plan this month's contribution" link on the portfolio page.

Behaviour to test (copy and structure from the chosen direction): the amount field opens pre-filled with `monthly_contribution` and validates (positive, at most 1,000,000); "Make plan" is disabled while the request is pending and shows the result: lines with euro amount, approximate shares, weight before and after, the reason text; the notes list (skipped tickers) and the leftover; the "Whole shares only" switch re-requests with `whole_shares`; the empty states (no target weights yet, with the way to set them; nothing to fund); "Save plan" is disabled while pending, saves, shows the plan in the history and keeps the result visible; history lists saved plans newest first and opens one as saved, with delete after a confirmation; the disclaimer is always visible; no line says Buy or Sell.

### Task 12: Today drift card and targets on the forms

**Files:** the Today page and a `DriftCard` component, the watchlist add form (a target field) and the holding form (already has one) on the portfolio page, tests beside them.

Behaviour to test: the drift card shows only when `useDrift()` returns items and lists them in the wording from the design with a link to the plan page; nothing shows (and no error) while loading or when the request fails; the target field accepts a percentage 0 to 100 stored as a fraction 0 to 1, shows the saved value, and an omitted field never wipes a saved target (the add-ticker form does not send `target_weight` unless the person typed one).

### Task 13: Telegram switch and the Preferences fields

**Files:** `frontend/components/account/TelegramPanel.tsx`, the Preferences page (a saved monthly amount and the drift threshold), tests beside them.

Behaviour to test: the third switch "Monthly plan reminder" (default on) saves on toggle with an optimistic update and rollback like the other two and appears in the sample message preview only as the one reminder line (no amounts); the Preferences fields save only what changed (`POST /preferences` sends the fields given), validate their bounds (amount 1 to 1,000,000, threshold 1 to 50), and an empty amount clears it.

---

### Task 14: Final review, security review and the pull request

- [ ] **Step 1:** Run all checks: backend `uv run --system-certs ruff check . && uv run --system-certs mypy app && uv run --system-certs pytest -q`; frontend `npx eslint . && npx tsc --noEmit && npx vitest run && npm run build`.
- [ ] **Step 2:** Dispatch the `security-reviewer` subagent on `git diff master...HEAD` with this brief: every plan, history entry and drift result is built only from the caller's own rows in their scoped session and `/plans/{id}` and delete cannot touch another person's plan (row-level security with the runtime role); the server recomputes every saved plan and never trusts client lines; the amount and every price, currency and rate input is validated and a bad value can never produce a NaN, infinite, negative or absurd amount; the rate symbol comes only from a fixed table (no user text in a lookup); the preview and drift routes are rate limited and the price fan-out is bounded; the reminder line and the Telegram message carry no amounts, tickers or other financial data and the once-a-day marker still holds; plan data is never logged; the new tables' grants and forced owner-only policies and the unique/ordering of the migration; data export and data deletion cover the new tables; the preferences and watchlist writes cannot set a NOT NULL column to null or a weight outside 0 to 1; nothing here can call a broker or place a trade.
- [ ] **Step 3:** Fix every finding it confirms in one pass, re-run the checks, push the branch and open the pull request. In the description note that no new secrets or settings are needed, and that the plan page depends on the price source's currency data (the notes say which tickers were left out).
