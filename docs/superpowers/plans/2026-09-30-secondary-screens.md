# Secondary Screens (Preferences, Account, Track record) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Preferences, Account and Track record screens (sub-project 8a) and the real More menu, with the one backend schema addition Track record needs.

**Architecture:** Frontend screens under `app/(shell)/more/*` read existing endpoints through SWR and submit through the shared `useAction` hook. Pure logic (track-record scoring, usage reset date) lives in small tested modules under `lib/`. The only backend change exposes two existing `Recommendation` columns on `RecommendationOut`; no migration.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, MUI 9 (`slotProps`, never `SelectProps`/`InputLabelProps`), SWR, Vitest + React Testing Library; FastAPI + Pydantic v2 + pytest on the backend.

**Spec:** `docs/superpowers/specs/2026-09-30-secondary-screens-design.md`

## Global Constraints

- The system never places a trade. No Buy/Sell/Deposit/Withdraw anywhere; screens that record something say nothing is sent to a broker.
- No model or migration change. Only backend change: add `outcome_forward_return_pct` and `outcome_evaluated_at` to `RecommendationOut`.
- Named exports (page files use `export default` as Next requires). All backend calls via `apiFetch` from `@/lib/api/client`; no bare `fetch` except the Blob download URL handling. SWR for reads; `useAction` (`@/lib/useAction`) for submits.
- No `useEffect` for anything derivable during render. Effects only for external-system sync (DOM, one-shot evaluate call).
- MUI 9: `TextField` uses `slotProps={{ select: { native: true }, inputLabel: { shrink: true }, htmlInput: {...} }}`.
- No currency symbol. Colour is never the only carrier of meaning (sign or word always shown). No exclamation marks or urgency wording.
- Stored `outcome_forward_return_pct` is a **fraction** (0.05 = +5%) despite the name; multiply by 100 for display.
- Test style: `vi.mock("@/lib/api/client")` with an `apiFetch` mock and hoisted `FakeApiError`; `SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}`; fake only `Date` (`vi.useFakeTimers({ toFake: ["Date"] })`). `vitest.setup.ts` already shims `jest` for `waitFor`.
- Lint, `npx tsc --noEmit`, `npm test`, `npm run build` (frontend) and `uv run python -m pytest tests/ -q`, `uv run ruff check . && uv run ruff format .`, `uv run mypy app` (backend, run in `backend/`) pass before a task is done. Commits: Conventional Commits, trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never skip hooks or signing; never commit `.env`.

## Review Focus

- Track record with only unevaluated rows, or only HOLD/WATCH rows: empty-state message, never "0 of 0" (Task 2, 3).
- Outcome return exactly 0, and resolved-but-null outcome (`outcome_evaluated_at` set, return null): not scored, no crash (Task 2).
- `POST /memory/evaluate-outcomes` failing or slow when Track record opens: page still renders the list, no error shown (Task 3).
- Usage where `limit` is 0 or `used` exceeds `limit`: bar clamps to 100%, no NaN, at-limit banner (Task 7).
- Delete my data: typed email compared case-insensitively and trimmed; a failed delete must not sign the user out or clear the cache (Task 9).
- Preferences: pasting a sector with different case or stray spaces ("  Energy ") must not create a duplicate chip; save sends the full object even if only notes changed (Task 6).

---

### Task 1: Expose outcome fields on RecommendationOut

**Files:**
- Modify: `backend/app/schemas.py` (class `RecommendationOut`, ends around line 96)
- Test: `backend/tests/test_analysis_router.py` (append)
- Modify: `docs/ARCHITECTURE.md` (line ~248, the `GET /analysis/recommendations` row)

**Interfaces:**
- Produces: JSON fields `outcome_forward_return_pct: float | null` (fraction) and `outcome_evaluated_at: datetime | null` on every `RecommendationOut` response (list, by-id, approve/reject).

- [ ] **Step 1: Write the failing test** (append to `backend/tests/test_analysis_router.py`)

```python
def test_recommendation_exposes_outcome_fields(client, db_session):
    evaluated = Recommendation(
        user_id=USER_ID,
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["x"],
        status="APPROVED",
        price_at_recommendation=100.0,
        outcome_forward_return_pct=0.0525,
        outcome_evaluated_at=datetime(2026, 9, 1, 12, 0, 0),
    )
    unevaluated = Recommendation(
        user_id=USER_ID,
        ticker="MSFT",
        asset_type="STOCK",
        action="HOLD",
        reasoning=["y"],
        status="REJECTED",
    )
    db_session.add_all([evaluated, unevaluated])
    db_session.commit()

    with patch(
        "app.routers.analysis.fetch_quote_and_history",
        AsyncMock(return_value={"price": 1.0, "closes": [1.0]}),
    ):
        response = client.get("/analysis/recommendations")

    assert response.status_code == 200
    by_ticker = {r["ticker"]: r for r in response.json()}
    assert by_ticker["AAPL"]["outcome_forward_return_pct"] == 0.0525
    assert by_ticker["AAPL"]["outcome_evaluated_at"] is not None
    assert by_ticker["MSFT"]["outcome_forward_return_pct"] is None
    assert by_ticker["MSFT"]["outcome_evaluated_at"] is None
```

Add `from datetime import date, datetime` to the file's imports (it currently imports only `date`).

- [ ] **Step 2: Run to verify failure**

Run (in `backend/`): `uv run python -m pytest tests/test_analysis_router.py::test_recommendation_exposes_outcome_fields -v`
Expected: FAIL with `KeyError: 'outcome_forward_return_pct'`.

- [ ] **Step 3: Implement** — in `RecommendationOut`, directly after `price_at_recommendation: float | None`, add:

```python
    # Stored by POST /memory/evaluate-outcomes ~20 days after the call. A fraction (0.05 = +5%)
    # despite the column name. evaluated_at set with a null return means "resolved, no valid
    # outcome" (no price history), which is different from "not due yet" (both null).
    outcome_forward_return_pct: float | None = None
    outcome_evaluated_at: datetime | None = None
```

(These sit before the "Computed at request time" comment block so the block's `current_price`/`price_change_pct` stay together at the end.)

- [ ] **Step 4: Update the spec table** — in `docs/ARCHITECTURE.md` row for `GET /analysis/recommendations?status=`, append: `Responses also carry the stored 20-day outcome, `outcome_forward_return_pct` (a fraction) and `outcome_evaluated_at`, both `null` until `/memory/evaluate-outcomes` has run for that row`.

- [ ] **Step 5: Run backend checks**

Run: `uv run python -m pytest tests/ -q && uv run ruff check . && uv run ruff format . && uv run mypy app`
Expected: all pass (392 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/tests/test_analysis_router.py docs/ARCHITECTURE.md
git commit -m "feat: expose 20-day outcome fields on recommendations"
```

---

### Task 2: Track record scoring module

**Files:**
- Modify: `frontend/lib/api/recommendation-types.ts` (add two optional fields to `RecommendationOut`)
- Create: `frontend/lib/trackRecord.ts`
- Test: `frontend/lib/trackRecord.test.ts`

**Interfaces:**
- Consumes: `RecommendationOut`, `Action` from `@/lib/api/recommendation-types`.
- Produces:
  ```ts
  export type Verdict = "matched" | "missed" | "unscored";
  export interface TrackRow { rec: RecommendationOut; verdict: Verdict; movePct: number | null } // movePct in percent (5.25 = +5.25%)
  export interface TrackSummary { rows: TrackRow[]; matched: number; scored: number }
  export function buildTrackRecord(recs: RecommendationOut[]): TrackSummary
  ```
  `rows` are the non-SUPERSEDED recommendations that have been evaluated, sorted newest `created_at` first. `scored` counts rows whose verdict is matched or missed; `matched` counts matched.

Rules (spec): SUPERSEDED excluded entirely. A row is included in `rows` only if `outcome_evaluated_at != null`. `movePct = outcome_forward_return_pct * 100`, or `null` when the return is null. Verdict: `movePct === null` → unscored; action HOLD/WATCH → unscored; BUY/ADD → matched iff movePct > 0 else missed; TRIM/SELL → matched iff movePct < 0 else missed. Zero never matches. REJECTED and PENDING and APPROVED are all scored the same.

- [ ] **Step 1: Add the fields** to `RecommendationOut` in `frontend/lib/api/recommendation-types.ts`, after `price_at_recommendation`:

```ts
  outcome_forward_return_pct?: number | null; // fraction: 0.05 = +5%
  outcome_evaluated_at?: string | null;
```
(Optional so existing test fixtures that build a `RecommendationOut` keep compiling; the backend always sends both.)

- [ ] **Step 2: Write the failing tests** — `frontend/lib/trackRecord.test.ts`

```ts
import { describe, it, expect } from "vitest";
import type { Action, RecommendationOut, RecommendationStatus } from "@/lib/api/recommendation-types";
import { buildTrackRecord } from "./trackRecord";

let nextId = 1;
function rec(
  action: Action,
  ret: number | null,
  overrides: Partial<RecommendationOut> = {},
): RecommendationOut {
  return {
    id: nextId++,
    user_id: "u1",
    created_at: "2026-08-01T00:00:00",
    ticker: "AAPL",
    asset_type: "STOCK",
    action,
    reasoning: [],
    ai_analysis: null,
    suggested_position_pct: null,
    status: "APPROVED" as RecommendationStatus,
    reviewed_at: null,
    fundamental_score: null,
    technical_signal: null,
    price_at_recommendation: 100,
    current_price: null,
    price_change_pct: null,
    outcome_forward_return_pct: ret,
    outcome_evaluated_at: "2026-08-25T00:00:00",
    ...overrides,
  };
}

describe("buildTrackRecord", () => {
  it("matches BUY and ADD on a positive move, TRIM and SELL on a negative one", () => {
    const { rows, matched, scored } = buildTrackRecord([
      rec("BUY", 0.05),
      rec("ADD", -0.02),
      rec("TRIM", -0.03),
      rec("SELL", 0.04),
    ]);
    expect(rows.map((r) => r.verdict)).toEqual(["matched", "missed", "matched", "missed"]);
    expect(matched).toBe(2);
    expect(scored).toBe(4);
  });

  it("never scores HOLD or WATCH", () => {
    const { rows, scored } = buildTrackRecord([rec("HOLD", 0.1), rec("WATCH", -0.1)]);
    expect(rows.map((r) => r.verdict)).toEqual(["unscored", "unscored"]);
    expect(scored).toBe(0);
  });

  it("treats a return of exactly zero as a miss", () => {
    const { rows } = buildTrackRecord([rec("BUY", 0), rec("SELL", 0)]);
    expect(rows.map((r) => r.verdict)).toEqual(["missed", "missed"]);
  });

  it("converts the stored fraction to a percentage", () => {
    const { rows } = buildTrackRecord([rec("BUY", 0.0525)]);
    expect(rows[0].movePct).toBeCloseTo(5.25);
  });

  it("scores dismissed calls too", () => {
    const { matched, scored } = buildTrackRecord([rec("BUY", 0.05, { status: "REJECTED" })]);
    expect(matched).toBe(1);
    expect(scored).toBe(1);
  });

  it("excludes superseded rows and rows not yet evaluated", () => {
    const { rows } = buildTrackRecord([
      rec("BUY", 0.05, { status: "SUPERSEDED" }),
      rec("BUY", null, { outcome_evaluated_at: null }),
      rec("BUY", 0.01),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("keeps a resolved row with no valid outcome as unscored", () => {
    const { rows, scored } = buildTrackRecord([rec("BUY", null)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("unscored");
    expect(rows[0].movePct).toBeNull();
    expect(scored).toBe(0);
  });

  it("sorts newest first and handles an empty list", () => {
    const { rows } = buildTrackRecord([
      rec("BUY", 0.01, { created_at: "2026-07-01T00:00:00" }),
      rec("BUY", 0.01, { created_at: "2026-08-15T00:00:00" }),
    ]);
    expect(rows[0].rec.created_at).toBe("2026-08-15T00:00:00");
    expect(buildTrackRecord([])).toEqual({ rows: [], matched: 0, scored: 0 });
  });
});
```

(All four rows in the first test share one `created_at`, so the descending sort keeps insertion order; `Array.prototype.sort` is stable.)

- [ ] **Step 3: Run to verify failure**

Run (in `frontend/`): `npx vitest run lib/trackRecord.test.ts`
Expected: FAIL, cannot resolve `./trackRecord`.

- [ ] **Step 4: Implement** — `frontend/lib/trackRecord.ts`

```ts
import type { Action, RecommendationOut } from "@/lib/api/recommendation-types";

export type Verdict = "matched" | "missed" | "unscored";

export interface TrackRow {
  rec: RecommendationOut;
  verdict: Verdict;
  movePct: number | null; // percent: 5.25 means +5.25%
}

export interface TrackSummary {
  rows: TrackRow[];
  matched: number;
  scored: number;
}

const UP_ACTIONS: Action[] = ["BUY", "ADD"];
const DOWN_ACTIONS: Action[] = ["TRIM", "SELL"];

function verdictFor(action: Action, movePct: number | null): Verdict {
  if (movePct === null) return "unscored";
  if (UP_ACTIONS.includes(action)) return movePct > 0 ? "matched" : "missed";
  if (DOWN_ACTIONS.includes(action)) return movePct < 0 ? "matched" : "missed";
  return "unscored"; // HOLD and WATCH make no directional call
}

/**
 * The Track record scoring rule (UI side, from the stored 20-day return). Superseded rows were
 * replaced by a newer run rather than decided, so they are left out; dismissed calls are scored
 * like approved ones. If the backend later stores a matched flag, use it instead.
 */
export function buildTrackRecord(recs: RecommendationOut[]): TrackSummary {
  const rows = recs
    .filter((rec) => rec.status !== "SUPERSEDED" && rec.outcome_evaluated_at != null)
    .map((rec): TrackRow => {
      const fraction = rec.outcome_forward_return_pct;
      const movePct = fraction == null ? null : fraction * 100;
      return { rec, verdict: verdictFor(rec.action, movePct), movePct };
    })
    .sort((a, b) => b.rec.created_at.localeCompare(a.rec.created_at));
  const scoredRows = rows.filter((row) => row.verdict !== "unscored");
  return {
    rows,
    matched: scoredRows.filter((row) => row.verdict === "matched").length,
    scored: scoredRows.length,
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run lib/trackRecord.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/api/recommendation-types.ts frontend/lib/trackRecord.ts frontend/lib/trackRecord.test.ts
git commit -m "feat: track record scoring rule"
```

---

### Task 3: Track record page and navigation entry

**Files:**
- Create: `frontend/app/(shell)/more/track-record/page.tsx`
- Test: `frontend/app/(shell)/more/track-record/page.test.tsx`
- Modify: `frontend/components/shell/navItems.ts` (add a `Track record` desktop entry)

**Interfaces:**
- Consumes: `buildTrackRecord`, `TrackRow` from `@/lib/trackRecord`; `RecommendationOut` from `@/lib/api/recommendation-types`; `formatPct` from `@/lib/format` (returns `+5.7%`/`-9.6%`).
- Produces: route `/more/track-record`.

Behaviour: on mount call `apiFetch("/memory/evaluate-outcomes", { method: "POST" })` once (best effort, `.catch(() => {})`), then `mutate()` the recommendations SWR key on success. Load list with `useSWR<RecommendationOut[]>("/analysis/recommendations", apiFetch)`. Guard the one-shot call with a `useRef` so React strict-mode/remounts within the page's life do not double-fire.

- [ ] **Step 1: Write the failing test** — `page.test.tsx` (use the standard mock/SWRConfig preamble from the Global Constraints)

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import TrackRecordPage from "./page";

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TrackRecordPage />
    </SWRConfig>,
  );
}

function rec(id: number, action: RecommendationOut["action"], ret: number | null, evaluated = true): RecommendationOut {
  return {
    id, user_id: "u1", created_at: `2026-08-0${id}T00:00:00`, ticker: `T${id}`, asset_type: "STOCK",
    action, reasoning: [], ai_analysis: null, suggested_position_pct: null, status: "APPROVED",
    reviewed_at: null, fundamental_score: null, technical_signal: null, price_at_recommendation: 100,
    current_price: null, price_change_pct: null, outcome_forward_return_pct: ret,
    outcome_evaluated_at: evaluated ? "2026-08-25T00:00:00" : null,
  };
}

describe("TrackRecordPage", () => {
  beforeEach(() => apiFetch.mockReset());

  it("shows the summary, a small-sample label and each scored row with a word and sign", async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === "/analysis/recommendations") return [rec(1, "BUY", 0.05), rec(2, "SELL", 0.03), rec(3, "HOLD", 0.01)];
      return { evaluated: 0, remaining: 0 };
    });
    renderFresh();
    expect(await screen.findByText(/1 of 2 calls moved the way the action implied/i)).toBeInTheDocument();
    expect(screen.getByText(/small sample, not a forecast/i)).toBeInTheDocument();
    expect(screen.getByText("+5.0%")).toBeInTheDocument();
    expect(screen.getByText("+3.0%")).toBeInTheDocument();
    expect(screen.getByText(/matched/i)).toBeInTheDocument();
    expect(screen.getByText(/missed/i)).toBeInTheDocument();
    expect(screen.getByText(/not scored/i)).toBeInTheDocument();
  });

  it("shows an empty state instead of 0 of 0 when nothing is scored", async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === "/analysis/recommendations" ? [rec(1, "BUY", null, false), rec(2, "HOLD", 0.02)] : { evaluated: 0, remaining: 0 },
    );
    renderFresh();
    expect(await screen.findByText(/no scored calls yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 of 0/)).not.toBeInTheDocument();
  });

  it("asks the backend to evaluate due outcomes once, and refetches after", async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === "/analysis/recommendations" ? [] : { evaluated: 2, remaining: 0 },
    );
    renderFresh();
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/memory/evaluate-outcomes", { method: "POST" }),
    );
    const evaluateCalls = apiFetch.mock.calls.filter((c) => c[0] === "/memory/evaluate-outcomes");
    expect(evaluateCalls).toHaveLength(1);
    await waitFor(() =>
      expect(apiFetch.mock.calls.filter((c) => c[0] === "/analysis/recommendations").length).toBeGreaterThan(1),
    );
  });

  it("still shows the list when evaluate-outcomes fails", async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === "/memory/evaluate-outcomes") throw new Error("upstream down");
      return [rec(1, "BUY", 0.05)];
    });
    renderFresh();
    expect(await screen.findByText(/1 of 1 calls moved the way the action implied/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an error when the list cannot load", async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === "/analysis/recommendations") throw new Error("boom");
      return { evaluated: 0, remaining: 0 };
    });
    renderFresh();
    expect(await screen.findByText(/could not load your track record/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run "app/(shell)/more/track-record/page.test.tsx"`
Expected: FAIL, cannot resolve `./page`.

- [ ] **Step 3: Implement** — `page.tsx`

```tsx
"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Alert, Box, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { formatPct } from "@/lib/format";
import { buildTrackRecord, type Verdict } from "@/lib/trackRecord";

const VERDICT_WORD: Record<Verdict, string> = {
  matched: "Matched",
  missed: "Missed",
  unscored: "Not scored",
};

const DECISION_WORD: Record<string, string> = {
  APPROVED: "Approved",
  REJECTED: "Dismissed",
  PENDING: "Pending",
};

export default function TrackRecordPage() {
  const { data, error, mutate } = useSWR<RecommendationOut[]>("/analysis/recommendations", apiFetch);
  const asked = useRef(false);

  // Nothing computes outcomes on a schedule, so opening this page asks the backend to evaluate
  // whatever is due (20 days old, batch of 50). Best effort: a failure just leaves older data.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    apiFetch("/memory/evaluate-outcomes", { method: "POST" })
      .then(() => mutate())
      .catch(() => {});
  }, [mutate]);

  const summary = data ? buildTrackRecord(data) : null;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 650 }}>
          Track record
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Link href="/more">Back to More</Link>
      </Box>

      {error && <Alert severity="error">Could not load your track record.</Alert>}

      {summary && summary.scored === 0 && (
        <Typography sx={{ color: "var(--text2)" }}>
          No scored calls yet. A call is scored 20 days after it is made.
        </Typography>
      )}

      {summary && summary.scored > 0 && (
        <>
          <Typography sx={{ fontSize: 18, fontWeight: 600 }}>
            {summary.matched} of {summary.scored} calls moved the way the action implied
          </Typography>
          <Typography sx={{ color: "var(--text2)", fontSize: 13, mb: 2 }}>
            A small sample, not a forecast.
          </Typography>
        </>
      )}

      {summary && summary.rows.length > 0 && (
        <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
          {summary.rows.map(({ rec, verdict, movePct }) => (
            <Box
              component="li"
              key={rec.id}
              sx={{ display: "flex", gap: 1.5, alignItems: "baseline", py: 1, borderBottom: "1px solid var(--border)" }}
            >
              <Typography sx={{ fontWeight: 600, width: 64 }}>{rec.ticker}</Typography>
              <Typography sx={{ width: 56 }}>{rec.action}</Typography>
              <Typography sx={{ color: "var(--text2)", flex: 1, fontSize: 13 }}>
                {rec.created_at.slice(0, 10)} · {DECISION_WORD[rec.status] ?? rec.status}
              </Typography>
              <Typography sx={{ width: 64, textAlign: "right" }}>
                {movePct === null ? "—" : formatPct(movePct)}
              </Typography>
              <Typography sx={{ width: 84, fontSize: 13 }}>{VERDICT_WORD[verdict]}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Add the nav entry** — in `frontend/components/shell/navItems.ts` import `ListChecks` from `lucide-react` and insert into `DESKTOP_SECTIONS` before `Preferences`:

```ts
  { label: "Track record", href: "/more/track-record", icon: ListChecks },
```
If a Sidebar/TabBar test asserts an exact item count, update that count.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run "app/(shell)/more/track-record/page.test.tsx" components/shell && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/(shell)/more/track-record" frontend/components/shell/navItems.ts
git commit -m "feat: track record page"
```

---

### Task 4: More menu

**Files:**
- Modify: `frontend/app/(shell)/more/page.tsx`
- Test: `frontend/app/(shell)/more/page.test.tsx` (create)

**Interfaces:** Produces the menu linking `/more/track-record`, `/more/backtests`, `/more/preferences`, `/more/account`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MorePage from "./page";

describe("MorePage", () => {
  it("links to the four secondary sections and drops the placeholder text", () => {
    render(<MorePage />);
    const hrefs = {
      "Track record": "/more/track-record",
      Backtests: "/more/backtests",
      Preferences: "/more/preferences",
      Account: "/more/account",
    };
    for (const [name, href] of Object.entries(hrefs)) {
      expect(screen.getByRole("link", { name: new RegExp(name, "i") })).toHaveAttribute("href", href);
    }
    expect(screen.queryByText(/coming in sub-project/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run "app/(shell)/more/page.test.tsx"` → FAIL (no Track record link, placeholder text present).

- [ ] **Step 3: Implement** — replace `page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { List, ListItemButton, ListItemText, Typography } from "@mui/material";

const ITEMS = [
  { label: "Track record", href: "/more/track-record", hint: "How past calls moved after 20 days" },
  { label: "Backtests", href: "/more/backtests", hint: "Test the signals on past prices" },
  { label: "Preferences", href: "/more/preferences", hint: "Risk, sectors to avoid, notes, appearance" },
  { label: "Account", href: "/more/account", hint: "Password, usage, export and delete" },
];

export default function MorePage() {
  return (
    <div>
      <Typography variant="h5" sx={{ fontWeight: 650, mb: 1 }}>
        More
      </Typography>
      <List>
        {ITEMS.map((item) => (
          <ListItemButton key={item.href} component={Link} href={item.href}>
            <ListItemText primary={item.label} secondary={item.hint} />
          </ListItemButton>
        ))}
      </List>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run "app/(shell)/more/page.test.tsx" && npx tsc --noEmit && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(shell)/more/page.tsx" "frontend/app/(shell)/more/page.test.tsx"
git commit -m "feat: real More menu"
```

---

### Task 5: Appearance setting (System / Light / Dark)

**Files:**
- Create: `frontend/lib/theme/applyTheme.ts`
- Create: `frontend/components/settings/AppearanceSetting.tsx`
- Test: `frontend/lib/theme/applyTheme.test.ts`, `frontend/components/settings/AppearanceSetting.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type ThemeChoice = "system" | "light" | "dark";
  export function readThemeChoice(): ThemeChoice;   // from localStorage "theme"; anything else → "system"
  export function applyThemeChoice(choice: ThemeChoice): void; // sets data-theme on <html>, persists
  export function AppearanceSetting(): JSX.Element;
  ```
- Semantics match the no-flash script: `light`/`dark` → `localStorage.setItem("theme", choice)` and `data-theme` = choice; `system` → `localStorage.removeItem("theme")` and `data-theme` = `matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"`. All storage access in try/catch (private mode); the visible theme must still change when storage throws. `ThemeProvider` already observes `data-theme`, so no other wiring is needed.

- [ ] **Step 1: Write failing tests**

`applyTheme.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyThemeChoice, readThemeChoice } from "./applyTheme";

function mockPrefersLight(light: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: light }) as unknown as typeof window.matchMedia;
}

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("stores and applies an explicit choice", () => {
    applyThemeChoice("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(readThemeChoice()).toBe("light");
  });

  it("system forgets the stored choice and follows the OS preference", () => {
    localStorage.setItem("theme", "dark");
    mockPrefersLight(true);
    applyThemeChoice("system");
    expect(localStorage.getItem("theme")).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(readThemeChoice()).toBe("system");
  });

  it("treats an unknown stored value as system", () => {
    localStorage.setItem("theme", "purple");
    expect(readThemeChoice()).toBe("system");
  });

  it("still applies the theme when storage throws", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    applyThemeChoice("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    Storage.prototype.setItem = original;
  });
});
```

`AppearanceSetting.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppearanceSetting } from "./AppearanceSetting";

describe("AppearanceSetting", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("shows the stored choice and applies a new one", () => {
    localStorage.setItem("theme", "dark");
    render(<AppearanceSetting />);
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/theme/applyTheme.test.ts components/settings` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`applyTheme.ts`:
```ts
export type ThemeChoice = "system" | "light" | "dark";

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem("theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/**
 * Same rules as the pre-paint script (resolveInitialTheme.ts): an explicit choice is stored and
 * wins; "system" forgets the stored choice and follows the OS. The theme still changes for this
 * visit when storage is blocked, it just is not remembered. ThemeProvider observes data-theme.
 */
export function applyThemeChoice(choice: ThemeChoice): void {
  let theme: "light" | "dark";
  if (choice === "system") {
    theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } else {
    theme = choice;
  }
  document.documentElement.setAttribute("data-theme", theme);
  try {
    if (choice === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", choice);
  } catch {
    // Private browsing or storage disabled: applied for this session only.
  }
}
```

`AppearanceSetting.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import { applyThemeChoice, readThemeChoice, type ThemeChoice } from "@/lib/theme/applyTheme";

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function AppearanceSetting() {
  // Reads localStorage, which the server render cannot, so it syncs after mount (same pattern as
  // ThemeToggle) instead of in the initializer, avoiding a hydration mismatch.
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => {
    const sync = () => setChoice(readThemeChoice());
    sync();
  }, []);

  return (
    <ToggleButtonGroup
      exclusive
      value={choice}
      aria-label="Appearance"
      onChange={(_, next: ThemeChoice | null) => {
        if (!next) return;
        applyThemeChoice(next);
        setChoice(next);
      }}
    >
      {CHOICES.map(({ value, label }) => (
        <ToggleButton key={value} value={value} aria-pressed={choice === value}>
          {label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run lib/theme components/settings && npx tsc --noEmit && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/theme/applyTheme.ts frontend/lib/theme/applyTheme.test.ts frontend/components/settings
git commit -m "feat: appearance setting with system, light and dark"
```

---

### Task 6: Preferences page

**Files:**
- Modify: `frontend/app/(shell)/more/preferences/page.tsx`
- Create: `frontend/lib/preferences.ts` (types + `addSector`)
- Test: `frontend/lib/preferences.test.ts`, `frontend/app/(shell)/more/preferences/page.test.tsx`

**Interfaces:**
- Consumes: `AppearanceSetting` (Task 5), `useAction`, `apiFetch`.
- Produces:
  ```ts
  export type RiskTolerance = "conservative" | "moderate" | "aggressive";
  export interface Preferences { risk_tolerance: RiskTolerance | null; sector_avoid_list: string[]; notes: string | null }
  export const NOTES_MAX = 2000;
  export function addSector(list: string[], raw: string): string[]; // trims; ignores blank and case-insensitive duplicates; returns a new array
  ```
- Backend: `GET /preferences` and `POST /preferences` (full object, same shape).

- [ ] **Step 1: Write failing tests**

`preferences.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { addSector } from "./preferences";

describe("addSector", () => {
  it("trims and appends", () => {
    expect(addSector(["Energy"], "  Tobacco ")).toEqual(["Energy", "Tobacco"]);
  });
  it("ignores blanks and case-insensitive duplicates", () => {
    expect(addSector(["Energy"], "   ")).toEqual(["Energy"]);
    expect(addSector(["Energy"], " energy ")).toEqual(["Energy"]);
  });
});
```

`page.test.tsx` (standard preamble with `FakeApiError`, `apiFetch`, `SWRConfig`):
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

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

import PreferencesPage from "./page";

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PreferencesPage />
    </SWRConfig>,
  );
}

const LOADED = { risk_tolerance: "moderate", sector_avoid_list: ["Energy"], notes: "long term" };

describe("PreferencesPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === "POST" ? JSON.parse(String(init.body)) : LOADED,
    );
  });

  it("loads the saved values and says preferences never change the score", async () => {
    renderFresh();
    expect(await screen.findByDisplayValue("long term")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /moderate/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Energy")).toBeInTheDocument();
    expect(screen.getByText(/never change the score or the call/i)).toBeInTheDocument();
  });

  it("adds a sector once even with different case and stray spaces", async () => {
    renderFresh();
    await screen.findByText("Energy");
    const input = screen.getByLabelText(/add a sector/i);
    fireEvent.change(input, { target: { value: "  energy " } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getAllByText(/^energy$/i)).toHaveLength(1);
    fireEvent.change(input, { target: { value: "Tobacco" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByText("Tobacco")).toBeInTheDocument();
  });

  it("removes a sector chip", async () => {
    renderFresh();
    fireEvent.click(await screen.findByRole("button", { name: /remove energy/i }));
    expect(screen.queryByText("Energy")).not.toBeInTheDocument();
  });

  it("caps the notes at 2000 characters and shows a counter", async () => {
    renderFresh();
    const notes = await screen.findByLabelText(/notes/i);
    fireEvent.change(notes, { target: { value: "x".repeat(2500) } });
    expect((notes as HTMLTextAreaElement).value).toHaveLength(2000);
    expect(screen.getByText("2000 / 2000")).toBeInTheDocument();
  });

  it("saves the full object even when only notes changed", async () => {
    renderFresh();
    const notes = await screen.findByLabelText(/notes/i);
    fireEvent.change(notes, { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/preferences", {
        method: "POST",
        body: JSON.stringify({ risk_tolerance: "moderate", sector_avoid_list: ["Energy"], notes: "changed" }),
      }),
    );
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });

  it("shows the API detail when saving fails", async () => {
    renderFresh();
    const notes = await screen.findByLabelText(/notes/i);
    apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new FakeApiError(422, "Notes too long");
      return LOADED;
    });
    fireEvent.change(notes, { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));
    expect(await screen.findByText("Notes too long")).toBeInTheDocument();
  });

  it("shows an error when preferences cannot load", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(500, "boom"));
    renderFresh();
    expect(await screen.findByText(/could not load your preferences/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/preferences.test.ts "app/(shell)/more/preferences"` → FAIL.

- [ ] **Step 3: Implement**

`lib/preferences.ts`:
```ts
export type RiskTolerance = "conservative" | "moderate" | "aggressive";

export interface Preferences {
  risk_tolerance: RiskTolerance | null;
  sector_avoid_list: string[];
  notes: string | null;
}

export const NOTES_MAX = 2000; // matches PreferencesIn.notes max_length

/** Trimmed, blank and case-insensitive duplicates ignored; always returns a new array. */
export function addSector(list: string[], raw: string): string[] {
  const sector = raw.trim();
  if (!sector || list.some((s) => s.toLowerCase() === sector.toLowerCase())) return [...list];
  return [...list, sector];
}
```

`page.tsx`: a loader component fetches with `useSWR<Preferences>("/preferences", apiFetch)`; while loading render nothing (or a small "Loading"); on error render `<Alert severity="error">Could not load your preferences.</Alert>`; once data exists render an inner `PreferencesForm({ initial, onSaved })` keyed so it initialises state once from `initial` (the same inner-component pattern as `HoldingForm`, avoiding effect-driven state sync). The form:

```tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import { Alert, Box, Button, Chip, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import { AppearanceSetting } from "@/components/settings/AppearanceSetting";
import { addSector, NOTES_MAX, type Preferences, type RiskTolerance } from "@/lib/preferences";
import { useAction } from "@/lib/useAction";

const RISKS: RiskTolerance[] = ["conservative", "moderate", "aggressive"];

export default function PreferencesPage() {
  const { data, error, mutate } = useSWR<Preferences>("/preferences", apiFetch);
  if (error) return <Alert severity="error">Could not load your preferences.</Alert>;
  if (!data) return null;
  return <PreferencesForm initial={data} onSaved={() => mutate()} />;
}

function PreferencesForm({ initial, onSaved }: { initial: Preferences; onSaved: () => void }) {
  const [risk, setRisk] = useState<RiskTolerance | null>(initial.risk_tolerance);
  const [sectors, setSectors] = useState<string[]>(initial.sector_avoid_list);
  const [sectorInput, setSectorInput] = useState("");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [saved, setSaved] = useState(false);
  const { run, submitting, error } = useAction();

  function save() {
    setSaved(false);
    return run(async () => {
      await apiFetch("/preferences", {
        method: "POST",
        body: JSON.stringify({ risk_tolerance: risk, sector_avoid_list: sectors, notes: notes || null }),
      });
      onSaved();
      setSaved(true);
    });
  }
  // return the JSX described below
}
```
Render, in order: heading "Preferences"; the sentence "Preferences shape the explanations and the web second opinion. They never change the score or the call."; a "Risk tolerance" `ToggleButtonGroup exclusive` with the three options (clicking the selected one clears to `null`; each button label is the capitalised word so `name: /moderate/i` matches, and `aria-pressed` reflects selection); "Sectors to avoid": `Chip` per sector with `onDelete` and `deleteIcon` wrapped so the delete control has `aria-label={`Remove ${sector}`}` (use `<Chip label={s} onDelete={...} slotProps={{ deleteIcon: { "aria-label": ... } }} />`, or render a small `IconButton` inside the chip if the slot prop is unavailable — verify with the test), plus a `TextField label="Add a sector"` and a `Button` named exactly `Add` that calls `setSectors((l) => addSector(l, sectorInput))` then clears the input; "Notes": multiline `TextField label="Notes"` with `slotProps={{ htmlInput: { maxLength: NOTES_MAX } }}`, `onChange` slicing to `NOTES_MAX`, and helper text `${notes.length} / ${NOTES_MAX}`; "Appearance" section with `<AppearanceSetting />`; an error `Alert` when `error`; a "Saved" text when `saved` (cleared on the next save); `Button` "Save preferences" `disabled={submitting}` `onClick={save}`. The counter must render as the single text node `2000 / 2000` (template string).

- [ ] **Step 4: Run to verify pass** — `npx vitest run lib/preferences.test.ts "app/(shell)/more/preferences" && npx tsc --noEmit && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/preferences.ts frontend/lib/preferences.test.ts "frontend/app/(shell)/more/preferences"
git commit -m "feat: preferences page"
```

---

### Task 7: Usage summary (bars and reset date)

**Files:**
- Create: `frontend/lib/usage.ts`, `frontend/components/account/UsageSummary.tsx`
- Test: `frontend/lib/usage.test.ts`, `frontend/components/account/UsageSummary.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface UsageDetail { used: number; limit: number }
  export interface Usage { analysis_runs: UsageDetail; chat_messages: UsageDetail }
  export function nextResetDate(now: Date): string;      // first of next month, UTC, "YYYY-MM-DD"
  export function usageLevel(d: UsageDetail): "ok" | "warn" | "limit"; // limit: used >= limit (or limit <= 0 with used > 0... see below); warn: used/limit > 0.9
  export function usageFraction(d: UsageDetail): number; // 0..1, clamped, 0 when limit <= 0
  export function UsageSummary(props: { usage: Usage; now?: Date }): JSX.Element;
  ```
- Rules: `limit <= 0` → fraction 0; level `limit` when `limit > 0 && used >= limit`, `ok` when `limit <= 0`; `warn` when `used / limit > 0.9`. `nextResetDate` for `2026-12-15` → `2027-01-01`; for `2026-09-30T23:59Z` → `2026-10-01`.
- The component takes optional `now` (default `new Date()` via `useState(() => new Date())` — never `Date.now()` in render) and shows, per kind, label ("Analysis runs", "Chat messages"), `used / limit` text, a MUI `LinearProgress` (`aria-label` = label, `value` = fraction*100), a word cue "Near limit" (warn) or "At limit" (limit), and once per component, "Resets on {date}". At the limit for either kind show an `Alert severity="warning"` (banner, not error): "You have used your monthly allowance. It resets on {date}. Ask your administrator if you need more."

- [ ] **Step 1: Write failing tests**

`usage.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { nextResetDate, usageFraction, usageLevel } from "./usage";

describe("usage", () => {
  it("resets on the first of next month, UTC, across a year boundary", () => {
    expect(nextResetDate(new Date("2026-12-15T10:00:00Z"))).toBe("2027-01-01");
    expect(nextResetDate(new Date("2026-09-30T23:59:59Z"))).toBe("2026-10-01");
  });
  it("clamps the fraction and survives a zero or exceeded limit", () => {
    expect(usageFraction({ used: 5, limit: 10 })).toBe(0.5);
    expect(usageFraction({ used: 15, limit: 10 })).toBe(1);
    expect(usageFraction({ used: 3, limit: 0 })).toBe(0);
  });
  it("classifies ok, warn above 90 percent, and limit", () => {
    expect(usageLevel({ used: 9, limit: 10 })).toBe("ok");
    expect(usageLevel({ used: 10, limit: 11 })).toBe("warn");
    expect(usageLevel({ used: 10, limit: 10 })).toBe("limit");
    expect(usageLevel({ used: 12, limit: 10 })).toBe("limit");
    expect(usageLevel({ used: 1, limit: 0 })).toBe("ok");
  });
});
```

`UsageSummary.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UsageSummary } from "./UsageSummary";

const NOW = new Date("2026-12-15T10:00:00Z");

describe("UsageSummary", () => {
  it("shows used over limit and the reset date", () => {
    render(<UsageSummary now={NOW} usage={{ analysis_runs: { used: 3, limit: 10 }, chat_messages: { used: 0, limit: 50 } }} />);
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
    expect(screen.getByText("0 / 50")).toBeInTheDocument();
    expect(screen.getByText(/resets on 2027-01-01/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses a word, not only colour, above 90 percent", () => {
    render(<UsageSummary now={NOW} usage={{ analysis_runs: { used: 10, limit: 11 }, chat_messages: { used: 0, limit: 50 } }} />);
    expect(screen.getByText(/near limit/i)).toBeInTheDocument();
  });

  it("shows a warning banner at the limit and clamps an exceeded bar", () => {
    render(<UsageSummary now={NOW} usage={{ analysis_runs: { used: 12, limit: 10 }, chat_messages: { used: 0, limit: 50 } }} />);
    expect(screen.getByText(/at limit/i)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/resets on 2027-01-01.*ask your administrator/i);
    expect(screen.getByRole("progressbar", { name: /analysis runs/i })).toHaveAttribute("aria-valuenow", "100");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/usage.test.ts components/account/UsageSummary.test.tsx` → FAIL.

- [ ] **Step 3: Implement** the two files per the Interfaces block. `nextResetDate`: `new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)` (Date.UTC rolls month 12 into next year). `usageFraction`: `limit <= 0 ? 0 : Math.min(1, used / limit)`. `usageLevel`: `limit <= 0 → "ok"`, `used >= limit → "limit"`, `used / limit > 0.9 → "warn"`, else `"ok"`. Component: `LinearProgress variant="determinate" value={usageFraction(d) * 100}` with `aria-label={label}` and `color={level === "ok" ? "primary" : "warning"}`. Use the existing status colours via MUI palette `warning` (already themed).

- [ ] **Step 4: Run to verify pass** — `npx vitest run lib/usage.test.ts components/account && npx tsc --noEmit && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/usage.ts frontend/lib/usage.test.ts frontend/components/account/UsageSummary.tsx frontend/components/account/UsageSummary.test.tsx
git commit -m "feat: usage summary with reset date"
```

---

### Task 8: Change password form

**Files:**
- Create: `frontend/components/account/ChangePasswordForm.tsx`
- Test: `frontend/components/account/ChangePasswordForm.test.tsx`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/client` (`supabase.auth.updateUser({ password })` resolves `{ error }` with `error.message`), `useAction`.
- Produces: `export function ChangePasswordForm(): JSX.Element` and `export const MIN_PASSWORD = 8`.
- Behaviour: fields "New password" and "Confirm new password" (type password). Submit is blocked with a message when the password is shorter than `MIN_PASSWORD` ("Use at least 8 characters.") or the two differ ("The passwords do not match."). On Supabase error show `error.message` (specific is fine, the user is signed in). Success shows "Password changed." and clears both fields. Because `useAction` treats thrown errors, wrap: `run(async () => { const { error } = await createClient().auth.updateUser({ password }); if (error) throw new Error(error.message); ... })` — but `useAction` shows only `ApiError.detail` or the generic text, so instead handle the Supabase result inside the closure and call `setError(error.message)` (then return without clearing/success). Success state is a local `useState` flag.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const updateUser = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { updateUser } }) }));

import { ChangePasswordForm } from "./ChangePasswordForm";

function fill(pw: string, confirm: string) {
  fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: pw } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: /change password/i }));
}

describe("ChangePasswordForm", () => {
  beforeEach(() => updateUser.mockReset());

  it("blocks a short password and a mismatch without calling Supabase", () => {
    render(<ChangePasswordForm />);
    fill("short", "short");
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    fill("longenough1", "different1");
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("changes the password and clears the fields", async () => {
    updateUser.mockResolvedValue({ error: null });
    render(<ChangePasswordForm />);
    fill("longenough1", "longenough1");
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: "longenough1" }));
    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/^new password/i) as HTMLInputElement).value).toBe("");
  });

  it("shows Supabase's message when it refuses", async () => {
    updateUser.mockResolvedValue({ error: { message: "New password should be different from the old password." } });
    render(<ChangePasswordForm />);
    fill("longenough1", "longenough1");
    expect(await screen.findByText(/should be different from the old password/i)).toBeInTheDocument();
    expect(screen.queryByText(/password changed/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run components/account/ChangePasswordForm.test.tsx` → FAIL.

- [ ] **Step 3: Implement** the component as a `Box component="form"` (`onSubmit` calls `preventDefault`, validates, then `run(...)`), heading "Change password", the two `TextField`s (`type="password"`, `autoComplete="new-password"`), error `Alert` from `useAction().error`, success text, submit `Button type="submit"` named "Change password" `disabled={submitting}`. Success flag is cleared at the start of each submit.

- [ ] **Step 4: Run to verify pass** — `npx vitest run components/account && npx tsc --noEmit && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/account/ChangePasswordForm.tsx frontend/components/account/ChangePasswordForm.test.tsx
git commit -m "feat: change password form"
```

---

### Task 9: Export and delete my data

**Files:**
- Create: `frontend/lib/download.ts`, `frontend/components/account/DataActions.tsx`
- Test: `frontend/components/account/DataActions.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `useAction`, `createClient` (`auth.signOut()`), `useRouter` from `next/navigation`, `mutate` from `swr` (global), `todayIso`.
- Produces:
  ```ts
  // download.ts
  export function downloadJson(filename: string, data: unknown): void; // Blob + object URL + temporary <a download>, revokes the URL
  // DataActions.tsx
  export function DataActions(props: { email: string }): JSX.Element;
  ```
- Behaviour:
  - **Export my data** button: `run(async () => downloadJson(`trade-agent-export-${todayIso()}.json`, await apiFetch("/me/export")))`.
  - **Delete my data** opens a confirmation region (inline, not a route): lists what is deleted (holdings, watchlist, trades, recommendations, chats, backtests, preferences, snapshots) and what is not ("Your sign-in and access stay. Removing access is done by your administrator."), plus "Nothing is sent to a broker." is NOT needed here. A `TextField label="Type your email to confirm"`; the "Delete my data" confirm button is disabled until `input.trim().toLowerCase() === email.toLowerCase()`.
  - Confirm: `run(async () => { await apiFetch("/me/data", { method: "DELETE", body: JSON.stringify({ confirm: true }) }); await mutate(() => true, undefined, { revalidate: false }); await createClient().auth.signOut(); router.push("/login"); })`. If the DELETE throws, nothing after it runs (cache kept, still signed in) and the `useAction` error shows.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
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
const signOut = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut } }) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const downloadJson = vi.fn();
vi.mock("@/lib/download", () => ({ downloadJson: (...a: unknown[]) => downloadJson(...a) }));

import { DataActions } from "./DataActions";

describe("DataActions", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    signOut.mockReset();
    push.mockReset();
    downloadJson.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
  });

  it("downloads the export under a dated filename", async () => {
    apiFetch.mockResolvedValue({ holdings: [] });
    render(<DataActions email="me@example.com" />);
    fireEvent.click(screen.getByRole("button", { name: /export my data/i }));
    await waitFor(() =>
      expect(downloadJson).toHaveBeenCalledWith("trade-agent-export-2026-09-30.json", { holdings: [] }),
    );
  });

  it("keeps delete disabled until the email matches, ignoring case and spaces", () => {
    render(<DataActions email="Me@Example.com" />);
    fireEvent.click(screen.getByRole("button", { name: /^delete my data$/i }));
    const confirmButton = screen.getAllByRole("button", { name: /delete my data/i }).at(-1)!;
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/type your email/i), { target: { value: "  me@example.com " } });
    expect(confirmButton).toBeEnabled();
  });

  it("says what is and is not deleted", () => {
    render(<DataActions email="me@example.com" />);
    fireEvent.click(screen.getByRole("button", { name: /^delete my data$/i }));
    expect(screen.getByText(/holdings, watchlist, trades, recommendations/i)).toBeInTheDocument();
    expect(screen.getByText(/sign-in and access stay/i)).toBeInTheDocument();
  });

  it("deletes, then signs out and goes to login", async () => {
    apiFetch.mockResolvedValue(undefined);
    signOut.mockResolvedValue({});
    render(<DataActions email="me@example.com" />);
    fireEvent.click(screen.getByRole("button", { name: /^delete my data$/i }));
    fireEvent.change(screen.getByLabelText(/type your email/i), { target: { value: "me@example.com" } });
    fireEvent.click(screen.getAllByRole("button", { name: /delete my data/i }).at(-1)!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(apiFetch).toHaveBeenCalledWith("/me/data", { method: "DELETE", body: JSON.stringify({ confirm: true }) });
    expect(signOut).toHaveBeenCalled();
  });

  it("does not sign out when the delete fails", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(500, "Could not delete"));
    render(<DataActions email="me@example.com" />);
    fireEvent.click(screen.getByRole("button", { name: /^delete my data$/i }));
    fireEvent.change(screen.getByLabelText(/type your email/i), { target: { value: "me@example.com" } });
    fireEvent.click(screen.getAllByRole("button", { name: /delete my data/i }).at(-1)!);
    expect(await screen.findByText("Could not delete")).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
```
(If the initial "Delete my data" trigger and the confirm button share the same accessible name, name the trigger "Delete my data…" is NOT allowed — instead keep the trigger as "Delete my data" and give the confirm button the name "Confirm delete my data"; adjust the `.at(-1)` queries to `getByRole("button", { name: /confirm delete/i })` in the test and implementation together so they stay consistent.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run components/account/DataActions.test.tsx` → FAIL.

- [ ] **Step 3: Implement** `download.ts`:

```ts
/** Saves data as a JSON file through a temporary object URL (no server round-trip). */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
```
and `DataActions.tsx` per Behaviour (one `useAction()` instance shared by export and delete; a `confirming` `useState` toggles the inline confirmation; the typed email is local state).

- [ ] **Step 4: Run to verify pass** — `npx vitest run components/account && npx tsc --noEmit && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/download.ts frontend/components/account/DataActions.tsx frontend/components/account/DataActions.test.tsx
git commit -m "feat: export and delete my data"
```

---

### Task 10: Account page

**Files:**
- Modify: `frontend/app/(shell)/more/account/page.tsx`
- Test: `frontend/app/(shell)/more/account/page.test.tsx` (create)

**Interfaces:**
- Consumes: `UsageSummary`, `Usage` (Task 7), `ChangePasswordForm` (Task 8), `DataActions` (Task 9), `createClient` (`signOut`), `useRouter`.
- Reads: `GET /me` (`{ email: string, ... }`), `GET /me/usage` (`Usage`).

- [ ] **Step 1: Write the failing test** — mock `apiFetch`, `@/lib/supabase/client` (`signOut`), `next/navigation`, and stub the three child components to keep this test about composition:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
const signOut = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut } }) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/account/ChangePasswordForm", () => ({ ChangePasswordForm: () => "change-password" }));
vi.mock("@/components/account/DataActions", () => ({ DataActions: ({ email }: { email: string }) => `data-actions:${email}` }));

import AccountPage from "./page";

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AccountPage />
    </SWRConfig>,
  );
}

describe("AccountPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    signOut.mockReset();
    push.mockReset();
    apiFetch.mockImplementation(async (path: string) =>
      path === "/me"
        ? { email: "me@example.com", role: "user", status: "active" }
        : { analysis_runs: { used: 2, limit: 10 }, chat_messages: { used: 1, limit: 50 } },
    );
  });

  it("shows the email, usage, section links and the child sections", async () => {
    renderFresh();
    expect(await screen.findByText("me@example.com")).toBeInTheDocument();
    expect(await screen.findByText("2 / 10")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /track record/i })).toHaveAttribute("href", "/more/track-record");
    expect(screen.getByRole("link", { name: /backtests/i })).toHaveAttribute("href", "/more/backtests");
    expect(screen.getByRole("link", { name: /preferences/i })).toHaveAttribute("href", "/more/preferences");
    expect(screen.getByText("change-password")).toBeInTheDocument();
    expect(screen.getByText("data-actions:me@example.com")).toBeInTheDocument();
  });

  it("signs out and returns to login", async () => {
    signOut.mockResolvedValue({});
    renderFresh();
    await screen.findByText("me@example.com");
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(signOut).toHaveBeenCalled();
  });

  it("shows an error when the account cannot load", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    renderFresh();
    expect(await screen.findByText(/could not load your account/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run "app/(shell)/more/account"` → FAIL.

- [ ] **Step 3: Implement** `page.tsx`: `useSWR<{ email: string }>("/me", apiFetch)` and `useSWR<Usage>("/me/usage", apiFetch)`; heading "Account"; if `/me` errors show `Alert` "Could not load your account."; else once `me` is loaded show "Signed in as" + email, `UsageSummary` when usage is loaded (own error shows "Could not load your usage."), a links list (Track record, Backtests, Preferences via `Link`), `<ChangePasswordForm />`, `<DataActions email={me.email} />`, and a "Sign out" `Button` calling `useAction().run(async () => { await createClient().auth.signOut(); router.push("/login"); })`. Because the usage endpoint is active-only and the layout already guarantees an active user, no extra gate.

- [ ] **Step 4: Full frontend verification**

Run (in `frontend/`): `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: all pass (baseline was 178 tests before this plan).

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(shell)/more/account"
git commit -m "feat: account page"
```

---

## Self-review notes

- **Spec coverage:** More menu (T4); Preferences incl. chips, 2000 cap, appearance, copy (T5, T6); Track record incl. scoring, empty state, auto-evaluate, backend fields (T1-T3); Account incl. email, change password, usage and reset date, links, export, delete data, sign out (T7-T10). Non-goals honoured (no login deletion, no server-side appearance, no pagination).
- **Types:** `Preferences`/`RiskTolerance` (T6), `Usage`/`UsageDetail` (T7) reused in T10; `Verdict`/`TrackRow` (T2) used in T3; `ThemeChoice` (T5) used in the same task only.
- **Ruling recorded:** `outcome_*` fields are optional on the TypeScript `RecommendationOut` so unrelated existing fixtures keep compiling.
- **Known judgement calls for reviewers:** minimum password length 8 (Supabase enforces its own rule too); Track record has no `PENDING` filtering (a pending call with an evaluated outcome can exist only if the user never decided; it is still shown as "Pending").
