# Plan ledger polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show on the plan screens what the approved design shows and the first build left out: the target tick on the weight bars, tickers left out of a plan as 0.00 rows with their reason, and the average cost back on the holdings table at every width.

**Architecture:** The planner records, besides the lines it funds, the normalised target weight of each line and a structured entry for every ticker it leaves out (with a kind and a short reason). The plan service merges the entries for tickers that could not be priced. Both are stored on the saved plan (two nullable columns, one hand-written migration) and returned by the preview and the saved plan. The ledger and the order cards render them. The holdings table folds Avg cost into the Shares cell.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic (hand-written), Pydantic v2, pytest; Next.js 16, MUI 9, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-plan-ledger-polish-design.md`

## Global Constraints

- The planner decides nothing differently: for any input the same lines, amounts and leftover come out. Only what is recorded about them grows.
- The system never places a trade; no Buy/Sell labels; "Advisory only. Nothing is sent to a broker." stays.
- `contribution_plan_lines.target_weight`: nullable `numeric(7,6)`, check 0 to 1 when set. `contribution_plans.left_out`: nullable JSON, a list of `{ticker, name, kind, reason}`. Old rows keep NULL and keep working (no tick, their notes as saved).
- `kind` is one of `excluded_call`, `unusable_price`, `too_small`, `unpriced`.
- The plan's `notes` keep only sentences that are not about one ticker ("1 holding has no target weight and is left out of the plan.", "The contribution must be more than zero.", "No holding or watchlist item has a target weight yet.", "Every ticker with a target is excluded or unpriced, so nothing is proposed.", "No ticker with a target could be priced right now. Try again in a few minutes.").
- Left-out `reason` text has no ticker prefix: "No price available.", "Its currency is unknown.", "Currency XYZ is not supported.", "No exchange rate for USD.", "Its price is outside the supported range.", "Its price is not usable.", "Its newest pending call is SELL.", "49.50 EUR is less than one share (748.96 EUR)."
- A left-out ticker is not an order: it never appears as an order card and never counts in the total or the leftover.
- Plan data is not logged or sent to Telegram. Hand-written migration only (a new file). Alembic head before this work: `e7b2c4d91a35`.
- Conventional Commits; never skip hooks or GPG signing (retry once on a signing timeout, otherwise leave the work staged and report); branch `feature/plan-ledger-polish`.

## Rulings (refine the spec)

1. Left-out `reason` has no ticker prefix (the row already shows the ticker); the rest of the wording is as the notes had it.
2. The four kinds above replace the spec's longer list: every ticker the price source could not price is `unpriced` (the reason says why).
3. `fx.eur_prices` returns bare reasons (no "X is left out:" prefix) because plans.py is its only consumer; the notes no longer carry ticker sentences for new plans.

## Review Focus

1. **A plan saved before this change:** NULL `left_out` and NULL line targets load without error, show no tick, no left-out rows, and keep the notes list they were saved with. [Tasks 1, 3]
2. **The plan must not change:** the same amounts, lines and leftover as before for the existing planner test cases. [Task 2]
3. **Targets add up:** the stored line targets are the normalised targets (they sum to 1 over every targeted candidate, funded or left out), never the raw target. [Task 2]
4. **Whole-shares mode with a line dropped for less than one share:** the ticker moves from notes to a `too_small` left-out entry, and the frontend's "not enough for one whole share" copy keeps working from it. [Tasks 2, 4]
5. **A holding or watchlist item with no price AND a pending SELL call:** exactly one left-out entry (the price failure comes first), never two. [Task 3]
6. **The holdings table at 900px, 1280px, 1536px:** no Avg cost column and no clipped P/L or Weight/Target cell. [Task 5]

---

## File Structure

- Create `backend/migrations/versions/<new>_add_plan_targets_and_left_out.py`.
- Modify `backend/app/models.py`, `backend/app/planner.py`, `backend/app/schemas.py`, `backend/app/fx.py`, `backend/app/plans.py`.
- Tests: `backend/tests/test_planner.py`, `test_fx.py`, `test_plans_router.py`, `test_models.py`, `test_me_router.py`, `test_order_tickets_migration.py` (head assertion), new `test_plan_ledger_migration.py`.
- Docs: `docs/ARCHITECTURE.md`, `PRODUCT.md`.
- Frontend (Part 2): `frontend/lib/plans.ts`, `frontend/components/plan/PlanResult.tsx`, `OrdersPanel.tsx`, `frontend/lib/portfolio/holdingColumns.ts`, `frontend/app/(shell)/portfolio/page.tsx`, tests beside them.

Hazards for every implementer: the ruff PostToolUse hook strips imports that are unused when you add them (add an import with its first use); Docker/Postgres must be running and the full backend suite is run ONE process at a time; the local TLS issue with uv needs `--system-certs`; the tests build the database with `create_all`, so a check constraint must be on the model as well as in the migration; `docs/ARCHITECTURE.md` and the frontend files are CRLF (preserve line endings).

---

## Part 1 — Backend

### Task 1: Migration and models

**Files:**
- Create: `backend/migrations/versions/<revision>_add_plan_targets_and_left_out.py` (`down_revision = 'e7b2c4d91a35'`, a new 12-hex revision id)
- Modify: `backend/app/models.py`, `backend/tests/test_order_tickets_migration.py`
- Test: `backend/tests/test_plan_ledger_migration.py`, `backend/tests/test_models.py`

**Interfaces:**
- Produces: `ContributionPlanLine.target_weight: float | None`; `ContributionPlan.left_out: list[dict] | None` (JSON).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_plan_ledger_migration.py` (the pattern of `test_order_tickets_migration.py`):

```python
import importlib.util
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parent.parent


def _migration():
    path = next((BACKEND / "migrations" / "versions").glob("*_add_plan_targets_and_left_out.py"))
    spec = importlib.util.spec_from_file_location("add_plan_targets_and_left_out", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_is_the_single_head_on_top_of_the_order_tickets_revision():
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()

    migration = _migration()
    assert heads == [migration.revision]
    assert migration.down_revision == "e7b2c4d91a35"
```

In `backend/tests/test_order_tickets_migration.py` replace `assert heads == [migration.revision]` with `assert len(heads) == 1` (keep the `down_revision` assertion): it is no longer the head.

Append to `backend/tests/test_models.py` (add imports with first use):

```python
def test_plan_target_and_left_out_columns_are_nullable_and_the_target_check_rejects_junk(db_session):
    uid = uuid.uuid4()
    plan = ContributionPlan(user_id=uid, amount_eur=1, whole_shares=False, total_before_eur=0,
                            leftover_eur=0, notes=[])
    db_session.add(plan)
    db_session.commit()
    line = ContributionPlanLine(user_id=uid, plan_id=plan.id, ticker="A", name="A", amount_eur=1, shares=1,
                                price_eur=1, currency="EUR", rate=1, reason="underweight")
    db_session.add(line)
    db_session.commit()
    assert plan.left_out is None and line.target_weight is None
    plan.left_out = [{"ticker": "NVDA", "name": "NVIDIA", "kind": "unpriced", "reason": "No price available."}]
    line.target_weight = 0.19
    db_session.commit()
    line.target_weight = 1.5
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
```

- [ ] **Step 2: Run to verify they fail** — `uv run --system-certs pytest tests/test_plan_ledger_migration.py tests/test_models.py -q` (from `backend/`); expected: FAIL.

- [ ] **Step 3: Write the migration** (template `e7b2c4d91a35_add_order_tickets.py`)

```python
"""add the plan-time target to plan lines and the structured left-out list to plans

Revision ID: b8d4f2a61c93
Revises: e7b2c4d91a35
Create Date: 2026-10-09 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b8d4f2a61c93'
down_revision: Union[str, Sequence[str], None] = 'e7b2c4d91a35'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TARGET_CHECK = "target_weight IS NULL OR (target_weight >= 0 AND target_weight <= 1)"


def upgrade() -> None:
    op.add_column("contribution_plan_lines", sa.Column("target_weight", sa.Numeric(7, 6), nullable=True))
    op.create_check_constraint("ck_plan_lines_target_weight", "contribution_plan_lines", TARGET_CHECK)
    op.add_column("contribution_plans", sa.Column("left_out", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("contribution_plans", "left_out")
    op.drop_constraint("ck_plan_lines_target_weight", "contribution_plan_lines", type_="check")
    op.drop_column("contribution_plan_lines", "target_weight")
```

- [ ] **Step 4: Models** — `backend/app/models.py`:

```python
# ContributionPlanLine: after `placed_trade_id`
    target_weight: Mapped[float | None] = mapped_column(Numeric(7, 6), nullable=True)

# ContributionPlan: after `notes`
    left_out: Mapped[list[dict[str, str]] | None] = mapped_column(JSON, nullable=True)
```

and in `ContributionPlanLine.__table_args__` add `CheckConstraint("target_weight IS NULL OR (target_weight >= 0 AND target_weight <= 1)", name="ck_plan_lines_target_weight")` (the same way the ISIN check is declared on the holdings model; create `__table_args__` if the class has none).

- [ ] **Step 5: Apply and run** — `uv run --system-certs alembic upgrade head` (LOCAL database only: confirm the host in `backend/.env` is localhost first), `alembic downgrade -1`, `alembic upgrade head`, then the three test files, the full suite, ruff and mypy. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat: store the plan-time target on plan lines and the left-out list on plans"
```

---

### Task 2: The planner records targets and left-out entries

**Files:**
- Modify: `backend/app/planner.py`
- Test: `backend/tests/test_planner.py` (existing tests that assert exclusion sentences in `plan.notes` now assert `plan.left_out`)

**Interfaces:**
- Produces: `planner.LeftOut(ticker: str, name: str, kind: str, reason: str)` (frozen dataclass); `PlanLine.target_weight: Decimal` (the normalised target); `Plan.left_out: list[LeftOut]` (default empty); `build_plan` puts excluded tickers in `left_out` and keeps `notes` for the general sentences only.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_planner.py`; it has the `cand(...)`/`amounts(...)` helpers)

```python
def test_each_line_carries_its_normalised_target():
    plan = build_plan(basic(), D("500"))
    by = {line.ticker: line for line in plan.lines}
    assert by["AAPL"].target_weight == D("0.4") and by["NVDA"].target_weight == D("0.2")
    cands = [cand("A", 0, 0.3), cand("B", 0, 0.3)]  # 0.3 + 0.3 = 0.6 is normalised to 0.5 each
    assert {l.target_weight for l in build_plan(cands, D("1000")).lines} == {D("0.5")}


@pytest.mark.parametrize("call", ["TRIM", "SELL"])
def test_an_excluded_call_is_a_left_out_entry_not_a_note(call):
    cands = basic()
    cands[0] = cand("AAPL", 1000, 0.4, price=200, call=call)
    plan = build_plan(cands, D("500"))
    assert [(e.ticker, e.kind, e.reason) for e in plan.left_out] == [
        ("AAPL", "excluded_call", f"Its newest pending call is {call}.")
    ]
    assert not any("AAPL" in n for n in plan.notes)


def test_an_unusable_price_is_a_left_out_entry():
    cands = [cand("OK", 0, 0.5), cand("BAD", 0, 0.5, price=0)]
    plan = build_plan(cands, D("100"))
    assert [(e.ticker, e.kind, e.reason) for e in plan.left_out] == [
        ("BAD", "unusable_price", "Its price is not usable.")
    ]
    assert amounts(plan) == {"OK": D("100.00")}


def test_a_line_dropped_for_less_than_one_share_is_a_too_small_entry():
    plan = build_plan([cand("BIG", 0, 1, price=150)], D("100"), whole_shares=True)
    assert plan.lines == []
    assert [(e.ticker, e.kind) for e in plan.left_out] == [("BIG", "too_small")]
    assert plan.left_out[0].reason == "100.00 EUR is less than one share (150.00 EUR)."
    assert plan.notes == []


def test_the_general_sentences_stay_in_the_notes_and_nothing_else_changes():
    plan = build_plan([cand("A", 1000, 0.5, call="SELL"), cand("B", 1000, 0.5, call="TRIM")], D("500"))
    assert plan.lines == [] and plan.leftover == D("500")
    assert plan.notes == ["Every ticker with a target is excluded or unpriced, so nothing is proposed."]
    assert [e.ticker for e in plan.left_out] == ["A", "B"]
```

Update the existing tests that asserted the removed sentences (`"AAPL" in n and call in n`, the whole-shares `"BIG" in n`) to the new assertions above; every other existing assertion (amounts, leftover, lines, reasons) must stay as it is.

- [ ] **Step 2: Run to verify they fail** — `uv run --system-certs pytest tests/test_planner.py -q`; expected: FAIL (`AttributeError: left_out`).

- [ ] **Step 3: Implement** in `backend/app/planner.py` (add `field` to the dataclasses import with its first use):

```python
@dataclass(frozen=True)
class LeftOut:
    ticker: str
    name: str
    kind: str  # "excluded_call" | "unusable_price" | "too_small" | "unpriced"
    reason: str
```

`PlanLine` gains `target_weight: Decimal` (after `reason`, no default: every construction site passes it); `Plan` gains `left_out: list[LeftOut] = field(default_factory=list)` as its LAST field. In `build_plan`:

- Create `left_out: list[LeftOut] = []` next to `notes`.
- Replace the two `notes.append(...)` calls for an unusable price and an excluding call with
  `left_out.append(LeftOut(c.ticker, c.name, "unusable_price", "Its price is not usable."))` and
  `left_out.append(LeftOut(c.ticker, c.name, "excluded_call", f"Its newest pending call is {c.call}."))`.
- Replace the whole-shares `notes.append(f"{ticker}: ...")` with
  `left_out.append(LeftOut(ticker, c.name, "too_small", f"{cash} EUR is less than one share ({c.price_eur:.2f} EUR)."))`.
- `if not eligible:` keeps its general note and returns `Plan([], notes, pool_before, amount, left_out)`.
- Each `PlanLine(...)` gets `target_weight=weight[c.ticker]`.
- The final return is `Plan(lines, notes, pool_before, amount - spent, left_out)`.

(The other early returns keep their notes and return `Plan(..., )` with the default empty `left_out`.)

- [ ] **Step 4: Run** — `tests/test_planner.py tests/test_planner_drift.py`, then the full suite (the router tests that asserted ticker sentences in `notes` fail until Task 3: expected; only run the planner files here and the full suite in Task 3), ruff, mypy.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: the planner records each line's target and a structured entry for every ticker it leaves out"
```

---

### Task 3: The plan service, the API shape, save and load

**Files:**
- Modify: `backend/app/fx.py`, `backend/app/schemas.py`, `backend/app/plans.py`
- Test: `backend/tests/test_fx.py`, `backend/tests/test_plans_router.py`, `backend/tests/test_me_router.py`
- Docs: `docs/ARCHITECTURE.md`, `PRODUCT.md`

**Interfaces:**
- Consumes: `planner.LeftOut`, `PlanLine.target_weight`, `Plan.left_out` (Task 2); the model columns (Task 1).
- Produces: `schemas.LeftOutOut(ticker, name, kind, reason)`; `PlanLineOut.target_weight: float | None = None`; `PlanOut.left_out: list[LeftOutOut] = []`; `fx.eur_prices` returns bare reasons in its second element (for example `"No price available."`).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_fx.py`: update the existing skip assertions from the old sentences to the bare reasons (`"AAPL" in skipped["AAPL"]` becomes the exact bare text), e.g. `skipped["AAPL"] == "No price available."`, `"Its currency is unknown."`, `"Currency XYZ is not supported."`, `"No exchange rate for USD."`, `"Its price is outside the supported range."`.

Append to `backend/tests/test_plans_router.py` (reuse `_seed_basic`, `_saved`, `_prices`, `_holding`, `_watch`, `Recommendation`):

```python
def test_an_unpriced_ticker_is_a_left_out_entry_and_not_a_note(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400):  # NVDA has no price
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert body["left_out"] == [
        {"ticker": "NVDA", "name": "NVDA", "kind": "unpriced", "reason": "No price available."}
    ]
    assert not any("NVDA" in n for n in body["notes"])


def test_an_excluded_call_is_a_left_out_entry(client, db_session):
    _seed_basic(db_session)
    db_session.add(Recommendation(user_id=USER_ID, ticker="AAPL", asset_type="STOCK", action="SELL",
                                  reasoning=["x"], status="PENDING"))
    db_session.commit()
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert [(e["ticker"], e["kind"], e["reason"]) for e in body["left_out"]] == [
        ("AAPL", "excluded_call", "Its newest pending call is SELL.")
    ]


def test_a_ticker_with_no_price_and_a_sell_call_is_left_out_once(client, db_session):
    _seed_basic(db_session)
    db_session.add(Recommendation(user_id=USER_ID, ticker="NVDA", asset_type="STOCK", action="SELL",
                                  reasoning=["x"], status="PENDING"))
    db_session.commit()
    with _prices(AAPL=200, MSFT=400):  # NVDA unpriced
        body = client.post("/plans/preview", json={"amount": 500}).json()
    assert [e["ticker"] for e in body["left_out"]] == ["NVDA"]
    assert body["left_out"][0]["kind"] == "unpriced"


def test_lines_carry_their_normalised_target(client, db_session):
    _seed_basic(db_session)  # targets 0.4, 0.4, 0.2
    with _prices(AAPL=200, MSFT=400, NVDA=100):
        lines = {l["ticker"]: l for l in client.post("/plans/preview", json={"amount": 500}).json()["lines"]}
    assert lines["AAPL"]["target_weight"] == 0.4 and lines["NVDA"]["target_weight"] == 0.2


def test_the_target_and_the_left_out_list_survive_save_and_load_and_export(client, db_session):
    _seed_basic(db_session)
    with _prices(AAPL=200, MSFT=400):
        saved = client.post("/plans", json={"amount": 500}).json()
    loaded = client.get(f"/plans/{saved['id']}").json()
    assert loaded["left_out"] == saved["left_out"] and loaded["left_out"][0]["ticker"] == "NVDA"
    assert [l["target_weight"] for l in loaded["lines"]] == [l["target_weight"] for l in saved["lines"]]
    assert all(l["target_weight"] is not None for l in loaded["lines"])
    exported = client.get("/me/export").json()["contribution_plans"][0]
    assert exported["left_out"] == loaded["left_out"]


def test_a_plan_saved_before_this_change_loads_with_no_target_and_no_left_out(client, db_session):
    plan = ContributionPlan(user_id=USER_ID, amount_eur=100, whole_shares=False, total_before_eur=0,
                            leftover_eur=0, notes=["NVDA is left out: no price available."])
    db_session.add(plan)
    db_session.commit()
    db_session.add(ContributionPlanLine(user_id=USER_ID, plan_id=plan.id, ticker="AAPL", name="Apple",
                                        amount_eur=100, shares=1, price_eur=100, currency="EUR", rate=1,
                                        reason="underweight"))
    db_session.commit()
    body = client.get(f"/plans/{plan.id}").json()
    assert body["left_out"] == [] and body["lines"][0]["target_weight"] is None
    assert body["notes"] == ["NVDA is left out: no price available."]  # the saved notes are untouched
```

Update the existing router tests that asserted ticker sentences in `body["notes"]` (the unpriced and the TRIM/SELL ones) to assert `left_out` as above; every other assertion stays.

- [ ] **Step 2: Run to verify they fail** — `uv run --system-certs pytest tests/test_fx.py tests/test_plans_router.py tests/test_me_router.py -q`; expected: FAIL.

- [ ] **Step 3: Implement**

`backend/app/fx.py`: the skip texts lose their prefix and start with a capital: `"No price available."`, `"Its currency is unknown."`, `f"Currency {currency[:8]} is not supported."`, `f"No exchange rate for {currency}."`, `"Its price is outside the supported range."` (and the "could not be converted" one if present as `"Its price could not be converted."`). The values of the returned `skipped` dict are these bare reasons.

`backend/app/schemas.py`:

```python
class LeftOutOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ticker: str
    name: str
    kind: str
    reason: str
```

add `target_weight: float | None = None` to `PlanLineOut` and `left_out: list[LeftOutOut] = Field(default_factory=list)` to `PlanOut`.

`backend/app/plans.py`:

- In `compute`, replace `notes += [skipped[t] for t in sorted(skipped)]` with
  `unpriced = [planner.LeftOut(t, targets[t][0], "unpriced", skipped[t]) for t in sorted(skipped)]`.
- After the plan is built: `left_out = sorted(unpriced + result.left_out, key=lambda e: e.ticker)`; a ticker the price source skipped never reaches the planner (it is not a candidate), so no ticker appears twice.
- Pass `left_out=[LeftOutOut.model_validate(e, from_attributes=True) for e in left_out]` to `PlanOut(...)`.
- In `save`: `ContributionPlan(..., left_out=[e.model_dump() for e in plan.left_out])` and each `ContributionPlanLine(..., target_weight=line.target_weight)`.
- In `_out`: `left_out=[LeftOutOut(**e) for e in (row.left_out or [])]`; `_line_out` already builds from the ORM line, which now has `target_weight`.

- [ ] **Step 4: Run** — the three files, then the full suite once, ruff, mypy. Expected: PASS.

- [ ] **Step 5: Docs** (CRLF: preserve) — `docs/ARCHITECTURE.md`: the two columns, `LeftOutOut`, `PlanLineOut.target_weight`, the kinds, "notes keep only general sentences", old plans unchanged; `PRODUCT.md`: the ledger shows the target tick and left-out tickers.

- [ ] **Step 6: Commit**

```bash
git add backend docs PRODUCT.md
git commit -m "feat: plans return and store each line's target and the tickers left out"
```

---

## Part 2 — Frontend

The designs exist (the contribution planner direction C screenshots show the tick and the 0.00 rows; the portfolio navigation mockup shows the Avg cost), so there is no design pause. The pages are behind sign-in: each report says honestly that nothing was checked in a browser. Each task follows the usual rhythm (failing Vitest test, run, implement, run, `eslint` / `tsc` / full suite / build, commit).

### Task 4: Target tick and left-out rows

**Files:** `frontend/lib/plans.ts` (types: `PlanLine.target_weight: number | null`, `LeftOut`, `Plan.left_out: LeftOut[]`), `frontend/components/plan/PlanResult.tsx` (the weight bar and the ledger), `frontend/components/plan/OrdersPanel.tsx` (a "Left out of this plan" list; the whole-shares empty copy), tests, existing fixtures.

Behaviour to test: a line with a target shows a tick on the bar at the target position and "target 19 %" in the numbers line ("17.9 % to 18.4 % · target 19 %"); the bar scale includes the target so the tick is always inside the track; a line with `target_weight` null shows no tick and the old numbers line; the preview ledger shows one muted row per `left_out` entry after the funded lines (ticker and name, the reason, "0.00" in the amount column, no weight bar, not counted in the Total, same grid at 390px with the price column hidden); the saved plan's order cards do NOT include left-out tickers, which show in a "Left out of this plan" list below the cards (ticker, name, reason); a plan without lines but with left-out entries shows the "Nothing to fund" panel listing them from `left_out` (not from notes), and the whole-shares copy ("This amount is not enough for one whole share…") is chosen when any entry has `kind === "too_small"` (replace the old match on the note text "less than one share"); `PlanNotes` shows only the remaining general notes; an old plan (empty `left_out`, ticker sentences in `notes`) still shows its notes list; no Buy or Sell wording.

### Task 5: Avg cost in the Shares cell

**Files:** `frontend/lib/portfolio/holdingColumns.ts`, `frontend/app/(shell)/portfolio/page.tsx` (header and `HoldingRow`), their tests.

Behaviour to test: the holdings table has six columns at every width from `md` (Holding, Shares, Price, Value, P/L, Weight / Target) and no separate Avg cost column; the Shares cell reads the full share count with "avg 1,492.38" as its second line (muted); a holding with no usable cost basis shows "avg" with the existing dash; the column template has no bare `fr` track and the header and rows use the same template; the phone second line is unchanged; no `AVG_COST_DISPLAY` or seven-track constant remains.

---

### Task 6: Final review, security review and the pull request

- [ ] **Step 1:** Run all checks: backend `uv run --system-certs ruff check . && uv run --system-certs ruff format --check . && uv run --system-certs mypy app && uv run --system-certs pytest -q`; the migration `upgrade`, `downgrade -1`, `upgrade` against the LOCAL database; frontend `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.
- [ ] **Step 2:** Dispatch the `security-reviewer` subagent on `git diff master...HEAD` with this brief: the new columns are on existing owner-only tables (row security and grants unchanged), nothing new is exposed beyond what the notes already said; the export and deletion cover them; old rows with NULL load; no new route; the planner produces identical lines, amounts and leftover for the same input (no money logic changed); `fx` reasons carry no user-supplied text beyond a truncated currency code; the frontend renders names, tickers and reasons as plain text.
- [ ] **Step 3:** Fix every finding it confirms in one pass, re-run the checks, push the branch and open the pull request. In the description note the migration (run by the normal deploy) and that a visual check of the ledger tick, the left-out rows and the holdings table at 900, 1280 and 1536px is still owed in a browser.
