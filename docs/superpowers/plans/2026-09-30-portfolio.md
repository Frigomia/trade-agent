# Portfolio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Portfolio screens — holdings with live value and P/L, a watchlist, a
value-over-time chart from snapshots, Add holding and Log a trade — plus the two pieces
sub-project 5 deferred here: the Today value tile and the approval screen's "Log the trade I
placed" button.

**Architecture:** One new backend read endpoint (`GET /portfolio/summary`) computes live value,
P/L, weights and totals server-side by reusing the existing cached quote fetch. The frontend reads
it (plus the existing snapshots endpoint) through SWR and writes through the existing portfolio
endpoints with `apiFetch`. Drawers/sheets hold their form state in an inner component so it resets
whenever they close. No new tables, no migration, no chart dependency.

**Tech Stack:** FastAPI, SQLAlchemy 2, Pydantic v2 (backend) · Next.js App Router, TypeScript, MUI,
SWR, Vitest + React Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-09-30-portfolio-design.md`

## Global Constraints

- **This system never places a trade** (root `CLAUDE.md`). Log a trade only records a trade already
  made elsewhere, in past tense — the toggle reads **Bought** / **Sold** — and the sheet says
  exactly: "This only records it here. Nothing is sent to a broker."
- **No currency symbol anywhere; mixed currencies are not converted.** The Portfolio page carries
  the quiet line "Mixed currencies are not converted; totals add amounts as entered."
- Backend: never call real external APIs in tests — every test touching the summary mocks
  `app.routers.portfolio.fetch_quote_and_history`. Never log raw exception text (log
  `type(exc).__name__` only). Pydantic v2 idioms only. `get_summary` is `async def` (it awaits the
  quote fetches) — the same justified exception as the recommendations endpoints; it closes the DB
  session before awaiting quotes.
- Frontend: all backend calls go through `apiFetch`/`ApiError` (no bare `fetch()`); errors show
  inline from `ApiError.detail`, never silently; components are **named exports**, `page.tsx` files
  are default exports; no chart or component-library dependency is added.
- Forms disable their submit button while a request is in flight and ignore a second submit.
- The API returns naive UTC timestamps (`"2026-09-30T08:00:00"`); parse them as UTC.

## Review Focus

- A holding whose quote fails, or returns NaN, must not corrupt totals or weights or 500 the
  endpoint, and must show as an em dash in the UI. Pinned in Task 1 (failed and NaN quote tests) and
  Task 6 (em dash + unpriced note).
- A fully sold holding (0 shares) stays a row in the backend: it must be excluded from totals and
  never priced, hidden from the holdings table, yet still selectable in Log a trade so the user can
  buy back in. Pinned in Task 1 (zero-share test) and Task 6 (hidden in the table, present in the
  trade sheet's ticker options).
- Adding a ticker the user already holds silently overwrites its shares and average cost
  (`POST /portfolio/holdings` is a full replace), and editing must not wipe `sector` or
  `target_weight`. Pinned in Task 5 (replace warning; edit round-trips sector/target weight).
- The automatic daily snapshot must never record a partial total, never fire with no positions, and
  never fire again when moving between Today and Portfolio. Pinned in Task 3.
- Selling more than is held is rejected by the backend with a 422; it must show inline and leave the
  form open. Pinned in Task 4.

---

## File Structure

Backend:
- Modify: `backend/app/schemas.py` — `HoldingSummaryOut`, `WatchlistSummaryOut`, `PortfolioSummaryOut`
- Modify: `backend/app/routers/portfolio.py` — `_prices_for`, `GET /portfolio/summary`
- Modify: `backend/tests/test_portfolio.py` — summary tests
- Modify: `docs/ARCHITECTURE.md` — the new endpoint row
- Modify: `docs/superpowers/specs/2026-09-30-portfolio-design.md` — three extra summary fields

Frontend (all new unless marked):
- `frontend/lib/api/portfolio-types.ts`
- `frontend/lib/format.ts` + `format.test.ts`
- `frontend/components/portfolio/Amount.tsx`
- `frontend/components/portfolio/PortfolioChart.tsx` + test
- `frontend/lib/portfolio/useDailySnapshot.ts` + test
- `frontend/components/portfolio/TradeSheet.tsx` + test
- `frontend/components/portfolio/HoldingForm.tsx` + test
- `frontend/app/(shell)/portfolio/page.tsx` (replaces the placeholder) + test
- `frontend/components/portfolio/PortfolioTile.tsx` + test
- Modify: `frontend/app/(shell)/today/page.tsx` and `page.test.tsx`
- `frontend/components/portfolio/LogTradeCta.tsx` + test
- Modify: `frontend/components/recommendations/ConfirmationPanel.tsx` and `.test.tsx`
- Modify: `frontend/app/(shell)/today/[id]/page.test.tsx`

---

### Task 1: Backend — `GET /portfolio/summary`

**Files:**
- Modify: `backend/app/schemas.py` (add three classes after `PortfolioSnapshotOut`)
- Modify: `backend/app/routers/portfolio.py`
- Test: `backend/tests/test_portfolio.py` (append)
- Modify: `docs/ARCHITECTURE.md`, `docs/superpowers/specs/2026-09-30-portfolio-design.md`

**Interfaces:**
- Consumes: `app.agents.market_data.fetch_quote_and_history(ticker) -> {"price": float | None,
  "closes": list[float]}` (already imported into `portfolio.py`), `Holding`, `WatchlistItem`.
- Produces: `GET /portfolio/summary` → `PortfolioSummaryOut` (below); every later frontend task
  consumes exactly these field names.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_portfolio.py` (it already imports `pytest`, `date`, `AsyncMock`,
`patch`, `Holding`, `OTHER_USER_ID`):

```python
def _hold(client, ticker, shares, cost_basis):
    client.post(
        "/portfolio/holdings",
        json={
            "ticker": ticker,
            "name": ticker,
            "asset_type": "STOCK",
            "shares": shares,
            "cost_basis": cost_basis,
            "first_purchase_date": "2024-01-01",
        },
    )


def _summary(client, prices):
    """GET /portfolio/summary with quotes faked from {ticker: price or an Exception}."""

    async def fake_quote(ticker):
        value = prices[ticker]
        if isinstance(value, Exception):
            raise value
        return {"price": value, "closes": [value]}

    with patch(
        "app.routers.portfolio.fetch_quote_and_history", AsyncMock(side_effect=fake_quote)
    ) as mock:
        response = client.get("/portfolio/summary")
    return response, mock


def test_summary_empty_portfolio(client):
    response, mock = _summary(client, {})

    assert response.status_code == 200
    assert response.json() == {
        "holdings": [],
        "watchlist": [],
        "total_market_value": 0,
        "total_cost_basis": 0,
        "total_pl": 0,
        "total_pl_pct": None,
        "unpriced_count": 0,
    }
    mock.assert_not_awaited()


def test_summary_computes_value_pl_and_weights(client):
    _hold(client, "AAPL", 10, 150.0)
    _hold(client, "MSFT", 5, 400.0)

    response, _ = _summary(client, {"AAPL": 200.0, "MSFT": 380.0})

    body = response.json()
    aapl, msft = body["holdings"]  # ordered by ticker
    assert aapl["ticker"] == "AAPL"
    assert aapl["first_purchase_date"] == "2024-01-01"
    assert aapl["market_value"] == 2000.0
    assert aapl["unrealized_pl"] == 500.0
    assert aapl["unrealized_pl_pct"] == pytest.approx(500 / 1500 * 100)
    assert aapl["weight"] == pytest.approx(2000 / 3900)
    assert msft["unrealized_pl"] == -100.0
    assert body["total_market_value"] == 3900.0
    assert body["total_cost_basis"] == 3500.0
    assert body["total_pl"] == 400.0
    assert body["total_pl_pct"] == pytest.approx(400 / 3500 * 100)
    assert body["unpriced_count"] == 0


def test_summary_leaves_a_failed_quote_out_of_the_totals(client):
    _hold(client, "AAPL", 10, 150.0)
    _hold(client, "MSFT", 5, 400.0)

    response, _ = _summary(client, {"AAPL": 200.0, "MSFT": RuntimeError("yfinance is down")})

    body = response.json()
    assert response.status_code == 200
    msft = next(h for h in body["holdings"] if h["ticker"] == "MSFT")
    assert msft["current_price"] is None
    assert msft["market_value"] is None
    assert msft["weight"] is None
    assert body["unpriced_count"] == 1
    assert body["total_market_value"] == 2000.0
    assert body["total_cost_basis"] == 1500.0  # MSFT's cost is left out too: like with like


def test_summary_treats_a_nan_price_as_unpriced_not_a_500(client):
    _hold(client, "AAPL", 10, 150.0)

    response, _ = _summary(client, {"AAPL": float("nan")})

    assert response.status_code == 200
    assert response.json()["unpriced_count"] == 1
    assert response.json()["holdings"][0]["current_price"] is None


def test_summary_fetches_each_ticker_once_and_prices_the_watchlist(client):
    _hold(client, "AAPL", 10, 150.0)
    client.post("/portfolio/watchlist", json={"ticker": "AAPL", "asset_type": "STOCK"})
    client.post(
        "/portfolio/watchlist", json={"ticker": "ASML", "asset_type": "STOCK", "note": "chips"}
    )

    response, mock = _summary(client, {"AAPL": 200.0, "ASML": 700.0})

    assert mock.await_count == 2  # AAPL is held and watched, but fetched once
    watch = {w["ticker"]: w for w in response.json()["watchlist"]}
    assert watch["ASML"]["current_price"] == 700.0
    assert watch["ASML"]["note"] == "chips"


def test_summary_excludes_a_sold_out_holding_from_totals_and_never_prices_it(client):
    _hold(client, "AAPL", 10, 150.0)
    _hold(client, "OLD", 0, 10.0)

    response, mock = _summary(client, {"AAPL": 200.0})

    body = response.json()
    old = next(h for h in body["holdings"] if h["ticker"] == "OLD")
    assert old["current_price"] is None
    assert body["unpriced_count"] == 0  # a closed position is not "unpriced"
    assert body["total_market_value"] == 2000.0
    mock.assert_awaited_once_with("AAPL")


def test_summary_excludes_other_users_holdings(client, db_session):
    db_session.add(
        Holding(
            user_id=OTHER_USER_ID,
            ticker="ZZZZ",
            name="Theirs",
            asset_type="STOCK",
            shares=1,
            cost_basis=1,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    db_session.commit()

    response, mock = _summary(client, {})

    assert response.json()["holdings"] == []
    mock.assert_not_awaited()


def test_summary_requires_authentication(anon_client):
    assert anon_client.get("/portfolio/summary").status_code == 401
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `uv run python -m pytest tests/test_portfolio.py -k summary -v`
Expected: FAIL — `GET /portfolio/summary` is a 404/405 (route doesn't exist).

- [ ] **Step 3: Add the schemas**

In `backend/app/schemas.py`, directly after `PortfolioSnapshotOut`, add:

```python
class HoldingSummaryOut(BaseModel):
    ticker: str
    name: str
    asset_type: str
    shares: float
    cost_basis: float  # average cost per share
    # Carried so an edit can round-trip them: POST /portfolio/holdings is a full replace.
    first_purchase_date: date
    sector: str | None
    target_weight: float | None
    # Computed at request time, never stored; all None when the quote fails (or shares == 0).
    current_price: float | None = None
    market_value: float | None = None
    unrealized_pl: float | None = None
    unrealized_pl_pct: float | None = None
    weight: float | None = None


class WatchlistSummaryOut(BaseModel):
    ticker: str
    asset_type: str
    note: str | None
    current_price: float | None = None


class PortfolioSummaryOut(BaseModel):
    holdings: list[HoldingSummaryOut]
    watchlist: list[WatchlistSummaryOut]
    # Totals cover only priced, open (shares > 0) holdings — cost basis included, so P/L
    # compares like with like. unpriced_count says how many open holdings were left out.
    total_market_value: float
    total_cost_basis: float
    total_pl: float
    total_pl_pct: float | None
    unpriced_count: int
```

- [ ] **Step 4: Add the endpoint**

In `backend/app/routers/portfolio.py`: add `import asyncio` and `import logging` next to
`import math`; add `HoldingSummaryOut`, `PortfolioSummaryOut`, `WatchlistSummaryOut` to the
`from app.schemas import (...)` list (keep it alphabetical); add `logger = logging.getLogger(__name__)`
right after the imports; then add these two functions after `list_snapshots`:

```python
async def _prices_for(tickers: set[str]) -> dict[str, float | None]:
    """Live price per ticker; None when the fetch fails or returns a non-finite price."""
    ordered = sorted(tickers)

    async def one(ticker: str) -> float | None:
        try:
            data = await fetch_quote_and_history(ticker)
        except Exception as exc:
            logger.warning("Live price fetch failed for %s: %s", ticker, type(exc).__name__)
            return None
        price = data.get("price")
        # NaN/inf would survive the Redis JSON round-trip and then fail response serialization.
        return price if price is not None and math.isfinite(price) else None

    results = await asyncio.gather(*(one(t) for t in ordered))
    return dict(zip(ordered, results, strict=True))


@router.get("/summary", response_model=PortfolioSummaryOut)
async def get_summary(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> PortfolioSummaryOut:
    holdings = db.query(Holding).filter_by(user_id=user.id).order_by(Holding.ticker).all()
    watchlist = (
        db.query(WatchlistItem).filter_by(user_id=user.id).order_by(WatchlistItem.ticker).all()
    )
    rows = [
        HoldingSummaryOut(
            ticker=h.ticker,
            name=h.name,
            asset_type=h.asset_type,
            shares=float(h.shares),
            cost_basis=float(h.cost_basis),
            first_purchase_date=h.first_purchase_date,
            sector=h.sector,
            target_weight=float(h.target_weight) if h.target_weight is not None else None,
        )
        for h in holdings
    ]
    watch_rows = [
        WatchlistSummaryOut(ticker=w.ticker, asset_type=w.asset_type, note=w.note)
        for w in watchlist
    ]
    # Everything needed is copied out; release the pooled connection before awaiting quotes, which
    # can take seconds (retries) during a market-data outage.
    db.close()

    open_rows = [r for r in rows if r.shares > 0]  # a fully sold holding stays a row, unpriced
    prices = await _prices_for({r.ticker for r in open_rows} | {w.ticker for w in watch_rows})

    for w in watch_rows:
        w.current_price = prices[w.ticker]

    total_market_value = 0.0
    total_cost_basis = 0.0
    for r in open_rows:
        price = prices[r.ticker]
        if price is None:
            continue
        market_value = r.shares * price
        cost = r.shares * r.cost_basis
        r.current_price = price
        r.market_value = market_value
        r.unrealized_pl = market_value - cost
        r.unrealized_pl_pct = (market_value - cost) / cost * 100 if cost > 0 else None
        total_market_value += market_value
        total_cost_basis += cost

    if total_market_value > 0:
        for r in open_rows:
            if r.market_value is not None:
                r.weight = r.market_value / total_market_value

    total_pl = total_market_value - total_cost_basis
    return PortfolioSummaryOut(
        holdings=rows,
        watchlist=watch_rows,
        total_market_value=total_market_value,
        total_cost_basis=total_cost_basis,
        total_pl=total_pl,
        total_pl_pct=total_pl / total_cost_basis * 100 if total_cost_basis > 0 else None,
        unpriced_count=sum(1 for r in open_rows if r.current_price is None),
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run python -m pytest tests/test_portfolio.py -v`
Expected: PASS, every test in the file (the 8 new summary tests and all pre-existing ones).

- [ ] **Step 6: Docs**

In `docs/ARCHITECTURE.md`, insert this row directly after the `GET /portfolio/snapshots` row
(`| GET | \`/portfolio/snapshots\` | — | Lists all portfolio snapshots, oldest first, for displaying portfolio value over time |`):

```
| GET | `/portfolio/summary` | — | Holdings and watchlist with live prices, plus totals. Per holding: stored fields (incl. `first_purchase_date`, `sector`, `target_weight`) and computed, never-persisted `current_price`, `market_value`, `unrealized_pl`, `unrealized_pl_pct`, `weight`; watchlist items carry `current_price`. Totals (`total_market_value`, `total_cost_basis`, `total_pl`, `total_pl_pct`) cover priced holdings with shares > 0 only; `unpriced_count` says how many were left out. A failed or non-finite quote leaves that holding's computed fields `null` — never a 500. Reuses the 5-minute cached quote fetch; no currency conversion |
```

In `docs/superpowers/specs/2026-09-30-portfolio-design.md`, in the Backend section's `holdings:`
bullet, after "`cost_basis` (average cost per share)," insert: "`first_purchase_date`, `sector` and
`target_weight` (carried so an edit can round-trip them — `POST /portfolio/holdings` is a full
replace and would otherwise wipe sector and target weight),".

- [ ] **Step 7: Lint, format, type-check, full backend suite**

Run: `uv run ruff check . && uv run ruff format . && uv run mypy app && uv run python -m pytest tests/ -q`
Expected: all clean/passing.

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/portfolio.py backend/tests/test_portfolio.py docs/ARCHITECTURE.md docs/superpowers/specs/2026-09-30-portfolio-design.md
git commit -m "feat: GET /portfolio/summary with live value, P/L and weights"
```

---

### Task 2: Frontend foundations — types, formatting, `Amount`, `PortfolioChart`

**Files:**
- Create: `frontend/lib/api/portfolio-types.ts`, `frontend/lib/format.ts`,
  `frontend/lib/format.test.ts`, `frontend/components/portfolio/Amount.tsx`,
  `frontend/components/portfolio/PortfolioChart.tsx`,
  `frontend/components/portfolio/PortfolioChart.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier frontend tasks (Task 1's JSON shape is mirrored field-for-field).
- Produces: the types below; `formatAmount(n): string`, `formatSigned(n): string`,
  `formatPct(n): string`; `<Amount value size? />`; `collapseByDay(snapshots): Snapshot[]`;
  `<PortfolioChart snapshots variant? />` (`variant: "full" | "sparkline"`, default `"full"`).

- [ ] **Step 1: Write the types**

```typescript
// frontend/lib/api/portfolio-types.ts
export type AssetType = "ETF" | "STOCK";
export type TradeAction = "BUY" | "SELL";

export interface HoldingSummary {
  ticker: string;
  name: string;
  asset_type: AssetType;
  shares: number;
  cost_basis: number; // average cost per share
  first_purchase_date: string; // "2024-01-01"
  sector: string | null;
  target_weight: number | null;
  current_price: number | null;
  market_value: number | null;
  unrealized_pl: number | null;
  unrealized_pl_pct: number | null;
  weight: number | null;
}

export interface WatchlistSummary {
  ticker: string;
  asset_type: AssetType;
  note: string | null;
  current_price: number | null;
}

export interface PortfolioSummary {
  holdings: HoldingSummary[];
  watchlist: WatchlistSummary[];
  total_market_value: number;
  total_cost_basis: number;
  total_pl: number;
  total_pl_pct: number | null;
  unpriced_count: number;
}

export interface Snapshot {
  id: number;
  created_at: string; // naive UTC, e.g. "2026-09-30T08:00:00"
  total_market_value: number;
  total_cost_basis: number;
}
```

- [ ] **Step 2: Write the failing format tests**

```typescript
// frontend/lib/format.test.ts
import { describe, it, expect } from "vitest";
import { formatAmount, formatPct, formatSigned } from "./format";

describe("format", () => {
  it("formats amounts with thousands separators and two decimals, no currency symbol", () => {
    expect(formatAmount(10204.1)).toBe("10,204.10");
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(-103.2)).toBe("-103.20");
  });

  it("signs positive amounts explicitly", () => {
    expect(formatSigned(551.7)).toBe("+551.70");
    expect(formatSigned(-103.2)).toBe("-103.20");
    expect(formatSigned(0)).toBe("+0.00");
  });

  it("formats percentages with one decimal and an explicit sign", () => {
    expect(formatPct(5.72)).toBe("+5.7%");
    expect(formatPct(-9.6)).toBe("-9.6%");
    expect(formatPct(0)).toBe("+0.0%");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run (from `frontend/`): `npm test -- run lib/format.test.ts`
Expected: FAIL — `./format` doesn't exist.

- [ ] **Step 4: Implement format and Amount**

```typescript
// frontend/lib/format.ts
// No currency symbol, by design: totals add amounts as entered across currencies (spec).
const AMOUNT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(value: number): string {
  return AMOUNT.format(value);
}

export function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatAmount(value)}`;
}

export function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
```

```tsx
// frontend/components/portfolio/Amount.tsx
import { formatAmount } from "@/lib/format";

// Whole part at full strength, decimals dimmed — the mockups' "10,204.10" treatment.
export function Amount({ value, size }: { value: number; size?: number }) {
  const [whole, decimals] = formatAmount(value).split(".");
  return (
    <span style={size ? { fontSize: size, fontWeight: 650 } : undefined}>
      {whole}
      <span style={{ opacity: 0.5 }}>.{decimals}</span>
    </span>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- run lib/format.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing chart tests**

```tsx
// frontend/components/portfolio/PortfolioChart.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Snapshot } from "@/lib/api/portfolio-types";
import { PortfolioChart, collapseByDay } from "./PortfolioChart";

let nextId = 1;
function snap(created_at: string, value: number): Snapshot {
  return { id: nextId++, created_at, total_market_value: value, total_cost_basis: 1000 };
}

function pointCount(container: HTMLElement): number {
  const points = container.querySelector("polyline")?.getAttribute("points") ?? "";
  return points.trim() === "" ? 0 : points.trim().split(" ").length;
}

describe("PortfolioChart", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    nextId = 1;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses same-day snapshots to the last one of that day, oldest first", () => {
    const collapsed = collapseByDay([
      snap("2026-09-29T18:00:00", 105),
      snap("2026-09-28T09:00:00", 100),
      snap("2026-09-29T08:00:00", 103),
    ]);

    expect(collapsed.map((s) => s.total_market_value)).toEqual([100, 105]);
  });

  it("explains itself instead of drawing a fake line with fewer than two points", () => {
    render(<PortfolioChart snapshots={[snap("2026-09-29T08:00:00", 100)]} />);

    expect(screen.getByText(/record a snapshot to start your history/i)).toBeInTheDocument();
  });

  it("draws one point per day", () => {
    const { container } = render(
      <PortfolioChart
        snapshots={[
          snap("2026-09-28T09:00:00", 100),
          snap("2026-09-29T08:00:00", 103),
          snap("2026-09-29T18:00:00", 105),
        ]}
      />,
    );

    expect(pointCount(container)).toBe(2);
  });

  it("filters by the selected range", () => {
    const snapshots = [
      snap("2025-01-01T00:00:00", 50),
      snap("2026-09-01T00:00:00", 90),
      snap("2026-09-29T00:00:00", 100),
    ];
    const { container } = render(<PortfolioChart snapshots={snapshots} />);

    expect(pointCount(container)).toBe(2); // default 3M: the 2025 point is out
    fireEvent.click(screen.getByText("All"));
    expect(pointCount(container)).toBe(3);
    fireEvent.click(screen.getByText("1W"));
    expect(screen.getByText(/record a snapshot to start your history/i)).toBeInTheDocument();
  });

  it("the sparkline variant has no range chips and draws nothing under two points", () => {
    const { container, rerender } = render(
      <PortfolioChart
        variant="sparkline"
        snapshots={[snap("2026-09-28T09:00:00", 100), snap("2026-09-29T08:00:00", 103)]}
      />,
    );

    expect(pointCount(container)).toBe(2);
    expect(screen.queryByText("1W")).not.toBeInTheDocument();

    rerender(<PortfolioChart variant="sparkline" snapshots={[snap("2026-09-29T08:00:00", 1)]} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm test -- run components/portfolio/PortfolioChart.test.tsx`
Expected: FAIL — `./PortfolioChart` doesn't exist.

- [ ] **Step 8: Implement PortfolioChart**

```tsx
// frontend/components/portfolio/PortfolioChart.tsx
"use client";

import { useState } from "react";
import { Box, Chip, Typography } from "@mui/material";
import type { Snapshot } from "@/lib/api/portfolio-types";

const RANGES = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
  { label: "All", days: null },
] as const;
type RangeLabel = (typeof RANGES)[number]["label"];

// The API returns naive UTC timestamps; Date.parse would otherwise read them as local time.
function toTime(iso: string): number {
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : `${iso}Z`);
}

// One point per UTC day (the day's last snapshot), oldest first.
export function collapseByDay(snapshots: Snapshot[]): Snapshot[] {
  const byDay = new Map<string, Snapshot>();
  const ordered = [...snapshots].sort(
    (a, b) => toTime(a.created_at) - toTime(b.created_at) || a.id - b.id,
  );
  for (const snapshot of ordered) {
    byDay.set(snapshot.created_at.slice(0, 10), snapshot);
  }
  return [...byDay.values()];
}

export function PortfolioChart({
  snapshots,
  variant = "full",
}: {
  snapshots: Snapshot[];
  variant?: "full" | "sparkline";
}) {
  const [range, setRange] = useState<RangeLabel>("3M");
  const [now] = useState(() => Date.now());
  const full = variant === "full";

  const days = RANGES.find((r) => r.label === range)?.days ?? null;
  const cutoff = full && days !== null ? now - days * 86_400_000 : -Infinity;
  const points = collapseByDay(snapshots).filter((s) => toTime(s.created_at) >= cutoff);

  const chips = full && (
    <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
      {RANGES.map((r) => (
        <Chip
          key={r.label}
          label={r.label}
          size="small"
          onClick={() => setRange(r.label)}
          color={range === r.label ? "primary" : "default"}
        />
      ))}
    </Box>
  );

  if (points.length < 2) {
    if (!full) return null;
    return (
      <Box>
        <Typography sx={{ fontSize: 13, color: "var(--muted)", py: 3 }}>
          Record a snapshot to start your history.
        </Typography>
        {chips}
      </Box>
    );
  }

  const values = points.map((p) => p.total_market_value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const coords = points.map(
    (p, i) => `${(i / (points.length - 1)) * 100},${40 - ((p.total_market_value - min) / span) * 36}`,
  );

  return (
    <Box>
      <svg
        role="img"
        aria-label="Portfolio value over time"
        viewBox="0 0 100 44"
        preserveAspectRatio="none"
        style={{ width: "100%", height: full ? 120 : 36, display: "block" }}
      >
        <polygon points={`0,44 ${coords.join(" ")} 100,44`} fill="var(--accent)" opacity={0.12} />
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {chips}
    </Box>
  );
}
```

`useState(() => Date.now())` (not a bare `Date.now()` in the render body) is deliberate: it keeps
the component pure for the `react-hooks` lint rules and freezes "now" at mount.

- [ ] **Step 9: Run to verify it passes**

Run: `npm test -- run components/portfolio/PortfolioChart.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 10: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add frontend/lib/api/portfolio-types.ts frontend/lib/format.ts frontend/lib/format.test.ts frontend/components/portfolio/Amount.tsx frontend/components/portfolio/PortfolioChart.tsx frontend/components/portfolio/PortfolioChart.test.tsx
git commit -m "feat: portfolio types, amount formatting and the value-over-time chart"
```

---

### Task 3: `useDailySnapshot`

**Files:**
- Create: `frontend/lib/portfolio/useDailySnapshot.ts`, `frontend/lib/portfolio/useDailySnapshot.test.tsx`

**Interfaces:**
- Consumes: `PortfolioSummary`, `Snapshot` (Task 2); `apiFetch` (existing).
- Produces: `useDailySnapshot(): void` and `resetDailySnapshotGuard(): void` (test-only reset of
  the module-level once-per-day guard). Reads `/portfolio/summary` and `/portfolio/snapshots` with
  the same SWR keys as everything else, so it shares their cache.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/lib/portfolio/useDailySnapshot.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { useDailySnapshot, resetDailySnapshotGuard } from "./useDailySnapshot";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
  );
}

function summary(overrides: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    holdings: [
      {
        ticker: "AAPL",
        name: "Apple",
        asset_type: "STOCK",
        shares: 10,
        cost_basis: 150,
        first_purchase_date: "2024-01-01",
        sector: null,
        target_weight: null,
        current_price: 200,
        market_value: 2000,
        unrealized_pl: 500,
        unrealized_pl_pct: 33,
        weight: 1,
      },
    ],
    watchlist: [],
    total_market_value: 2000,
    total_cost_basis: 1500,
    total_pl: 500,
    total_pl_pct: 33,
    unpriced_count: 0,
    ...overrides,
  };
}

function snapshot(created_at: string): Snapshot {
  return { id: 1, created_at, total_market_value: 1, total_cost_basis: 1 };
}

function serve(sum: PortfolioSummary, snaps: Snapshot[]) {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/portfolio/summary") return Promise.resolve(sum);
    if (path === "/portfolio/snapshots") return Promise.resolve(snaps);
    if (path === "/portfolio/snapshot" && init?.method === "POST") return Promise.resolve({});
    return Promise.reject(new Error("unexpected " + path));
  });
}

function posts(): unknown[][] {
  return apiFetch.mock.calls.filter((c) => c[0] === "/portfolio/snapshot");
}

// For "does nothing" assertions: wait until both reads happened, then give the hook's effect a
// real moment to (not) act, so the assertion can't pass just because it ran too early. Only Date is
// faked in these tests, so this timeout is real.
async function settled() {
  await waitFor(() => {
    expect(apiFetch.mock.calls.some((c) => c[0] === "/portfolio/summary")).toBe(true);
    expect(apiFetch.mock.calls.some((c) => c[0] === "/portfolio/snapshots")).toBe(true);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("useDailySnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDailySnapshotGuard();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records a snapshot when the latest one is from a previous day", async () => {
    serve(summary(), [snapshot("2026-09-29T09:00:00")]);
    renderHook(() => useDailySnapshot(), { wrapper });

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
  });

  it("records one when there are no snapshots yet", async () => {
    serve(summary(), []);
    renderHook(() => useDailySnapshot(), { wrapper });

    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  it("does nothing when a snapshot from today already exists", async () => {
    serve(summary(), [snapshot("2026-09-30T08:00:00")]);
    renderHook(() => useDailySnapshot(), { wrapper });

    await settled();
    expect(posts()).toHaveLength(0);
  });

  it("never records a partial total when a holding is unpriced", async () => {
    serve(summary({ unpriced_count: 1 }), [snapshot("2026-09-29T09:00:00")]);
    renderHook(() => useDailySnapshot(), { wrapper });

    await settled();
    expect(posts()).toHaveLength(0);
  });

  it("does nothing with no open positions", async () => {
    serve(summary({ holdings: [] }), []);
    renderHook(() => useDailySnapshot(), { wrapper });

    await settled();
    expect(posts()).toHaveLength(0);
  });

  it("does not try again when Today and Portfolio each mount the hook the same day", async () => {
    serve(summary(), [snapshot("2026-09-29T09:00:00")]);
    const first = renderHook(() => useDailySnapshot(), { wrapper });
    await waitFor(() => expect(posts()).toHaveLength(1));
    first.unmount();

    // The mocked snapshot list is still "stale", so only the once-per-day guard can stop a second POST.
    renderHook(() => useDailySnapshot(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(posts()).toHaveLength(1);
  });

  it("swallows a failed snapshot request", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === "/portfolio/summary") return Promise.resolve(summary());
      if (path === "/portfolio/snapshots") return Promise.resolve([]);
      return Promise.reject(new Error("No current price available for AAPL"));
    });
    renderHook(() => useDailySnapshot(), { wrapper });

    await waitFor(() => expect(posts()).toHaveLength(1));
    // No unhandled rejection: the test finishing without error is the assertion.
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- run lib/portfolio/useDailySnapshot.test.tsx`
Expected: FAIL — `./useDailySnapshot` doesn't exist.

- [ ] **Step 3: Implement the hook**

```typescript
// frontend/lib/portfolio/useDailySnapshot.ts
"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";

// Module-level so moving between Today and Portfolio (each mounts the hook) never retries the same
// day, whether the first attempt worked or not.
let attemptedDay: string | null = null;

/** For tests: forget that a snapshot was already attempted today. */
export function resetDailySnapshotGuard(): void {
  attemptedDay = null;
}

/**
 * Records at most one portfolio snapshot per UTC day, best effort, when Today or Portfolio is
 * opened — there is no backend scheduler, so this is what fills the value-over-time chart. Never
 * records a partial total (any unpriced holding) or an empty portfolio. Two tabs racing can create
 * two same-day snapshots; harmless, the chart keeps the last point per day. Failures are silent —
 * the manual Record snapshot button is where errors show.
 */
export function useDailySnapshot(): void {
  const { data: summary } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const { data: snapshots, mutate } = useSWR<Snapshot[]>("/portfolio/snapshots", apiFetch);

  useEffect(() => {
    if (!summary || !snapshots) return;
    if (!summary.holdings.some((h) => h.shares > 0) || summary.unpriced_count > 0) return;

    const today = new Date().toISOString().slice(0, 10);
    const latest = snapshots.at(-1); // the API lists oldest first
    if (latest && latest.created_at.slice(0, 10) === today) return;
    if (attemptedDay === today) return;

    attemptedDay = today;
    apiFetch("/portfolio/snapshot", { method: "POST" })
      .then(() => mutate())
      .catch(() => {});
  }, [summary, snapshots, mutate]);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- run lib/portfolio/useDailySnapshot.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/portfolio/useDailySnapshot.ts frontend/lib/portfolio/useDailySnapshot.test.tsx
git commit -m "feat: automatic once-a-day portfolio snapshot"
```

---

### Task 4: `TradeSheet` (Log a trade)

**Files:**
- Create: `frontend/components/portfolio/TradeSheet.tsx`, `frontend/components/portfolio/TradeSheet.test.tsx`

**Interfaces:**
- Consumes: `TradeAction` (Task 2); `apiFetch`/`ApiError` (existing).
- Produces: `TradeSheet({ open, onClose, holdings, prefill?, onLogged })`:
  `holdings: { ticker: string; name: string }[]`, `prefill?: { ticker?: string; action?:
  TradeAction }`, `onLogged: () => void`. Consumed by Tasks 6 and 8. It posts to
  `POST /portfolio/trades` with `{ date, ticker, action, shares, price }` and, on success, calls
  `onLogged()` then `onClose()`.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/components/portfolio/TradeSheet.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import { TradeSheet } from "./TradeSheet";

const HOLDINGS = [
  { ticker: "AAPL", name: "Apple Inc." },
  { ticker: "OLD", name: "Sold Out Co" },
];

function setup(props: Partial<React.ComponentProps<typeof TradeSheet>> = {}) {
  const onClose = vi.fn();
  const onLogged = vi.fn();
  render(
    <TradeSheet open onClose={onClose} holdings={HOLDINGS} onLogged={onLogged} {...props} />,
  );
  return { onClose, onLogged };
}

function fill(shares: string, price: string) {
  fireEvent.change(screen.getByLabelText("Shares"), { target: { value: shares } });
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: price } });
}

function sentBody() {
  return JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string);
}

describe("TradeSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says plainly that it only records a trade and sends nothing to a broker", () => {
    setup();

    expect(screen.getByText(/this only records it here/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is sent to a broker/i)).toBeInTheDocument();
  });

  it("lists every holding, including a sold-out one, so the user can buy back in", () => {
    setup();

    expect(screen.getByRole("option", { name: /AAPL/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /OLD/ })).toBeInTheDocument();
  });

  it("applies the prefill and defaults the date to today", () => {
    setup({ prefill: { ticker: "OLD", action: "SELL" } });

    expect(screen.getByLabelText("Ticker")).toHaveValue("OLD");
    expect(screen.getByRole("button", { name: "Sold" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-09-30");
  });

  it("logs a purchase, then reports it and closes", async () => {
    apiFetch.mockResolvedValue({});
    const { onClose, onLogged } = setup();

    fill("3", "121.6");
    fireEvent.click(screen.getByRole("button", { name: /save to log/i }));

    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    expect(apiFetch.mock.calls[0][0]).toBe("/portfolio/trades");
    expect(sentBody()).toEqual({
      date: "2026-09-30",
      ticker: "AAPL",
      action: "BUY",
      shares: 3,
      price: 121.6,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("logs a sale when Sold is selected", async () => {
    apiFetch.mockResolvedValue({});
    const { onLogged } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Sold" }));
    fill("2", "130");
    fireEvent.click(screen.getByRole("button", { name: /save to log/i }));

    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    expect(sentBody().action).toBe("SELL");
  });

  it("shows the backend's message and stays open when selling more than is held", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(422, "Cannot sell 50.0; holding has 10.0"));
    const { onClose, onLogged } = setup({ prefill: { ticker: "AAPL", action: "SELL" } });

    fill("50", "130");
    fireEvent.click(screen.getByRole("button", { name: /save to log/i }));

    await waitFor(() =>
      expect(screen.getByText("Cannot sell 50.0; holding has 10.0")).toBeInTheDocument(),
    );
    expect(onLogged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not send a request for empty or non-positive numbers", () => {
    setup();

    fill("", "");
    fireEvent.click(screen.getByRole("button", { name: /save to log/i }));
    expect(screen.getByText(/enter shares and a price above zero/i)).toBeInTheDocument();

    fill("0", "10");
    fireEvent.click(screen.getByRole("button", { name: /save to log/i }));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("ignores a second click while the first request is still in flight", async () => {
    let resolve!: (value: unknown) => void;
    apiFetch.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();

    fill("3", "121.6");
    const save = screen.getByRole("button", { name: /save to log/i });
    fireEvent.click(save);
    fireEvent.click(save);
    resolve({});

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- run components/portfolio/TradeSheet.test.tsx`
Expected: FAIL — `./TradeSheet` doesn't exist.

- [ ] **Step 3: Implement TradeSheet**

```tsx
// frontend/components/portfolio/TradeSheet.tsx
"use client";

import { useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Drawer,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { TradeAction } from "@/lib/api/portfolio-types";

export interface TradeSheetProps {
  open: boolean;
  onClose: () => void;
  holdings: { ticker: string; name: string }[];
  prefill?: { ticker?: string; action?: TradeAction };
  onLogged: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

// A bottom sheet on phones, a right drawer on desktop. The form lives in an inner component so its
// state resets every time the drawer closes (MUI unmounts a closed drawer's children).
export function TradeSheet({ open, onClose, holdings, prefill, onLogged }: TradeSheetProps) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down("md"));
  return (
    <Drawer anchor={isPhone ? "bottom" : "right"} open={open} onClose={onClose}>
      <TradeForm holdings={holdings} prefill={prefill} onClose={onClose} onLogged={onLogged} />
    </Drawer>
  );
}

function TradeForm({
  holdings,
  prefill,
  onClose,
  onLogged,
}: Pick<TradeSheetProps, "holdings" | "prefill" | "onClose" | "onLogged">) {
  const [ticker, setTicker] = useState(prefill?.ticker ?? holdings[0]?.ticker ?? "");
  const [action, setAction] = useState<TradeAction>(prefill?.action ?? "BUY");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const sharesNum = Number(shares);
    const priceNum = Number(price);
    if (!ticker || !(sharesNum > 0) || !(priceNum > 0)) {
      setError("Choose a ticker and enter shares and a price above zero.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/portfolio/trades", {
        method: "POST",
        body: JSON.stringify({ date, ticker, action, shares: sharesNum, price: priceNum }),
      });
      onLogged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{ width: { xs: "auto", md: 400 }, p: 3, pb: { xs: 4, md: 3 } }}
    >
      <Typography variant="h6" sx={{ fontWeight: 650 }}>
        Log a trade
      </Typography>
      <Typography sx={{ color: "var(--muted)", fontSize: 13, mt: 0.5 }}>
        Record a trade you already placed in your broker app.
      </Typography>
      <Alert severity="info" sx={{ mt: 1.5 }}>
        This only records it here. Nothing is sent to a broker.
      </Alert>
      <TextField
        select
        SelectProps={{ native: true }}
        InputLabelProps={{ shrink: true }}
        label="Ticker"
        value={ticker}
        onChange={(e) => setTicker(e.target.value)}
        fullWidth
        margin="normal"
      >
        {holdings.map((h) => (
          <option key={h.ticker} value={h.ticker}>
            {h.ticker} · {h.name}
          </option>
        ))}
      </TextField>
      <ToggleButtonGroup
        exclusive
        fullWidth
        value={action}
        onChange={(_, next: TradeAction | null) => next && setAction(next)}
        sx={{ mt: 1 }}
      >
        <ToggleButton value="BUY">Bought</ToggleButton>
        <ToggleButton value="SELL">Sold</ToggleButton>
      </ToggleButtonGroup>
      <Box sx={{ display: "flex", gap: 1.5 }}>
        <TextField
          label="Shares"
          type="number"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          fullWidth
          margin="normal"
        />
        <TextField
          label="Price"
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          fullWidth
          margin="normal"
        />
      </Box>
      <TextField
        label="Date"
        type="date"
        InputLabelProps={{ shrink: true }}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        fullWidth
        margin="normal"
      />
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
        Save to log
      </Button>
    </Box>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- run components/portfolio/TradeSheet.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/portfolio/TradeSheet.tsx frontend/components/portfolio/TradeSheet.test.tsx
git commit -m "feat: Log a trade sheet"
```

---

### Task 5: `HoldingForm` (Add / Edit / Remove holding)

**Files:**
- Create: `frontend/components/portfolio/HoldingForm.tsx`, `frontend/components/portfolio/HoldingForm.test.tsx`

**Interfaces:**
- Consumes: `HoldingSummary`, `AssetType` (Task 2); `apiFetch`/`ApiError` (existing).
- Produces: `HoldingForm({ open, onClose, holding?, heldTickers, prefillTicker?, onSaved })`:
  `holding?: HoldingSummary` (edit mode), `heldTickers: string[]` (for the replace warning),
  `prefillTicker?: string`, `onSaved: () => void`. Posts `POST /portfolio/holdings`; Remove sends
  `DELETE /portfolio/holdings/{ticker}`. Both call `onSaved()` then `onClose()`. Consumed by Tasks 6
  and 8.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/components/portfolio/HoldingForm.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { HoldingSummary } from "@/lib/api/portfolio-types";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import { HoldingForm } from "./HoldingForm";

const HELD: HoldingSummary = {
  ticker: "AAPL",
  name: "Apple Inc.",
  asset_type: "STOCK",
  shares: 10,
  cost_basis: 150,
  first_purchase_date: "2024-01-15",
  sector: "Technology",
  target_weight: 0.2,
  current_price: 200,
  market_value: 2000,
  unrealized_pl: 500,
  unrealized_pl_pct: 33,
  weight: 1,
};

function setup(props: Partial<React.ComponentProps<typeof HoldingForm>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<HoldingForm open onClose={onClose} heldTickers={[]} onSaved={onSaved} {...props} />);
  return { onClose, onSaved };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function sentBody() {
  return JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string);
}

describe("HoldingForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a holding with an upper-cased ticker", async () => {
    apiFetch.mockResolvedValue({});
    const { onSaved, onClose } = setup();

    type("Ticker", "vwce.de");
    type("Name", "Vanguard FTSE All-World");
    type("Type", "ETF");
    type("Shares", "40");
    type("Average cost", "112.8");
    type("First purchase date", "2024-01-10");
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(apiFetch.mock.calls[0][0]).toBe("/portfolio/holdings");
    expect(sentBody()).toEqual({
      ticker: "VWCE.DE",
      name: "Vanguard FTSE All-World",
      asset_type: "ETF",
      shares: 40,
      cost_basis: 112.8,
      first_purchase_date: "2024-01-10",
      sector: null,
      target_weight: null,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("prefills the ticker", () => {
    setup({ prefillTicker: "NVDA" });

    expect(screen.getByLabelText("Ticker")).toHaveValue("NVDA");
  });

  it("warns that adding a ticker already held replaces it", () => {
    setup({ heldTickers: ["AAPL"] });

    type("Ticker", "aapl");

    expect(screen.getByText(/you already hold AAPL/i)).toBeInTheDocument();
    expect(screen.getByText(/replaces its shares and average cost/i)).toBeInTheDocument();
  });

  it("edits in place: ticker locked, and sector, target weight and purchase date round-trip", async () => {
    apiFetch.mockResolvedValue({});
    const { onSaved } = setup({ holding: HELD, heldTickers: ["AAPL"] });

    expect(screen.getByLabelText("Ticker")).toBeDisabled();
    expect(screen.queryByText(/you already hold/i)).not.toBeInTheDocument();
    type("Shares", "12");
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sentBody()).toEqual({
      ticker: "AAPL",
      name: "Apple Inc.",
      asset_type: "STOCK",
      shares: 12,
      cost_basis: 150,
      first_purchase_date: "2024-01-15",
      sector: "Technology",
      target_weight: 0.2,
    });
  });

  it("does not send a request when a required field is missing", () => {
    setup();

    type("Ticker", "AAPL");
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    expect(screen.getByText(/enter a ticker, a name/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("removes a holding only after an explicit confirm", async () => {
    apiFetch.mockResolvedValue(undefined);
    const { onSaved, onClose } = setup({ holding: HELD });

    fireEvent.click(screen.getByRole("button", { name: /remove holding/i }));
    expect(apiFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /confirm remove/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith(
      "/portfolio/holdings/AAPL",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the backend's error inline and stays open", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(422, "Something is off"));
    const { onSaved } = setup({ holding: HELD });

    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    await waitFor(() => expect(screen.getByText("Something is off")).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("ignores a second click while the first save is in flight", async () => {
    let resolve!: (value: unknown) => void;
    apiFetch.mockReturnValue(new Promise((r) => (resolve = r)));
    setup({ holding: HELD });

    const save = screen.getByRole("button", { name: /save holding/i });
    fireEvent.click(save);
    fireEvent.click(save);
    resolve({});

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- run components/portfolio/HoldingForm.test.tsx`
Expected: FAIL — `./HoldingForm` doesn't exist.

- [ ] **Step 3: Implement HoldingForm**

```tsx
// frontend/components/portfolio/HoldingForm.tsx
"use client";

import { useState, type FormEvent } from "react";
import { Alert, Box, Button, Drawer, TextField, Typography } from "@mui/material";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { AssetType, HoldingSummary } from "@/lib/api/portfolio-types";

export interface HoldingFormProps {
  open: boolean;
  onClose: () => void;
  holding?: HoldingSummary; // edit mode when set
  heldTickers: string[];
  prefillTicker?: string;
  onSaved: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

// The body lives in an inner component so its state resets each time the drawer closes.
export function HoldingForm({ open, onClose, ...rest }: HoldingFormProps) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <HoldingFormBody onClose={onClose} {...rest} />
    </Drawer>
  );
}

function HoldingFormBody({
  holding,
  heldTickers,
  prefillTicker,
  onClose,
  onSaved,
}: Omit<HoldingFormProps, "open">) {
  const editing = holding !== undefined;
  const [ticker, setTicker] = useState(holding?.ticker ?? prefillTicker ?? "");
  const [name, setName] = useState(holding?.name ?? "");
  const [assetType, setAssetType] = useState<AssetType>(holding?.asset_type ?? "STOCK");
  const [shares, setShares] = useState(holding ? String(holding.shares) : "");
  const [costBasis, setCostBasis] = useState(holding ? String(holding.cost_basis) : "");
  const [firstPurchase, setFirstPurchase] = useState(holding?.first_purchase_date ?? today());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const normalizedTicker = ticker.trim().toUpperCase();
  // POST /portfolio/holdings is an upsert: adding a held ticker silently overwrites it.
  const replacesExisting = !editing && heldTickers.includes(normalizedTicker);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const sharesNum = Number(shares);
    const costNum = Number(costBasis);
    if (
      !normalizedTicker ||
      !name.trim() ||
      shares === "" ||
      costBasis === "" ||
      !(sharesNum >= 0) ||
      !(costNum >= 0) ||
      !firstPurchase
    ) {
      setError("Enter a ticker, a name, shares, an average cost and a date.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/portfolio/holdings", {
        method: "POST",
        body: JSON.stringify({
          ticker: normalizedTicker,
          name: name.trim(),
          asset_type: assetType,
          shares: sharesNum,
          cost_basis: costNum,
          first_purchase_date: firstPurchase,
          // The endpoint is a full replace: pass these through or an edit would wipe them.
          sector: holding?.sector ?? null,
          target_weight: holding?.target_weight ?? null,
        }),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    if (!holding || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/portfolio/holdings/${encodeURIComponent(holding.ticker)}`, {
        method: "DELETE",
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ width: { xs: 320, md: 400 }, p: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 650 }}>
        {editing ? `Edit ${holding.ticker}` : "Add holding"}
      </Typography>
      <TextField
        label="Ticker"
        value={ticker}
        onChange={(e) => setTicker(e.target.value)}
        disabled={editing}
        fullWidth
        margin="normal"
      />
      {replacesExisting && (
        <Alert severity="warning">
          You already hold {normalizedTicker}. This replaces its shares and average cost; use Log a
          trade to add to a position.
        </Alert>
      )}
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        fullWidth
        margin="normal"
      />
      <TextField
        select
        SelectProps={{ native: true }}
        InputLabelProps={{ shrink: true }}
        label="Type"
        value={assetType}
        onChange={(e) => setAssetType(e.target.value as AssetType)}
        fullWidth
        margin="normal"
      >
        <option value="STOCK">Stock</option>
        <option value="ETF">ETF</option>
      </TextField>
      <Box sx={{ display: "flex", gap: 1.5 }}>
        <TextField
          label="Shares"
          type="number"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          fullWidth
          margin="normal"
        />
        <TextField
          label="Average cost"
          type="number"
          value={costBasis}
          onChange={(e) => setCostBasis(e.target.value)}
          fullWidth
          margin="normal"
        />
      </Box>
      <TextField
        label="First purchase date"
        type="date"
        InputLabelProps={{ shrink: true }}
        value={firstPurchase}
        onChange={(e) => setFirstPurchase(e.target.value)}
        fullWidth
        margin="normal"
      />
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
        Save holding
      </Button>
      {editing &&
        (confirmingRemove ? (
          <Box sx={{ mt: 2 }}>
            <Typography sx={{ fontSize: 13, mb: 1 }}>
              Remove {holding.ticker}? This can&apos;t be undone.
            </Typography>
            <Button
              color="error"
              variant="contained"
              fullWidth
              disabled={submitting}
              onClick={handleRemove}
            >
              Confirm remove
            </Button>
          </Box>
        ) : (
          <Button color="error" fullWidth sx={{ mt: 2 }} onClick={() => setConfirmingRemove(true)}>
            Remove holding
          </Button>
        ))}
    </Box>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- run components/portfolio/HoldingForm.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/portfolio/HoldingForm.tsx frontend/components/portfolio/HoldingForm.test.tsx
git commit -m "feat: add, edit and remove holding form"
```

---

### Task 6: The Portfolio page

**Files:**
- Modify (replace): `frontend/app/(shell)/portfolio/page.tsx`
- Test: `frontend/app/(shell)/portfolio/page.test.tsx`

**Interfaces:**
- Consumes: `PortfolioSummary`, `Snapshot`, `HoldingSummary`, `AssetType` (Task 2); `Amount`,
  `formatAmount`, `formatSigned`, `formatPct` (Task 2); `PortfolioChart` (Task 2);
  `useDailySnapshot` (Task 3); `TradeSheet` (Task 4); `HoldingForm` (Task 5).
- Produces: the `/portfolio` route — nothing else consumes this file.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/app/(shell)/portfolio/page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));
// Tested on its own; here it would only add unrelated POSTs.
vi.mock("@/lib/portfolio/useDailySnapshot", () => ({ useDailySnapshot: () => {} }));

import PortfolioPage from "./page";

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PortfolioPage />
    </SWRConfig>,
  );
}

const HOLDING_BASE = {
  asset_type: "STOCK" as const,
  first_purchase_date: "2024-01-01",
  sector: null,
  target_weight: null,
};

const SUMMARY: PortfolioSummary = {
  holdings: [
    {
      ...HOLDING_BASE,
      ticker: "AAPL",
      name: "Apple Inc.",
      shares: 10,
      cost_basis: 150,
      current_price: 200,
      market_value: 2000,
      unrealized_pl: 500,
      unrealized_pl_pct: 33.3,
      weight: 0.513,
    },
    {
      ...HOLDING_BASE,
      ticker: "MSFT",
      name: "Microsoft",
      shares: 5,
      cost_basis: 400,
      current_price: 380,
      market_value: 1900,
      unrealized_pl: -100,
      unrealized_pl_pct: -5,
      weight: 0.487,
    },
    {
      ...HOLDING_BASE,
      ticker: "OLD",
      name: "Sold Out Co",
      shares: 0,
      cost_basis: 10,
      current_price: null,
      market_value: null,
      unrealized_pl: null,
      unrealized_pl_pct: null,
      weight: null,
    },
  ],
  watchlist: [{ ticker: "ASML", asset_type: "STOCK", note: null, current_price: 702.4 }],
  total_market_value: 3900,
  total_cost_basis: 3500,
  total_pl: 400,
  total_pl_pct: 11.4,
  unpriced_count: 0,
};

const SNAPSHOTS: Snapshot[] = [];

let handlers: Record<string, () => unknown>;

function count(key: string): number {
  return apiFetch.mock.calls.filter(
    (c) => `${(c[1] as RequestInit | undefined)?.method ?? "GET"} ${c[0]}` === key,
  ).length;
}

describe("PortfolioPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {
      "GET /portfolio/summary": () => SUMMARY,
      "GET /portfolio/snapshots": () => SNAPSHOTS,
    };
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const handler = handlers[`${init?.method ?? "GET"} ${path}`];
      if (!handler) return Promise.reject(new Error("unexpected " + path));
      try {
        return Promise.resolve(handler());
      } catch (err) {
        return Promise.reject(err);
      }
    });
  });

  it("shows the totals, the mixed-currency note, and only open holdings", async () => {
    renderFresh();

    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
    expect(screen.getByText("Portfolio value").parentElement).toHaveTextContent("3,900.00");
    expect(screen.getByText("Cost basis").parentElement).toHaveTextContent("3,500.00");
    expect(screen.getByText("Total P/L").parentElement).toHaveTextContent("+400.00");
    expect(screen.getByText(/mixed currencies are not converted/i)).toBeInTheDocument();
    expect(screen.getByText("Microsoft")).toBeInTheDocument();
    expect(screen.queryByText("Sold Out Co")).not.toBeInTheDocument();
  });

  it("shows an em dash for an unpriced holding and says it isn't in the totals", async () => {
    handlers["GET /portfolio/summary"] = () => ({
      ...SUMMARY,
      holdings: [
        {
          ...SUMMARY.holdings[0],
          current_price: null,
          market_value: null,
          unrealized_pl: null,
          unrealized_pl_pct: null,
          weight: null,
        },
      ],
      unpriced_count: 1,
    });
    renderFresh();

    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
    expect(screen.getByText(/1 holding has no live price and isn't in these totals/i)).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the watchlist with prices", async () => {
    renderFresh();

    await waitFor(() => expect(screen.getByText("ASML")).toBeInTheDocument());
    expect(screen.getByText("702.40")).toBeInTheDocument();
  });

  it("shows an empty state and disables Log a trade when there are no holdings", async () => {
    handlers["GET /portfolio/summary"] = () => ({
      ...SUMMARY,
      holdings: [],
      watchlist: [],
      total_market_value: 0,
      total_cost_basis: 0,
      total_pl: 0,
      total_pl_pct: null,
    });
    renderFresh();

    await waitFor(() => expect(screen.getByText(/your portfolio is empty/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /log a trade/i })).toBeDisabled();
  });

  it("shows an inline error when the summary fails to load", async () => {
    handlers["GET /portfolio/summary"] = () => {
      throw new Error("boom");
    };
    renderFresh();

    await waitFor(() =>
      expect(screen.getByText(/could not load your portfolio/i)).toBeInTheDocument(),
    );
  });

  it("records a snapshot on request and refreshes the history", async () => {
    handlers["POST /portfolio/snapshot"] = () => ({ id: 1 });
    renderFresh();
    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
    const before = count("GET /portfolio/snapshots");

    fireEvent.click(screen.getByRole("button", { name: /record snapshot/i }));

    await waitFor(() => expect(count("POST /portfolio/snapshot")).toBe(1));
    await waitFor(() => expect(count("GET /portfolio/snapshots")).toBeGreaterThan(before));
  });

  it("shows why a snapshot could not be recorded", async () => {
    handlers["POST /portfolio/snapshot"] = () => {
      throw new FakeApiError(500, "No current price available for MSFT");
    };
    renderFresh();
    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /record snapshot/i }));

    await waitFor(() =>
      expect(screen.getByText("No current price available for MSFT")).toBeInTheDocument(),
    );
  });

  it("opens Log a trade with every holding selectable, including a sold-out one", async () => {
    renderFresh();
    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /log a trade/i }));

    expect(screen.getByText(/this only records it here/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /OLD/ })).toBeInTheDocument();
  });

  it("opens a holding for editing when its row is clicked", async () => {
    renderFresh();
    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Edit AAPL" }));

    expect(screen.getByRole("button", { name: /save holding/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove holding/i })).toBeInTheDocument();
  });

  it("adds a watchlist ticker and refreshes the summary", async () => {
    handlers["POST /portfolio/watchlist"] = () => ({});
    renderFresh();
    await waitFor(() => expect(screen.getByText("ASML")).toBeInTheDocument());
    const before = count("GET /portfolio/summary");

    fireEvent.change(screen.getByLabelText("Watchlist ticker"), { target: { value: "ko" } });
    fireEvent.click(screen.getByRole("button", { name: /add to watchlist/i }));

    await waitFor(() => expect(count("POST /portfolio/watchlist")).toBe(1));
    const post = apiFetch.mock.calls.find((c) => c[0] === "/portfolio/watchlist");
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
      ticker: "KO",
      asset_type: "STOCK",
    });
    await waitFor(() => expect(count("GET /portfolio/summary")).toBeGreaterThan(before));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- run "app/(shell)/portfolio/page.test.tsx"`
Expected: FAIL — the placeholder page has none of this.

- [ ] **Step 3: Implement the page**

```tsx
// frontend/app/(shell)/portfolio/page.tsx
"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { Alert, Box, Button, ButtonBase, TextField, Typography } from "@mui/material";
import { Camera, Plus } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type {
  AssetType,
  HoldingSummary,
  PortfolioSummary,
  Snapshot,
} from "@/lib/api/portfolio-types";
import { formatAmount, formatPct, formatSigned } from "@/lib/format";
import { useDailySnapshot } from "@/lib/portfolio/useDailySnapshot";
import { Amount } from "@/components/portfolio/Amount";
import { HoldingForm } from "@/components/portfolio/HoldingForm";
import { PortfolioChart } from "@/components/portfolio/PortfolioChart";
import { TradeSheet } from "@/components/portfolio/TradeSheet";

const DASH = "—";
const COLUMNS = { xs: "1fr auto", md: "1.6fr .6fr .8fr .8fr .9fr 1fr" };

function plColor(value: number | null): string {
  return value !== null && value < 0 ? "var(--down)" : "var(--up)";
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>{label}</Typography>
      <Box sx={{ fontWeight: 600 }}>{children}</Box>
    </Box>
  );
}

function HoldingRow({ holding, onEdit }: { holding: HoldingSummary; onEdit: () => void }) {
  const cell = { display: { xs: "none", md: "block" }, textAlign: "right" as const };
  return (
    <ButtonBase
      aria-label={`Edit ${holding.ticker}`}
      onClick={onEdit}
      sx={{
        display: "grid",
        gridTemplateColumns: COLUMNS,
        gap: 2,
        width: "100%",
        textAlign: "left",
        alignItems: "center",
        py: 1.5,
        borderBottom: "1px solid var(--line)",
      }}
    >
      <Box>
        <Typography sx={{ fontWeight: 600 }}>{holding.ticker}</Typography>
        <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>{holding.name}</Typography>
        <Typography sx={{ fontSize: 12, color: "var(--muted)", display: { md: "none" } }}>
          {holding.shares} sh
          {holding.weight !== null ? ` · ${(holding.weight * 100).toFixed(1)}%` : ""}
        </Typography>
      </Box>
      <Typography sx={cell}>{holding.shares}</Typography>
      <Typography sx={cell}>{formatAmount(holding.cost_basis)}</Typography>
      <Typography sx={cell}>
        {holding.current_price !== null ? formatAmount(holding.current_price) : DASH}
      </Typography>
      <Box sx={{ textAlign: "right" }}>
        <Typography sx={{ fontWeight: 600 }}>
          {holding.market_value !== null ? formatAmount(holding.market_value) : DASH}
        </Typography>
        <Typography sx={{ fontSize: 12, color: plColor(holding.unrealized_pl) }}>
          {holding.unrealized_pl !== null && holding.unrealized_pl_pct !== null
            ? `${formatSigned(holding.unrealized_pl)} · ${formatPct(holding.unrealized_pl_pct)}`
            : DASH}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

export default function PortfolioPage() {
  const {
    data: summary,
    error: summaryError,
    mutate: mutateSummary,
  } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const { data: snapshots, mutate: mutateSnapshots } = useSWR<Snapshot[]>(
    "/portfolio/snapshots",
    apiFetch,
  );
  useDailySnapshot();

  const [tradeOpen, setTradeOpen] = useState(false);
  const [holdingForm, setHoldingForm] = useState<{ open: boolean; holding?: HoldingSummary }>({
    open: false,
  });
  const [recording, setRecording] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [watchTicker, setWatchTicker] = useState("");
  const [watchType, setWatchType] = useState<AssetType>("STOCK");
  const [watchError, setWatchError] = useState<string | null>(null);

  const holdings = summary?.holdings ?? [];
  const open = holdings.filter((h) => h.shares > 0);

  async function recordSnapshot() {
    if (recording) return;
    setRecording(true);
    setSnapshotError(null);
    try {
      await apiFetch("/portfolio/snapshot", { method: "POST" });
      mutateSnapshots();
    } catch (err) {
      setSnapshotError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setRecording(false);
    }
  }

  async function addToWatchlist() {
    const ticker = watchTicker.trim().toUpperCase();
    if (!ticker) return;
    setWatchError(null);
    try {
      await apiFetch("/portfolio/watchlist", {
        method: "POST",
        body: JSON.stringify({ ticker, asset_type: watchType }),
      });
      setWatchTicker("");
      mutateSummary();
    } catch (err) {
      setWatchError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2, flexWrap: "wrap" }}>
        <Typography variant="h5" sx={{ fontWeight: 650 }}>
          Portfolio
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="outlined"
          startIcon={<Camera size={16} />}
          disabled={recording}
          onClick={recordSnapshot}
        >
          Record snapshot
        </Button>
        <Button
          variant="outlined"
          startIcon={<Plus size={16} />}
          onClick={() => setHoldingForm({ open: true })}
        >
          Add holding
        </Button>
        <Button
          variant="contained"
          disabled={holdings.length === 0}
          onClick={() => setTradeOpen(true)}
        >
          Log a trade
        </Button>
      </Box>

      {summaryError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load your portfolio.
        </Alert>
      )}
      {snapshotError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {snapshotError}
        </Alert>
      )}

      {summary && open.length === 0 && (
        <Box sx={{ textAlign: "center", py: 5 }}>
          <Typography sx={{ color: "var(--muted)", mb: 2 }}>Your portfolio is empty.</Typography>
          <Button variant="contained" onClick={() => setHoldingForm({ open: true })}>
            Add holding
          </Button>
        </Box>
      )}

      {summary && open.length > 0 && (
        <>
          <Box sx={{ display: "flex", gap: 4, alignItems: "flex-end", flexWrap: "wrap", mb: 1 }}>
            <Stat label="Portfolio value">
              <Amount value={summary.total_market_value} size={38} />
            </Stat>
            <Stat label="Cost basis">
              <Amount value={summary.total_cost_basis} />
            </Stat>
            <Stat label="Total P/L">
              <Box component="span" sx={{ color: plColor(summary.total_pl) }}>
                {formatSigned(summary.total_pl)}
                {summary.total_pl_pct !== null && ` (${formatPct(summary.total_pl_pct)})`}
              </Box>
            </Stat>
          </Box>
          <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
            Mixed currencies are not converted; totals add amounts as entered.
          </Typography>
          {summary.unpriced_count > 0 && (
            <Typography sx={{ fontSize: 12, color: "var(--warn)" }}>
              {summary.unpriced_count} holding{summary.unpriced_count === 1 ? " has" : "s have"} no
              live price and {summary.unpriced_count === 1 ? "isn't" : "aren't"} in these totals.
            </Typography>
          )}
        </>
      )}

      <Box sx={{ my: 2 }}>
        <PortfolioChart snapshots={snapshots ?? []} />
      </Box>

      {open.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Box
            sx={{
              display: { xs: "none", md: "grid" },
              gridTemplateColumns: COLUMNS,
              gap: 2,
              pb: 1,
              fontSize: 12,
              color: "var(--muted)",
              textAlign: "right",
              "& > :first-of-type": { textAlign: "left" },
            }}
          >
            <span>Holding</span>
            <span>Shares</span>
            <span>Avg cost</span>
            <span>Price</span>
            <span>Value</span>
            <span>P/L</span>
          </Box>
          {open.map((holding) => (
            <HoldingRow
              key={holding.ticker}
              holding={holding}
              onEdit={() => setHoldingForm({ open: true, holding })}
            />
          ))}
        </Box>
      )}

      <Box sx={{ p: 2, border: "1px solid var(--line)", borderRadius: 2, maxWidth: 420 }}>
        <Typography sx={{ fontWeight: 600, mb: 1 }}>Watchlist</Typography>
        {(summary?.watchlist ?? []).map((item) => (
          <Box
            key={item.ticker}
            sx={{ display: "flex", py: 1, borderBottom: "1px solid var(--line)" }}
          >
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>{item.ticker}</Typography>
              <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
                {item.note ?? "Watching"}
              </Typography>
            </Box>
            <Typography>
              {item.current_price !== null ? formatAmount(item.current_price) : DASH}
            </Typography>
          </Box>
        ))}
        <Box sx={{ display: "flex", gap: 1, mt: 1.5 }}>
          <TextField
            size="small"
            label="Watchlist ticker"
            value={watchTicker}
            onChange={(e) => setWatchTicker(e.target.value)}
          />
          <TextField
            select
            size="small"
            SelectProps={{ native: true }}
            aria-label="Watchlist type"
            value={watchType}
            onChange={(e) => setWatchType(e.target.value as AssetType)}
          >
            <option value="STOCK">Stock</option>
            <option value="ETF">ETF</option>
          </TextField>
          <Button variant="outlined" onClick={addToWatchlist}>
            Add to watchlist
          </Button>
        </Box>
        {watchError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {watchError}
          </Alert>
        )}
      </Box>

      <TradeSheet
        open={tradeOpen}
        onClose={() => setTradeOpen(false)}
        holdings={holdings.map((h) => ({ ticker: h.ticker, name: h.name }))}
        onLogged={() => mutateSummary()}
      />
      <HoldingForm
        open={holdingForm.open}
        onClose={() => setHoldingForm((s) => ({ ...s, open: false }))}
        holding={holdingForm.holding}
        heldTickers={holdings.map((h) => h.ticker)}
        onSaved={() => mutateSummary()}
      />
    </Box>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- run "app/(shell)/portfolio/page.test.tsx"`
Expected: PASS, 10 tests. If a test cannot find text split across nested spans (for example the P/L
line), assert on the labelled container as the tests above do rather than loosening the code.

- [ ] **Step 5: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/(shell)/portfolio/page.tsx" "frontend/app/(shell)/portfolio/page.test.tsx"
git commit -m "feat: Portfolio page with holdings, watchlist, chart and trade logging"
```

---

### Task 7: Today's portfolio tile

**Files:**
- Create: `frontend/components/portfolio/PortfolioTile.tsx`, `frontend/components/portfolio/PortfolioTile.test.tsx`
- Modify: `frontend/app/(shell)/today/page.tsx`, `frontend/app/(shell)/today/page.test.tsx`

**Interfaces:**
- Consumes: `PortfolioSummary`, `Snapshot` (Task 2); `Amount`, `formatPct` (Task 2);
  `PortfolioChart` `variant="sparkline"` (Task 2); `useDailySnapshot` (Task 3).
- Produces: `PortfolioTile()` (no props); Today now calls `useDailySnapshot()` and renders the tile.

- [ ] **Step 1: Write the failing tile tests**

```tsx
// frontend/components/portfolio/PortfolioTile.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { PortfolioTile } from "./PortfolioTile";

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PortfolioTile />
    </SWRConfig>,
  );
}

const SUMMARY: PortfolioSummary = {
  holdings: [
    {
      ticker: "AAPL",
      name: "Apple",
      asset_type: "STOCK",
      shares: 10,
      cost_basis: 150,
      first_purchase_date: "2024-01-01",
      sector: null,
      target_weight: null,
      current_price: 200,
      market_value: 2000,
      unrealized_pl: 500,
      unrealized_pl_pct: 33,
      weight: 1,
    },
  ],
  watchlist: [],
  total_market_value: 2000,
  total_cost_basis: 1500,
  total_pl: 500,
  total_pl_pct: 33.3,
  unpriced_count: 0,
};

const TWO_SNAPSHOTS: Snapshot[] = [
  { id: 1, created_at: "2026-09-28T09:00:00", total_market_value: 1900, total_cost_basis: 1500 },
  { id: 2, created_at: "2026-09-29T09:00:00", total_market_value: 2000, total_cost_basis: 1500 },
];

function serve(summary: unknown, snapshots: Snapshot[] = []) {
  apiFetch.mockImplementation((path: string) => {
    if (path === "/portfolio/summary") return summary instanceof Error ? Promise.reject(summary) : Promise.resolve(summary);
    if (path === "/portfolio/snapshots") return Promise.resolve(snapshots);
    return Promise.reject(new Error("unexpected " + path));
  });
}

describe("PortfolioTile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the value, the P/L percentage and a sparkline", async () => {
    serve(SUMMARY, TWO_SNAPSHOTS);
    const { container } = renderFresh();

    await waitFor(() => expect(screen.getByText("Portfolio")).toBeInTheDocument());
    expect(screen.getByText("Portfolio").parentElement).toHaveTextContent("2,000.00");
    expect(screen.getByText("+33.3%")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector("polyline")).not.toBeNull());
  });

  it("draws no sparkline before there is any history", async () => {
    serve(SUMMARY, []);
    const { container } = renderFresh();

    await waitFor(() => expect(screen.getByText("+33.3%")).toBeInTheDocument());
    expect(container.querySelector("svg")).toBeNull();
  });

  it("invites the user to add holdings when there are none", async () => {
    serve({ ...SUMMARY, holdings: [] });
    renderFresh();

    const link = await screen.findByRole("link", { name: /portfolio/i });
    expect(link).toHaveAttribute("href", "/portfolio");
    expect(screen.getByText(/add your holdings in/i)).toBeInTheDocument();
  });

  it("says when a holding isn't priced", async () => {
    serve({ ...SUMMARY, unpriced_count: 2 });
    renderFresh();

    await waitFor(() => expect(screen.getByText(/2 not priced/i)).toBeInTheDocument());
  });

  it("renders nothing, quietly, when the summary can't be loaded", async () => {
    serve(new Error("boom"));
    const { container } = renderFresh();

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- run components/portfolio/PortfolioTile.test.tsx`
Expected: FAIL — `./PortfolioTile` doesn't exist.

- [ ] **Step 3: Implement the tile**

```tsx
// frontend/components/portfolio/PortfolioTile.tsx
"use client";

import Link from "next/link";
import useSWR from "swr";
import { Box, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";
import { formatPct } from "@/lib/format";
import { Amount } from "./Amount";
import { PortfolioChart } from "./PortfolioChart";

export function PortfolioTile() {
  const { data: summary } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const { data: snapshots } = useSWR<Snapshot[]>("/portfolio/snapshots", apiFetch);

  // A side widget: while loading or on failure Today simply doesn't show it, rather than
  // flashing an error next to the page's real content.
  if (!summary) return null;

  const hasPositions = summary.holdings.some((h) => h.shares > 0);

  return (
    <Box sx={{ p: 2, border: "1px solid var(--line)", borderRadius: 2, mb: 2 }}>
      <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>Portfolio</Typography>
      {hasPositions ? (
        <>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            <Amount value={summary.total_market_value} size={26} />
            {summary.total_pl_pct !== null && (
              <Typography
                sx={{
                  fontSize: 12,
                  color: summary.total_pl_pct < 0 ? "var(--down)" : "var(--up)",
                }}
              >
                {formatPct(summary.total_pl_pct)}
              </Typography>
            )}
          </Box>
          <PortfolioChart snapshots={snapshots ?? []} variant="sparkline" />
          {summary.unpriced_count > 0 && (
            <Typography sx={{ fontSize: 12, color: "var(--warn)" }}>
              {summary.unpriced_count} not priced
            </Typography>
          )}
        </>
      ) : (
        <Typography sx={{ fontSize: 13, mt: 0.5 }}>
          Add your holdings in <Link href="/portfolio">Portfolio</Link>.
        </Typography>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Run to verify the tile tests pass**

Run: `npm test -- run components/portfolio/PortfolioTile.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the failing Today integration test and mock the two new dependencies**

In `frontend/app/(shell)/today/page.test.tsx`, directly after the existing `vi.mock("@/lib/api/client", ...)`
block and before `import TodayPage from "./page";`, add:

```tsx
// Each is tested on its own; here they would only add unrelated requests to the shared apiFetch mock.
vi.mock("@/components/portfolio/PortfolioTile", () => ({ PortfolioTile: () => "portfolio-tile" }));
vi.mock("@/lib/portfolio/useDailySnapshot", () => ({ useDailySnapshot: () => {} }));
```

and add this test inside the `describe("TodayPage", ...)` block (right after the first test,
"lists pending recommendations"):

```tsx
  it("shows the portfolio tile", async () => {
    apiFetch.mockResolvedValue([]);
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText("portfolio-tile")).toBeInTheDocument());
  });
```

Run: `npm test -- run "app/(shell)/today/page.test.tsx"`
Expected: FAIL only on the new test (the tile isn't rendered yet); the existing tests still pass.

- [ ] **Step 6: Wire the tile and the daily snapshot into Today**

In `frontend/app/(shell)/today/page.tsx`:
- add imports:
  ```tsx
  import { PortfolioTile } from "@/components/portfolio/PortfolioTile";
  import { useDailySnapshot } from "@/lib/portfolio/useDailySnapshot";
  ```
- as the first line inside `TodayPage()` (before the first `useSWR`), add: `useDailySnapshot();`
- render the tile directly after the header row: find the closing `</Box>` of the first child `Box`
  (the flex row containing "Today", "Awaiting you" and the Run analysis button) and insert
  `<PortfolioTile />` on the line after it, before `{loadError && (`.

- [ ] **Step 7: Run to verify all pass, then lint and type-check**

Run: `npm test -- run "app/(shell)/today/page.test.tsx" && npm run lint && npx tsc --noEmit`
Expected: PASS (all Today tests, including the new one), clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/portfolio/PortfolioTile.tsx frontend/components/portfolio/PortfolioTile.test.tsx "frontend/app/(shell)/today/page.tsx" "frontend/app/(shell)/today/page.test.tsx"
git commit -m "feat: portfolio value tile on Today and the automatic daily snapshot"
```

---

### Task 8: "Log the trade I placed" on the approval screen

**Files:**
- Create: `frontend/components/portfolio/LogTradeCta.tsx`, `frontend/components/portfolio/LogTradeCta.test.tsx`
- Modify: `frontend/components/recommendations/ConfirmationPanel.tsx`, `frontend/components/recommendations/ConfirmationPanel.test.tsx`,
  `frontend/app/(shell)/today/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `PortfolioSummary`, `TradeAction` (Task 2); `TradeSheet` (Task 4); `HoldingForm`
  (Task 5); `RecommendationOut` (existing, `frontend/lib/api/recommendation-types.ts`).
- Produces: `LogTradeCta({ recommendation })` — renders nothing for HOLD/WATCH; consumed by
  `ConfirmationPanel` (approved case only).

- [ ] **Step 1: Write the failing CTA tests**

```tsx
// frontend/components/portfolio/LogTradeCta.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { PortfolioSummary } from "@/lib/api/portfolio-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import { LogTradeCta } from "./LogTradeCta";

function renderFresh(recommendation: RecommendationOut) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <LogTradeCta recommendation={recommendation} />
    </SWRConfig>,
  );
}

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "AAPL",
    asset_type: "STOCK",
    action: "BUY",
    reasoning: [],
    ai_analysis: null,
    suggested_position_pct: null,
    status: "APPROVED",
    reviewed_at: null,
    fundamental_score: null,
    technical_signal: null,
    price_at_recommendation: null,
    current_price: null,
    price_change_pct: null,
    ...overrides,
  };
}

const SUMMARY: PortfolioSummary = {
  holdings: [
    {
      ticker: "AAPL",
      name: "Apple Inc.",
      asset_type: "STOCK",
      shares: 10,
      cost_basis: 150,
      first_purchase_date: "2024-01-01",
      sector: null,
      target_weight: null,
      current_price: 200,
      market_value: 2000,
      unrealized_pl: 500,
      unrealized_pl_pct: 33,
      weight: 1,
    },
  ],
  watchlist: [],
  total_market_value: 2000,
  total_cost_basis: 1500,
  total_pl: 500,
  total_pl_pct: 33,
  unpriced_count: 0,
};

function serve(summary: PortfolioSummary = SUMMARY) {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/portfolio/summary") return Promise.resolve(summary);
    if (path === "/portfolio/trades" && init?.method === "POST") return Promise.resolve({});
    return Promise.reject(new Error("unexpected " + path));
  });
}

describe("LogTradeCta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serve();
  });

  it("opens Log a trade with Bought and the ticker prefilled for a BUY of a held ticker", async () => {
    renderFresh(rec({ action: "BUY" }));

    fireEvent.click(await screen.findByRole("button", { name: /log the trade i placed/i }));

    expect(screen.getByLabelText("Ticker")).toHaveValue("AAPL");
    expect(screen.getByRole("button", { name: "Bought" })).toHaveAttribute("aria-pressed", "true");
  });

  it("prefills Sold for TRIM and SELL", async () => {
    renderFresh(rec({ action: "TRIM" }));

    fireEvent.click(await screen.findByRole("button", { name: /log the trade i placed/i }));

    expect(screen.getByRole("button", { name: "Sold" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows no button for HOLD or WATCH — there is nothing to record", async () => {
    const { container } = renderFresh(rec({ action: "HOLD" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the summary resolve
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the Add-holding form with the ticker prefilled for a BUY of a ticker not held", async () => {
    renderFresh(rec({ ticker: "NVDA", action: "BUY" }));

    fireEvent.click(await screen.findByRole("button", { name: /log the trade i placed/i }));

    expect(screen.getByRole("button", { name: /save holding/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Ticker")).toHaveValue("NVDA");
  });

  it("shows nothing for a SELL of a ticker that isn't held", async () => {
    const { container } = renderFresh(rec({ ticker: "NVDA", action: "SELL" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the summary resolve
    expect(container).toBeEmptyDOMElement();
  });

  it("confirms once the trade is logged", async () => {
    renderFresh(rec({ action: "BUY" }));

    fireEvent.click(await screen.findByRole("button", { name: /log the trade i placed/i }));
    fireEvent.change(screen.getByLabelText("Shares"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "121.6" } });
    fireEvent.click(screen.getByRole("button", { name: /save to log/i }));

    await waitFor(() => expect(screen.getByText(/trade logged/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /log the trade i placed/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- run components/portfolio/LogTradeCta.test.tsx`
Expected: FAIL — `./LogTradeCta` doesn't exist.

- [ ] **Step 3: Implement LogTradeCta**

```tsx
// frontend/components/portfolio/LogTradeCta.tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import { Alert, Button } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary, TradeAction } from "@/lib/api/portfolio-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { HoldingForm } from "./HoldingForm";
import { TradeSheet } from "./TradeSheet";

// HOLD and WATCH have no trade to record, so they map to nothing.
const TRADE_ACTION: Partial<Record<RecommendationOut["action"], TradeAction>> = {
  BUY: "BUY",
  ADD: "BUY",
  TRIM: "SELL",
  SELL: "SELL",
};

/**
 * "Log the trade I placed", shown after an approval. Opens Log a trade when the ticker is already a
 * holding (including a sold-out one), or the Add-holding form when it isn't — Log a trade can't open
 * a position. Nothing here places a trade: it only records one already made in a broker app.
 */
export function LogTradeCta({ recommendation }: { recommendation: RecommendationOut }) {
  const { data: summary, mutate } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const [open, setOpen] = useState(false);
  const [logged, setLogged] = useState(false);

  const action = TRADE_ACTION[recommendation.action];
  if (!action || !summary) return null;

  const held = summary.holdings.some((h) => h.ticker === recommendation.ticker);
  if (!held && action === "SELL") return null; // nothing to sell, and no way to open a position

  if (logged) {
    return (
      <Alert severity="success" sx={{ mt: 2, textAlign: "left" }}>
        Trade logged.
      </Alert>
    );
  }

  const done = () => {
    mutate();
    setLogged(true);
  };

  return (
    <>
      <Button variant="contained" fullWidth sx={{ mt: 2.5 }} onClick={() => setOpen(true)}>
        Log the trade I placed
      </Button>
      {held ? (
        <TradeSheet
          open={open}
          onClose={() => setOpen(false)}
          holdings={summary.holdings.map((h) => ({ ticker: h.ticker, name: h.name }))}
          prefill={{ ticker: recommendation.ticker, action }}
          onLogged={done}
        />
      ) : (
        <HoldingForm
          open={open}
          onClose={() => setOpen(false)}
          heldTickers={summary.holdings.map((h) => h.ticker)}
          prefillTicker={recommendation.ticker}
          onSaved={done}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- run components/portfolio/LogTradeCta.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the failing ConfirmationPanel tests and mock the CTA**

In `frontend/components/recommendations/ConfirmationPanel.test.tsx`, directly after the existing
`vi.mock("@/lib/api/client", ...)` block and before `import { ConfirmationPanel } from "./ConfirmationPanel";`, add:

```tsx
// Tested on its own; here it would only add a portfolio request to the shared apiFetch mock.
vi.mock("@/components/portfolio/LogTradeCta", () => ({ LogTradeCta: () => "log-trade-cta" }));
```

and add these tests inside the `describe("ConfirmationPanel", ...)` block:

```tsx
  it("offers to log the trade after an approval", () => {
    render(
      <ConfirmationPanel recommendation={rec()} onChanged={vi.fn()} onBackToToday={vi.fn()} />,
    );

    expect(screen.getByText("log-trade-cta")).toBeInTheDocument();
  });

  it("does not offer it after a dismissal", () => {
    render(
      <ConfirmationPanel
        recommendation={rec({ status: "REJECTED" })}
        onChanged={vi.fn()}
        onBackToToday={vi.fn()}
      />,
    );

    expect(screen.queryByText("log-trade-cta")).not.toBeInTheDocument();
  });
```

Also in `frontend/app/(shell)/today/[id]/page.test.tsx`, after its `vi.mock("next/navigation", ...)`
block and before `import RecommendationDetailPage from "./page";`, add:

```tsx
vi.mock("@/components/portfolio/LogTradeCta", () => ({ LogTradeCta: () => null }));
```

Run: `npm test -- run components/recommendations/ConfirmationPanel.test.tsx`
Expected: FAIL only on "offers to log the trade after an approval" (the panel doesn't render the CTA yet).

- [ ] **Step 6: Render the CTA in ConfirmationPanel**

In `frontend/components/recommendations/ConfirmationPanel.tsx`:
- add the import: `import { LogTradeCta } from "@/components/portfolio/LogTradeCta";`
- directly before the line `      {error && (` that precedes the error `Alert` with `sx={{ mt: 2, textAlign: "left" }}`,
  insert: `      {approved && <LogTradeCta recommendation={recommendation} />}`

- [ ] **Step 7: Run everything, then lint, type-check, and build**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: the full frontend suite passes (all earlier suites plus the new ones), lint and typecheck
clean, and the build succeeds with `/portfolio` still a registered route.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/portfolio/LogTradeCta.tsx frontend/components/portfolio/LogTradeCta.test.tsx frontend/components/recommendations/ConfirmationPanel.tsx frontend/components/recommendations/ConfirmationPanel.test.tsx "frontend/app/(shell)/today/[id]/page.test.tsx"
git commit -m "feat: Log the trade I placed on the approval screen"
```
