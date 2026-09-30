# Backtests Screen and Stored Equity Curve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store a downsampled equity curve on each backtest result and build the Backtests screen (run form, polling, result with two-line chart and per-signal table, recent runs).

**Architecture:** The pure engine records per-day strategy and buy-and-hold values and downsamples them; a nullable JSON column stores them; a by-id route and a lean, newest-first list serve them. The frontend keeps `{ jobId, selectedId }` state, polls the job with SWR, and derives everything else; the chart is hand-rolled SVG.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic (autogenerate only), Pydantic v2, pytest against real Postgres; Next.js 16, TypeScript strict, MUI 9 (`slotProps`), SWR, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-30-backtests-design.md`

## Global Constraints

- The system never places a trade. The screen simulates on past prices only, offers no Buy/Sell, and says nothing is sent to a broker.
- Backend: thin routers, Pydantic v2 idioms (`model_validate`), every function typed, no `print`. Migrations only through `uv run alembic revision --autogenerate` (never hand-written). Tests hit real Postgres (`docker compose up -d` from the repo root); never call real yfinance/Anthropic in tests.
- Existing engine numbers (`final_value`, `buy_and_hold_value`, `excess_return_pct`, `hit_rate_by_signal`) must not change; the existing engine, job and router tests stay green. `BacktestMetrics.equity_curve` therefore defaults to `None` so existing `BacktestMetrics(...)` constructions keep working.
- Frontend: named exports (page files `export default`), all calls through `apiFetch` from `@/lib/api/client`, SWR for reads, `useAction` (`@/lib/useAction`) for submits, no `useEffect` for anything derivable, MUI 9 `slotProps` (never `SelectProps`/`InputLabelProps`), no chart library.
- No currency symbol; `formatAmount`/`formatPct` from `@/lib/format`. Colour is never the only carrier of meaning (direct labels, dash styles, signs, words). No exclamation marks or urgency wording.
- `excess_return_pct`, `avg_forward_return_pct` and `hit_rate` are **fractions** (0.05 = 5%); multiply by 100 for display.
- Starting value is 10,000 (`STARTING_CAPITAL`). Backend range limit is `end - start <= 365 * 30 = 10,950 days`, `start <= end`. Ticker rule: `^[A-Za-z0-9.\-^]{1,20}$`, uppercased.
- Frontend test style: `vi.mock("@/lib/api/client")` with an `apiFetch` mock and hoisted `FakeApiError`; `SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}`; `vitest.setup.ts` already shims `jest` so RTL `waitFor` works with fake timers.
- Checks before a task is done — backend (in `backend/`): `uv run python -m pytest tests/ -q`, `uv run ruff check . && uv run ruff format .`, `uv run mypy app`. Frontend (in `frontend/`): `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`. Commits: Conventional Commits with trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never skip hooks or signing; never commit `.env`.

## Review Focus

- A result row created before this change (null `equity_curve`) still loads and shows numbers and table, with the chart hidden (T3, T6).
- Another user's result id returns 404, never their data (T3).
- A flat curve (all values equal) or a 1-point curve draws no NaN coordinates and no broken chart (T4, T5).
- A `FAILED` job, an expired job (404) and an empty date range (no trading days, engine crashes → `FAILED`) show the calm message and leave the form usable for a retry (T8).
- Range boundary: exactly 10,950 days is accepted and 10,951 rejected; From equal To is allowed; a lowercase ticker is sent uppercased (T4, T7).

---

### Task 1: Engine curves and downsample

**Files:**
- Modify: `backend/app/backtest/engine.py`
- Test: `backend/tests/test_backtest_engine.py` (append)

**Interfaces:**
- Produces:
  ```python
  MAX_CURVE_POINTS = 250
  def downsample(values: list[float], max_points: int = MAX_CURVE_POINTS) -> list[float]
  @dataclass class BacktestMetrics:  # existing four fields unchanged, plus:
      equity_curve: dict[str, list[float]] | None = None   # {"strategy": [...], "buy_and_hold": [...]}
  ```
  `simulate()` always fills `equity_curve`.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_backtest_engine.py`; add `MAX_CURVE_POINTS, downsample` to the existing `from app.backtest.engine import simulate` line)

```python
def test_downsample_passes_short_lists_through_rounded():
    assert downsample([1.234, 2.0]) == [1.23, 2.0]
    assert downsample([]) == []
    assert downsample([5.0]) == [5.0]


def test_downsample_caps_length_and_keeps_first_and_last():
    values = [float(i) for i in range(1000)]
    out = downsample(values)
    assert len(out) == MAX_CURVE_POINTS
    assert out[0] == 0.0
    assert out[-1] == 999.0
    assert out == sorted(out)
    assert len(set(out)) == MAX_CURVE_POINTS  # no duplicated picks


def test_downsample_at_the_cap_is_unchanged():
    values = [float(i) for i in range(MAX_CURVE_POINTS)]
    assert downsample(values) == values


def test_simulate_curves_end_at_the_final_values_and_are_capped():
    flat = [150.0] * 200
    decline = [150.0 - i for i in range(1, 15)]
    recovery = [136.0 + i * 0.5 for i in range(1, 41)]
    closes = flat + decline + recovery  # 254 days, more than the cap

    metrics = simulate(closes)
    curve = metrics.equity_curve

    assert curve is not None
    assert len(curve["strategy"]) == len(curve["buy_and_hold"]) == MAX_CURVE_POINTS
    assert curve["strategy"][0] == pytest.approx(10000.0)
    assert curve["buy_and_hold"][0] == pytest.approx(10000.0)
    assert curve["strategy"][-1] == pytest.approx(metrics.final_value, abs=0.01)
    assert curve["buy_and_hold"][-1] == pytest.approx(metrics.buy_and_hold_value, abs=0.01)


def test_simulate_short_series_keeps_one_point_per_day():
    metrics = simulate([100.0] * 60)
    assert metrics.equity_curve is not None
    assert len(metrics.equity_curve["strategy"]) == 60
    assert len(metrics.equity_curve["buy_and_hold"]) == 60
```

- [ ] **Step 2: Run to verify failure** — in `backend/`: `uv run python -m pytest tests/test_backtest_engine.py -q`. Expected: FAIL (`ImportError: cannot import name 'downsample'`).

- [ ] **Step 3: Implement** in `backend/app/backtest/engine.py`:

Add below `LIVE_LOOKBACK_DAYS`:
```python
# Stored curves are downsampled so a 30-year run does not put ~7,500 points per line in a row.
MAX_CURVE_POINTS = 250
```
Extend the dataclass with a last field `equity_curve: dict[str, list[float]] | None = None` (after `hit_rate_by_signal`). Add:
```python
def downsample(values: list[float], max_points: int = MAX_CURVE_POINTS) -> list[float]:
    """Evenly spaced points, always keeping the first and last, rounded to 2 decimals.

    A list that already fits is returned unchanged (only rounded). Requires max_points >= 2.
    """
    if len(values) <= max_points:
        return [round(v, 2) for v in values]
    last = len(values) - 1
    # Consecutive picks are more than 1 apart (len > max_points), so their rounded indices differ.
    picks = [round(i * last / (max_points - 1)) for i in range(max_points)]
    return [round(values[i], 2) for i in picks]
```
In `simulate`: before the loop create `strategy_values: list[float] = []` and `buy_and_hold_values: list[float] = []`; at the end of each loop iteration (after the BUY/ADD/TRIM handling, before the forward-return block) append `cash + shares * price` and `STARTING_CAPITAL / closes[0] * price`. In the returned `BacktestMetrics(...)` add `equity_curve={"strategy": downsample(strategy_values), "buy_and_hold": downsample(buy_and_hold_values)}`. Do not change any existing calculation.

- [ ] **Step 4: Run to verify pass** — `uv run python -m pytest tests/test_backtest_engine.py tests/test_backtest_jobs.py -q`. Expected: all pass (existing tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/app/backtest/engine.py backend/tests/test_backtest_engine.py
git commit -m "feat: backtest engine records a downsampled equity curve"
```

---

### Task 2: Column, migration, job persistence and schemas

**Files:**
- Modify: `backend/app/models.py` (class `BacktestResult`)
- Create: `backend/migrations/versions/<generated>_add_equity_curve_to_backtest_results.py` (autogenerated)
- Modify: `backend/app/backtest/jobs.py`, `backend/app/schemas.py`
- Test: `backend/tests/test_models_backtest_result.py`, `backend/tests/test_backtest_jobs.py`, `backend/tests/test_backtest_router.py` (append)

**Interfaces:**
- Consumes: `BacktestMetrics.equity_curve` (Task 1).
- Produces:
  ```python
  # models.py
  equity_curve: Mapped[dict[str, list[float]] | None] = mapped_column(JSON, nullable=True)
  # schemas.py
  class EquityCurveOut(BaseModel): strategy: list[float]; buy_and_hold: list[float]
  class BacktestListItemOut(BaseModel): ...existing BacktestResultOut fields, no equity_curve
  class BacktestResultOut(BacktestListItemOut): equity_curve: EquityCurveOut | None = None
  ```

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_models_backtest_result.py` (reuse its existing imports; add `date` if missing):
```python
def test_backtest_result_stores_an_equity_curve(db_session):
    curve = {"strategy": [10000.0, 10100.5], "buy_and_hold": [10000.0, 10050.0]}
    result = BacktestResult(
        user_id=USER_ID,
        ticker="AAPL",
        start_date=date(2020, 1, 1),
        end_date=date(2024, 1, 1),
        final_value=10100.5,
        buy_and_hold_value=10050.0,
        excess_return_pct=0.005,
        hit_rate_by_signal={},
        equity_curve=curve,
        status="DONE",
    )
    db_session.add(result)
    db_session.commit()
    db_session.refresh(result)
    assert result.equity_curve == curve
```
(Use the same `USER_ID` import the file already uses, or `from tests.auth_support import USER_ID`.)

In `backend/tests/test_backtest_jobs.py`, extend `test_backtest_job_completes_and_persists_result`: add to `fake_metrics` the argument `equity_curve={"strategy": [10000.0, 11000.0], "buy_and_hold": [10000.0, 10500.0]},` and after `assert saved.user_id == OTHER_USER_ID` add `assert saved.equity_curve == {"strategy": [10000.0, 11000.0], "buy_and_hold": [10000.0, 10500.0]}`.

Append to `backend/tests/test_backtest_router.py`:
```python
def test_export_includes_the_equity_curve(client, db_session):
    row = _result(USER_ID)
    row.equity_curve = {"strategy": [10000.0, 11000.0], "buy_and_hold": [10000.0, 10500.0]}
    db_session.add(row)
    db_session.commit()

    exported = client.get("/me/export").json()["backtest_results"]
    assert exported[0]["equity_curve"] == {
        "strategy": [10000.0, 11000.0],
        "buy_and_hold": [10000.0, 10500.0],
    }
```

- [ ] **Step 2: Run to verify failure** — `uv run python -m pytest tests/test_models_backtest_result.py tests/test_backtest_jobs.py tests/test_backtest_router.py -q`. Expected: FAIL (`equity_curve` is an invalid keyword / missing column).

- [ ] **Step 3: Implement**
  - `models.py`: add the `equity_curve` column to `BacktestResult` after `hit_rate_by_signal`, with a one-line comment (`# {"strategy": [...], "buy_and_hold": [...]}, <= 250 points each; NULL for runs before it existed`). `JSON` is already imported there.
  - `jobs.py`: pass `equity_curve=metrics.equity_curve` in the `BacktestResult(...)` constructor.
  - `schemas.py`: replace `BacktestResultOut` with the three classes in Interfaces. `EquityCurveOut` is a plain `BaseModel`; `BacktestListItemOut` carries the current `BacktestResultOut` body (including `model_config = ConfigDict(from_attributes=True)`); `BacktestResultOut(BacktestListItemOut)` adds only `equity_curve`. `ExportOut` keeps referencing `BacktestResultOut`.
  - Migration: with Docker Postgres up and the dev DB at head (`uv run alembic upgrade head`), run `uv run alembic revision --autogenerate -m "add equity_curve to backtest_results"`. Read the generated file: it must contain exactly one `op.add_column('backtest_results', sa.Column('equity_curve', sa.JSON(), nullable=True))` and the matching `op.drop_column` in `downgrade`. **Do not hand-edit or hand-write it.** If autogenerate emits anything else (unrelated drift), delete the generated file and report NEEDS_CONTEXT with the output. Then verify `uv run alembic upgrade head`, `uv run alembic downgrade -1`, `uv run alembic upgrade head` all succeed. No RLS change is needed (the table's policy already exists).

- [ ] **Step 4: Run backend checks** — `uv run python -m pytest tests/ -q && uv run ruff check . && uv run ruff format . && uv run mypy app`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/migrations backend/tests
git commit -m "feat: store the backtest equity curve"
```

---

### Task 3: By-id route, newest-first lean list, ARCHITECTURE

**Files:**
- Modify: `backend/app/routers/backtest.py`, `docs/ARCHITECTURE.md`
- Test: `backend/tests/test_backtest_router.py` (append)

**Interfaces:**
- Consumes: `BacktestResultOut`, `BacktestListItemOut` (Task 2).
- Produces: `GET /backtest/results/{result_id}` → `BacktestResultOut` (404 `"Backtest result not found"` when missing or not the caller's); `GET /backtest/results?ticker=` → `list[BacktestListItemOut]`, newest first, at most 20.

- [ ] **Step 1: Write failing tests** (append to `backend/tests/test_backtest_router.py`; it already has the `_result(user_id, ticker="AAPL")` helper and `add_app_user`, `OTHER_USER_ID`)

```python
CURVE = {"strategy": [10000.0, 11000.0], "buy_and_hold": [10000.0, 10500.0]}


def test_get_result_returns_the_row_with_its_curve(client, db_session):
    row = _result(USER_ID)
    row.equity_curve = CURVE
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)

    response = client.get(f"/backtest/results/{row.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["ticker"] == "AAPL"
    assert body["equity_curve"] == CURVE
    assert "hit_rate_by_signal" in body


def test_get_result_for_an_older_row_has_a_null_curve(client, db_session):
    row = _result(USER_ID)
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)

    response = client.get(f"/backtest/results/{row.id}")

    assert response.status_code == 200
    assert response.json()["equity_curve"] is None


def test_get_result_of_another_user_is_404(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    row = _result(OTHER_USER_ID, "MSFT")
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)

    assert client.get(f"/backtest/results/{row.id}").status_code == 404
    assert client.get("/backtest/results/999999").status_code == 404


def test_get_result_requires_authentication(anon_client):
    assert anon_client.get("/backtest/results/1").status_code == 401


def test_list_results_is_newest_first_capped_at_20_and_has_no_curve(client, db_session):
    rows = []
    for n in range(22):
        row = _result(USER_ID, f"T{n:02d}")
        row.equity_curve = CURVE
        rows.append(row)
    db_session.add_all(rows)
    db_session.commit()

    body = client.get("/backtest/results").json()

    assert len(body) == 20
    assert body[0]["ticker"] == "T21"  # same created_at inside one transaction: id breaks the tie
    assert body[-1]["ticker"] == "T02"
    assert "equity_curve" not in body[0]
```

- [ ] **Step 2: Run to verify failure** — `uv run python -m pytest tests/test_backtest_router.py -q`. Expected: FAIL (404 on the by-id route; list length 22; `equity_curve` present).

- [ ] **Step 3: Implement** in `backend/app/routers/backtest.py`:
  - Import `BacktestListItemOut`, `BacktestResultOut` from `app.schemas` (drop the now-unused old import name if any).
  - Add `RESULTS_LIMIT = 20` below `MAX_BACKTEST_RANGE`.
  - Replace `list_results` with:
    ```python
    @router.get("/results", response_model=list[BacktestListItemOut])
    def list_results(
        ticker: str | None = None,
        user: CurrentUser = Depends(get_current_user),
        db: Session = Depends(get_user_db),
    ) -> list[BacktestResult]:
        query = db.query(BacktestResult).filter_by(user_id=user.id)
        if ticker:
            query = query.filter_by(ticker=ticker)
        # Newest first; id breaks ties between rows created in the same transaction.
        return (
            query.order_by(BacktestResult.created_at.desc(), BacktestResult.id.desc())
            .limit(RESULTS_LIMIT)
            .all()
        )


    @router.get("/results/{result_id}", response_model=BacktestResultOut)
    def get_result(
        result_id: int,
        user: CurrentUser = Depends(get_current_user),
        db: Session = Depends(get_user_db),
    ) -> BacktestResult:
        row = db.query(BacktestResult).filter_by(id=result_id, user_id=user.id).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Backtest result not found")
        return row
    ```
  - `docs/ARCHITECTURE.md`: in §4 `BacktestResult` add a line `equity_curve (JSON, nullable: {"strategy": [...], "buy_and_hold": [...]}, at most 250 evenly spaced points each incl. first and last day; NULL for runs made before the column existed)`. In the §5 table update the `GET /backtest/results?ticker=` row to say it returns the caller's rows newest first, at most 20, without the curve, and add a row `GET /backtest/results/{id}` — a single result including `equity_curve`; 404 if missing or not the caller's.

- [ ] **Step 4: Run backend checks** — `uv run python -m pytest tests/ -q && uv run ruff check . && uv run ruff format . && uv run mypy app`. Expected: all pass (`test_list_results_filters_by_ticker` and `test_backtest_results_only_include_the_token_users_rows` still pass).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/backtest.py backend/tests/test_backtest_router.py docs/ARCHITECTURE.md
git commit -m "feat: backtest result by id and a newest-first lean list"
```

---

### Task 4: Frontend types and pure helpers

**Files:**
- Create: `frontend/lib/backtest.ts`
- Test: `frontend/lib/backtest.test.ts`

**Interfaces:**
- Consumes: `formatPct` from `@/lib/format` (returns `+5.7%` / `-9.6%`), `todayIso` is NOT needed here.
- Produces:
  ```ts
  export interface SignalStats { count: number; avg_forward_return_pct: number; hit_rate: number }
  export interface EquityCurve { strategy: number[]; buy_and_hold: number[] }
  export interface BacktestListItem { id: number; created_at: string; ticker: string; start_date: string; end_date: string; final_value: number; buy_and_hold_value: number; excess_return_pct: number; hit_rate_by_signal: Record<string, SignalStats>; status: string }
  export interface BacktestResult extends BacktestListItem { equity_curve: EquityCurve | null }
  export interface JobStatus { status: "RUNNING" | "DONE" | "FAILED"; backtest_result_id: number | null }
  export interface RunInput { ticker: string; start: string; end: string }   // dates "YYYY-MM-DD"
  export const STARTING_VALUE = 10_000;
  export const MAX_RANGE_DAYS = 10_950;
  export function defaultRange(now: Date): { start: string; end: string }   // end = today UTC, start = same day 3 years earlier
  export function validateRun(input: RunInput): string | null               // first problem, or null
  export function excessLabel(fraction: number): string
  export function toChartPoints(curve: EquityCurve): { strategy: string; buyAndHold: string } | null
  export interface SignalRow { key: string; label: string; count: number; avgMovePct: number; risePct: number; small: boolean }
  export function signalRows(stats: Record<string, SignalStats>): SignalRow[]
  ```

Rules:
- `validateRun` messages, in this check order: ticker (trimmed) not matching `^[A-Za-z0-9.\-^]{1,20}$` → `"Enter a ticker: letters, digits, . - or ^, up to 20 characters."`; empty start or end → `"Choose a start and an end date."`; start after end → `"The start date must not be after the end date."`; `(Date.parse(end) - Date.parse(start)) / 86_400_000 > MAX_RANGE_DAYS` → `"The range can be at most 30 years."`. From equal to To is valid; exactly 10,950 days is valid.
- `defaultRange(now)`: `end = now.toISOString().slice(0, 10)`; `start` = a copy of `now` with `setUTCFullYear(getUTCFullYear() - 3)`, same format.
- `excessLabel(f)`: `pct = f * 100`; if `Math.abs(pct) < 0.05` → `"Level with buy-and-hold"`; else `` `${pct > 0 ? "Ahead of" : "Behind"} buy-and-hold by ${formatPct(pct)}` ``.
- `toChartPoints(curve)`: `null` when either list has fewer than 2 points. Otherwise both lines share one y-range (min and max across both lists; `span = max - min || 1`), points are `"x,y"` strings joined by spaces with `x = i / (n - 1) * 100` (using each list's own `n`) and `y = 40 - ((v - min) / span) * 36` (same box as `PortfolioChart`: viewBox `0 0 100 44`). A flat curve must give finite numbers.
- `signalRows`: labels `OVERSOLD → "Oversold"`, `STRONG_UPTREND → "Strong uptrend"`, `WEAK_DOWNTREND → "Weak downtrend"`, `NEUTRAL → "Neutral"`, unknown keys fall back to the raw key; `count` is `Math.round(stats.count)`; `avgMovePct = avg_forward_return_pct * 100`; `risePct = hit_rate * 100`; `small = count < 5`; sorted by `count` descending, ties by label.

- [ ] **Step 1: Write the failing tests** — `frontend/lib/backtest.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { defaultRange, excessLabel, signalRows, toChartPoints, validateRun } from "./backtest";

const OK = { ticker: "AAPL", start: "2023-01-01", end: "2024-01-01" };

describe("validateRun", () => {
  it("accepts a normal run, From equal To, and lowercase tickers", () => {
    expect(validateRun(OK)).toBeNull();
    expect(validateRun({ ...OK, start: "2024-01-01", end: "2024-01-01" })).toBeNull();
    expect(validateRun({ ...OK, ticker: " aapl " })).toBeNull();
    expect(validateRun({ ...OK, ticker: "BRK.B" })).toBeNull();
  });

  it("rejects a bad ticker", () => {
    expect(validateRun({ ...OK, ticker: "" })).toMatch(/enter a ticker/i);
    expect(validateRun({ ...OK, ticker: "AAPL/../x" })).toMatch(/enter a ticker/i);
    expect(validateRun({ ...OK, ticker: "A".repeat(21) })).toMatch(/enter a ticker/i);
  });

  it("requires both dates and a sensible order", () => {
    expect(validateRun({ ...OK, start: "" })).toMatch(/start and an end date/i);
    expect(validateRun({ ...OK, end: "" })).toMatch(/start and an end date/i);
    expect(validateRun({ ...OK, start: "2024-02-01", end: "2024-01-01" })).toMatch(/must not be after/i);
  });

  it("allows exactly 30 years (10,950 days) and rejects one day more", () => {
    // 1990-01-01 + 10,950 days = 2019-12-24
    expect(validateRun({ ...OK, start: "1990-01-01", end: "2019-12-24" })).toBeNull();
    expect(validateRun({ ...OK, start: "1990-01-01", end: "2019-12-25" })).toMatch(/at most 30 years/i);
  });
});

describe("defaultRange", () => {
  it("ends today (UTC) and starts three years earlier", () => {
    expect(defaultRange(new Date("2026-09-30T23:30:00Z"))).toEqual({ start: "2023-09-30", end: "2026-09-30" });
  });
});

describe("excessLabel", () => {
  it("says ahead, behind or level, with a signed percentage", () => {
    expect(excessLabel(0.0265)).toBe("Ahead of buy-and-hold by +2.7%");
    expect(excessLabel(-0.01)).toBe("Behind buy-and-hold by -1.0%");
    expect(excessLabel(0)).toBe("Level with buy-and-hold");
    expect(excessLabel(0.0002)).toBe("Level with buy-and-hold");
  });
});

describe("toChartPoints", () => {
  it("returns null with fewer than two points", () => {
    expect(toChartPoints({ strategy: [1], buy_and_hold: [1] })).toBeNull();
    expect(toChartPoints({ strategy: [], buy_and_hold: [] })).toBeNull();
  });

  it("draws both lines on one shared scale", () => {
    const pts = toChartPoints({ strategy: [10000, 12000], buy_and_hold: [10000, 11000] })!;
    expect(pts.strategy).toBe("0,40 100,4");
    expect(pts.buyAndHold).toBe("0,40 100,22");
  });

  it("never emits NaN for a flat curve", () => {
    const pts = toChartPoints({ strategy: [10000, 10000, 10000], buy_and_hold: [10000, 10000, 10000] })!;
    expect(pts.strategy).not.toMatch(/NaN|Infinity/);
    expect(pts.buyAndHold).not.toMatch(/NaN|Infinity/);
  });
});

describe("signalRows", () => {
  it("converts fractions to percentages, labels signals, sorts by count and flags small samples", () => {
    const rows = signalRows({
      STRONG_UPTREND: { count: 12, avg_forward_return_pct: 0.0238, hit_rate: 0.65 },
      OVERSOLD: { count: 3, avg_forward_return_pct: -0.01, hit_rate: 0.3333 },
      MYSTERY: { count: 30, avg_forward_return_pct: 0, hit_rate: 0.5 },
    });
    expect(rows.map((r) => r.label)).toEqual(["MYSTERY", "Strong uptrend", "Oversold"]);
    expect(rows[1]).toMatchObject({ key: "STRONG_UPTREND", count: 12, small: false });
    expect(rows[1].avgMovePct).toBeCloseTo(2.38);
    expect(rows[1].risePct).toBeCloseTo(65);
    expect(rows[2].small).toBe(true);
  });

  it("returns an empty list for no signals", () => {
    expect(signalRows({})).toEqual([]);
  });
});
```
(Check of the numbers: shared scale min 10000, max 12000, span 2000. Strategy end: `40 - (2000/2000)*36 = 4`; buy-and-hold end: `40 - (1000/2000)*36 = 22`.)

- [ ] **Step 2: Run to verify failure** — in `frontend/`: `npx vitest run lib/backtest.test.ts`. Expected: FAIL (cannot resolve `./backtest`).

- [ ] **Step 3: Implement** `frontend/lib/backtest.ts` per Interfaces and Rules (types, constants, `TICKER_PATTERN`, the five functions). Point coordinates use default number-to-string (`${x},${y}`); the expected strings above hold because the numbers are exact (`0`, `100`, `40`, `4`, `22`); do not round.

- [ ] **Step 4: Run to verify pass** — `npx vitest run lib/backtest.test.ts && npx tsc --noEmit && npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/backtest.ts frontend/lib/backtest.test.ts
git commit -m "feat: backtest types and pure helpers"
```

---

### Task 5: BacktestChart component

**Files:**
- Create: `frontend/components/backtests/BacktestChart.tsx`
- Test: `frontend/components/backtests/BacktestChart.test.tsx`

**Interfaces:**
- Consumes: `EquityCurve`, `toChartPoints` (Task 4); `formatAmount` from `@/lib/format`.
- Produces: `export function BacktestChart(props: { curve: EquityCurve; startDate: string; endDate: string }): JSX.Element | null` — returns `null` when `toChartPoints` is `null`.

Rendering: an `svg` with `role="img"`, `aria-label="Strategy value against buy-and-hold over the tested period"`, `viewBox="0 0 100 44"`, `preserveAspectRatio="none"`, width 100%, height 140. Two `polyline`s, both `fill="none"`, `strokeWidth={1.5}`, `vectorEffect="non-scaling-stroke"`: strategy solid `stroke="var(--accent)"`; buy-and-hold `stroke="var(--muted)"` with `strokeDasharray="3 2"`. Below the svg: the start and end dates (two spans, `startDate` left, `endDate` right, with the note "Trading days, evenly spaced"), and a text legend (the chart's text alternative): `Strategy (solid line): {formatAmount(first)} to {formatAmount(last)}` and `Buy-and-hold (dashed line): {formatAmount(first)} to {formatAmount(last)}` using each list's first and last values.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BacktestChart } from "./BacktestChart";

const CURVE = { strategy: [10000, 11234.5], buy_and_hold: [10000, 10500] };

describe("BacktestChart", () => {
  it("draws a solid and a dashed line with a text legend and the date range", () => {
    const { container } = render(<BacktestChart curve={CURVE} startDate="2023-01-02" endDate="2026-09-30" />);
    const lines = container.querySelectorAll("polyline");
    expect(lines).toHaveLength(2);
    const dashed = [...lines].filter((l) => l.getAttribute("stroke-dasharray"));
    expect(dashed).toHaveLength(1);
    expect(screen.getByRole("img", { name: /strategy value against buy-and-hold/i })).toBeInTheDocument();
    expect(screen.getByText("Strategy (solid line): 10,000.00 to 11,234.50")).toBeInTheDocument();
    expect(screen.getByText("Buy-and-hold (dashed line): 10,000.00 to 10,500.00")).toBeInTheDocument();
    expect(screen.getByText("2023-01-02")).toBeInTheDocument();
    expect(screen.getByText("2026-09-30")).toBeInTheDocument();
  });

  it("renders nothing for a curve with fewer than two points", () => {
    const { container } = render(
      <BacktestChart curve={{ strategy: [10000], buy_and_hold: [10000] }} startDate="2024-01-01" endDate="2024-01-01" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not produce NaN coordinates for a flat curve", () => {
    const flat = { strategy: [10000, 10000, 10000], buy_and_hold: [10000, 10000, 10000] };
    const { container } = render(<BacktestChart curve={flat} startDate="2024-01-01" endDate="2024-02-01" />);
    for (const line of container.querySelectorAll("polyline")) {
      expect(line.getAttribute("points")).not.toMatch(/NaN|Infinity/);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run components/backtests/BacktestChart.test.tsx`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `BacktestChart.tsx` per the rendering description (MUI `Box`/`Typography` for the text lines; `svg` written by hand like `PortfolioChart`).

- [ ] **Step 4: Run to verify pass** — `npx vitest run components/backtests && npx tsc --noEmit && npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/backtests/BacktestChart.tsx frontend/components/backtests/BacktestChart.test.tsx
git commit -m "feat: backtest two-line chart"
```

---

### Task 6: BacktestResultPanel

**Files:**
- Create: `frontend/components/backtests/BacktestResultPanel.tsx`
- Test: `frontend/components/backtests/BacktestResultPanel.test.tsx`

**Interfaces:**
- Consumes: `BacktestResult`, `STARTING_VALUE`, `excessLabel`, `signalRows` (Task 4); `BacktestChart` (Task 5); `formatAmount`, `formatPct`.
- Produces: `export function BacktestResultPanel(props: { result: BacktestResult }): JSX.Element`.

Content, in order:
1. Heading (`Typography` h2 semantics, `component="h2"`): `{ticker}, {start_date} to {end_date}`.
2. Text: `Both start from {formatAmount(STARTING_VALUE)}.`
3. Two lines: `Strategy ends at {formatAmount(final_value)}` and `Buy-and-hold ends at {formatAmount(buy_and_hold_value)}`.
4. `excessLabel(result.excess_return_pct)`.
5. `BacktestChart` only when `result.equity_curve` is not null (older runs show no chart and no placeholder box).
6. Table of `signalRows(result.hit_rate_by_signal)` with column headers `Signal`, `Times seen`, `Average move after 20 days`, `Share that rose`; cells: label, count, `formatPct(avgMovePct)`, `` `${Math.round(risePct)}%` ``. With no rows show `No signals fired in this range.` instead of the table.
7. When any row is `small`: `Some signals were seen fewer than 5 times; treat those rows as anecdotes.`
8. `Past performance is not a forecast. Simulated on past prices only; nothing is sent to a broker.`

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { BacktestResult } from "@/lib/backtest";
import { BacktestResultPanel } from "./BacktestResultPanel";

const RESULT: BacktestResult = {
  id: 1,
  created_at: "2026-09-30T10:00:00",
  ticker: "AAPL",
  start_date: "2023-01-02",
  end_date: "2026-09-30",
  final_value: 11000,
  buy_and_hold_value: 10500,
  excess_return_pct: 0.0476,
  hit_rate_by_signal: {
    STRONG_UPTREND: { count: 12, avg_forward_return_pct: 0.0238, hit_rate: 0.65 },
    OVERSOLD: { count: 3, avg_forward_return_pct: -0.01, hit_rate: 0.3333 },
  },
  status: "DONE",
  equity_curve: { strategy: [10000, 11000], buy_and_hold: [10000, 10500] },
};

describe("BacktestResultPanel", () => {
  it("shows the start value, both end values and the excess with a word", () => {
    render(<BacktestResultPanel result={RESULT} />);
    expect(screen.getByRole("heading", { name: /AAPL, 2023-01-02 to 2026-09-30/ })).toBeInTheDocument();
    expect(screen.getByText("Both start from 10,000.00.")).toBeInTheDocument();
    expect(screen.getByText("Strategy ends at 11,000.00")).toBeInTheDocument();
    expect(screen.getByText("Buy-and-hold ends at 10,500.00")).toBeInTheDocument();
    expect(screen.getByText("Ahead of buy-and-hold by +4.8%")).toBeInTheDocument();
  });

  it("converts the per-signal fractions and flags the small sample", () => {
    render(<BacktestResultPanel result={RESULT} />);
    const row = screen.getByRole("row", { name: /strong uptrend/i });
    expect(within(row).getByText("12")).toBeInTheDocument();
    expect(within(row).getByText("+2.4%")).toBeInTheDocument();
    expect(within(row).getByText("65%")).toBeInTheDocument();
    expect(screen.getByText(/seen fewer than 5 times/i)).toBeInTheDocument();
  });

  it("shows the chart when a curve is stored and hides it for an older run", () => {
    const { rerender } = render(<BacktestResultPanel result={RESULT} />);
    expect(screen.getByRole("img", { name: /strategy value against buy-and-hold/i })).toBeInTheDocument();
    rerender(<BacktestResultPanel result={{ ...RESULT, equity_curve: null }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Strategy ends at 11,000.00")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /strong uptrend/i })).toBeInTheDocument();
  });

  it("says so when no signals fired and always carries the disclaimer", () => {
    render(<BacktestResultPanel result={{ ...RESULT, hit_rate_by_signal: {} }} />);
    expect(screen.getByText("No signals fired in this range.")).toBeInTheDocument();
    expect(screen.queryByText(/seen fewer than 5 times/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("Past performance is not a forecast. Simulated on past prices only; nothing is sent to a broker."),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run components/backtests/BacktestResultPanel.test.tsx`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `BacktestResultPanel.tsx` per Content (MUI `Table`, `TableHead`, `TableBody`, `TableRow`, `TableCell`, `Typography`, `Box`).

- [ ] **Step 4: Run to verify pass** — `npx vitest run components/backtests && npx tsc --noEmit && npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/backtests/BacktestResultPanel.tsx frontend/components/backtests/BacktestResultPanel.test.tsx
git commit -m "feat: backtest result panel"
```

---

### Task 7: RunForm component

**Files:**
- Create: `frontend/components/backtests/RunForm.tsx`
- Test: `frontend/components/backtests/RunForm.test.tsx`

**Interfaces:**
- Consumes: `validateRun`, `defaultRange`, `RunInput` (Task 4).
- Produces: `export function RunForm(props: { onRun: (input: RunInput) => void; running: boolean; error: string | null }): JSX.Element`.

Behaviour: fields `Ticker` (text), `From` and `To` (`type="date"`, `slotProps={{ inputLabel: { shrink: true } }}`), button `Run backtest` (`type="submit"`, `disabled={running}`). State initialises once: start/end from `defaultRange(new Date())` inside a lazy `useState` initialiser (never `new Date()` directly in render). On submit: `event.preventDefault()`, `validateRun`; on a message show it in an error `Alert` and do not call `onRun`; otherwise `onRun({ ticker: ticker.trim().toUpperCase(), start, end })`. The `error` prop (a server error) shows in the same `Alert` slot when there is no local validation message. While `running`, a `role="status"` line `Running the backtest. This can take a little while.` is shown. The form never clears its fields.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunForm } from "./RunForm";

function setup(props: Partial<React.ComponentProps<typeof RunForm>> = {}) {
  const onRun = vi.fn();
  render(<RunForm onRun={onRun} running={false} error={null} {...props} />);
  return onRun;
}

describe("RunForm", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
  });

  it("defaults to the last three years", () => {
    setup();
    expect(screen.getByLabelText("From")).toHaveValue("2023-09-30");
    expect(screen.getByLabelText("To")).toHaveValue("2026-09-30");
  });

  it("sends the ticker uppercased and trimmed with both dates", () => {
    const onRun = setup();
    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: " aapl " } });
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    expect(onRun).toHaveBeenCalledWith({ ticker: "AAPL", start: "2023-09-30", end: "2026-09-30" });
  });

  it("blocks a bad ticker, a reversed range and an over-long range without calling onRun", () => {
    const onRun = setup();
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    expect(screen.getByText(/enter a ticker/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "AAPL" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    expect(screen.getByText(/must not be after/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "1990-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    expect(screen.getByText(/at most 30 years/i)).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();
  });

  it("shows a server error and disables the button while running", () => {
    setup({ error: "Something went wrong.", running: true });
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run backtest" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/running the backtest/i);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run components/backtests/RunForm.test.tsx`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `RunForm.tsx` per Behaviour (`Box component="form"`, MUI `TextField`, `Button`, `Alert`).

- [ ] **Step 4: Run to verify pass** — `npx vitest run components/backtests && npx tsc --noEmit && npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/backtests/RunForm.tsx frontend/components/backtests/RunForm.test.tsx
git commit -m "feat: backtest run form"
```

---

### Task 8: Backtests page (run, polling, result, recent runs)

**Files:**
- Modify: `frontend/app/(shell)/more/backtests/page.tsx` (currently a "Coming in sub-project 8" placeholder)
- Test: `frontend/app/(shell)/more/backtests/page.test.tsx` (create)

**Interfaces:**
- Consumes: `RunForm` (T7), `BacktestResultPanel` (T6), `BacktestListItem`, `BacktestResult`, `JobStatus`, `RunInput`, `excessLabel` (T4), `useAction`, `apiFetch`.
- Endpoints: `POST /backtest/run` `{ticker, start_date, end_date}` → `{job_id}`; `GET /backtest/run/{jobId}` → `JobStatus`; `GET /backtest/results` → `BacktestListItem[]`; `GET /backtest/results/{id}` → `BacktestResult`.

State and flow (no effects):
- `const [jobId, setJobId] = useState<string | null>(null)` and `const [selectedId, setSelectedId] = useState<number | null>(null)`; `const { run, submitting, error } = useAction()`.
- `useSWR<BacktestListItem[]>("/backtest/results", apiFetch)` gives `list`, `mutate: mutateList`.
- `useSWR<JobStatus>(jobId ? `/backtest/run/${jobId}` : null, apiFetch, { refreshInterval: (latest) => (latest?.status === "RUNNING" ? 2000 : 0), onSuccess: (latest) => { if (latest.status === "DONE") mutateList(); } })` gives `job`, `error: jobError`.
- Derived: `resultId = selectedId ?? (job?.status === "DONE" ? job.backtest_result_id : null)`; `jobRunning = jobId !== null && !jobError && (job === undefined || job.status === "RUNNING")`; `jobFailed = job?.status === "FAILED" || jobError !== undefined`.
- `useSWR<BacktestResult>(resultId !== null ? `/backtest/results/${resultId}` : null, apiFetch)` gives `result`, `error: resultError`.
- Starting a run: `run(async () => { const { job_id } = await apiFetch<{ job_id: string }>("/backtest/run", { method: "POST", body: JSON.stringify({ ticker, start_date: start, end_date: end }) }); setSelectedId(null); setJobId(job_id); })`. `RunForm` gets `running={submitting || jobRunning}` and `error={error}`.
- Render: h1 `Backtests` (`component="h1"`) with a `Link` back to `/more`; `RunForm`; when `jobFailed` an `Alert` (severity `warning`): `The backtest could not run for that ticker and range. Check the ticker and dates.`; when `resultError` an `Alert`: `Could not load that backtest.`; `BacktestResultPanel` when `result`; a "Recent runs" section: `listError` → `Could not load your recent runs.`; empty list → `No backtests yet.`; otherwise a `List` of `ListItemButton`s (`selected` when its id is `resultId`), each showing `{ticker}`, `{start_date} to {end_date}`, and `excessLabel(excess_return_pct)`; clicking sets `selectedId`.

- [ ] **Step 1: Write the failing tests** — `page.test.tsx`. Standard preamble (hoisted `FakeApiError`, `apiFetch` mock keyed by path, `SWRConfig` fresh cache, `dedupingInterval: 0`). Use `vi.useFakeTimers()` for the polling cases and `await act(async () => { await vi.advanceTimersByTimeAsync(2100); })` to step the 2-second poll (the `jest` shim in `vitest.setup.ts` makes `waitFor` cooperate with fake timers); restore real timers in `afterEach`. Define fixtures `RESULT` (as in Task 6, `id: 7`, `ticker: "AAPL"`, with a curve) and `LIST_ITEM` (same fields minus the curve). Cases:

  1. **Empty list:** `GET /backtest/results` → `[]` → shows `No backtests yet.`.
  2. **Run to result:** results list `[]`; POST `/backtest/run` → `{ job_id: "j1" }`; `GET /backtest/run/j1` returns `{ status: "RUNNING", backtest_result_id: null }` the first time and `{ status: "DONE", backtest_result_id: 7 }` afterwards; `GET /backtest/results/7` → `RESULT`. Fill the ticker (`AAPL`), click `Run backtest`; assert POST body `{"ticker":"AAPL","start_date":<default>,"end_date":<default>}` (use `expect.stringContaining` on the JSON or parse it), the running status text appears, then after one poll step the result panel appears (`Strategy ends at 11,000.00`), and the list endpoint was refetched (called twice).
  3. **Failed job:** the job returns `{ status: "FAILED", backtest_result_id: null }` → the warning text appears, the button is enabled again, and no result panel is shown.
  4. **Expired job:** `GET /backtest/run/j1` rejects with `new FakeApiError(404, "Job not found")` → the same warning text appears and the button is enabled.
  5. **Server error on start:** POST rejects with `new FakeApiError(422, "start_date must not be after end_date")` → that text is shown, no polling starts (no call to `/backtest/run/…`).
  6. **Select a past run:** list returns `[LIST_ITEM]`; clicking the row loads `GET /backtest/results/7` and shows the panel; the row's text includes `AAPL`, `2023-01-02 to 2026-09-30` and `Ahead of buy-and-hold by +4.8%`.
  7. **Older run without a curve:** `GET /backtest/results/7` returns `{ ...RESULT, equity_curve: null }` after selecting it → numbers and table shown, no `img` role.
  8. **Load errors:** the list rejects → `Could not load your recent runs.`; the by-id call rejects → `Could not load that backtest.`.

- [ ] **Step 2: Run to verify failure** — `npx vitest run "app/(shell)/more/backtests/page.test.tsx"`. Expected: FAIL (the placeholder page has none of this).

- [ ] **Step 3: Implement** `page.tsx` per State and flow.

- [ ] **Step 4: Full frontend verification** — in `frontend/`: `npm test && npm run lint && npx tsc --noEmit && npm run build`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(shell)/more/backtests"
git commit -m "feat: backtests page"
```

---

## Self-review notes

- **Spec coverage:** engine curve + `downsample` + cap 250 (T1); nullable column, autogenerated migration, job persistence, `BacktestResultOut`/`BacktestListItemOut`/`EquityCurveOut`, export completeness (T2); by-id route, 404 on other user, newest-first, cap 20, lean list, ARCHITECTURE §4/§5 (T3); form with default range and validation (T4, T7); polling, FAILED and expired-job handling, recent runs, selecting a past run (T8); result panel with 10,000 start note, signed excess with words, per-signal table, small-sample note, disclaimer (T6); two-line hand-rolled SVG chart with text alternative and null-curve handling (T4–T6).
- **Type consistency:** `EquityCurve`/`BacktestResult`/`BacktestListItem`/`JobStatus`/`RunInput` defined in T4 and used unchanged in T5–T8; `equity_curve` is `dict[str, list[float]] | None` on the engine/model and `EquityCurveOut | None` on the API.
- **Ruling recorded:** `BacktestMetrics.equity_curve` defaults to `None` (the existing job test constructs `BacktestMetrics` with four arguments); `simulate()` always sets it.
- **Known judgement calls for reviewers:** the chart x-axis is trading-day position (the stored curve has no dates); polling stops on any job error, not only 404; the migration is autogenerate-only and the task stops if it emits anything beyond the single column.
