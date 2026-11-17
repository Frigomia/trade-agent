# ETFs on the Portfolio page: classify by category, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An ETF holding on the Portfolio page shows its category as its own slice instead of "Unclassified", a person can set the category in the holding form, and funds no longer count as an unknown country.

**Architecture:** `analyze_portfolio` resolves an ETF's category from the holding's own sector, then Yahoo's category, then the universe file's `industry` (a new cached helper), labels the slice `ETF: <category>` and gives funds the country label `Funds`. The frontend `spread` treats `Funds` like `Unclassified` for the country count, and the holding form gets an optional Category field for ETFs that saves to the existing `sector` field. No schema or migration change.

**Tech Stack:** Python, FastAPI, pytest, ruff, mypy; Next.js, TypeScript, MUI, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-etf-portfolio-classification-design.md`. Work on a new branch from `origin/master` (for example `fix/etf-portfolio-classification`); the design doc and this plan are committed first.

## Global Constraints

- Advisory only; nothing here touches orders.
- ETF category precedence, first non-empty wins: the holding's own `sector` (stripped), Yahoo's `category` from the profile, the universe row's `industry` for that ticker. None of them: sector and industry are `Unclassified` (not the old `ETF: Unclassified`) and a note says how to fix it.
- Label: `ETF: <category>` (the `ETF: ` prefix stays so a fund is told apart from a stock). Country for every ETF is `Funds`.
- No guessing a category from a fund's name; no change to stock classification; no look-through; no migration (`Holding.sector` String(100) and `HoldingIn.sector` already exist).
- DESIGN.md for the form field: existing form styling, rem sizes. Conventional Commits with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` trailer, GPG-signed, no push. Run ruff by hand from `backend/` (`.venv/Scripts/ruff.exe`), `mypy.exe app`; frontend checks per `frontend/AGENTS.md`.

## Review Focus

1. An ETF with no category anywhere stays visible as `Unclassified` with a note naming the fund (Task 1).
2. A person's own category beats Yahoo's and the universe file's; an empty or whitespace-only own value falls through (Task 1).
3. A universe ticker matches case-insensitively; a non-universe ticker returns None; stocks are never given a fund category (Task 1).
4. `Funds` is not counted as a country, never the largest, and does not break the `Unclassified` handling (Task 2).
5. The Category field appears only for ETFs, trims whitespace, respects the 100-character limit, and saving an ETF without a category leaves the existing sector unchanged (Task 3).

---

### Task 1: Backend category resolution

**Files:**
- Modify: `backend/app/discovery/universe.py`, `backend/app/analysis/portfolio.py` (the ETF branch around lines 249-265)
- Test: `backend/tests/test_discovery_universe.py` (or the existing universe test file: `grep -rl load_universe backend/tests`), `backend/tests/test_portfolio_analytics_math.py`

**Interfaces:**
- Produces: `etf_category_for(ticker: str) -> str | None` in `app/discovery/universe.py`: the universe row's `industry` for an ETF row with that ticker (case-insensitive), else None; reads the file once (`functools.lru_cache` on a loader helper) and returns None for stock rows, unknown tickers and blank industry. `FUNDS = "Funds"` in `app/sectors.py` beside `UNCLASSIFIED`.
- Consumes: `load_universe()`, `UNCLASSIFIED`, `_label`, `PositionInput(ticker, name, shares, asset_type, sector=None)`.

- [ ] **Step 1: Write the failing tests.** Universe: `etf_category_for("IS3N.DE") == "Global Emerging Markets Equity"` (read the real file; use a ticker whose industry you confirm), the lookup is case-insensitive (`"is3n.de"`), a stock ticker (for example `"AAPL"` or any stock row) and an unknown ticker return None. Portfolio, in `test_portfolio_analytics_math.py`: an ETF holding with own sector "My Tech Fund" and profile category "Global Equity" gives `by_sector[0].label == "ETF: My Tech Fund"`; with no own sector and profile category "Global Equity" gives "ETF: Global Equity" (the existing test `test_unknown_country_and_etf_category_are_explicit_buckets_not_look_through` asserts Yahoo's category beats the holding's sector "Technology": update it to the new precedence and keep its other assertions, saying so in the report); with no own sector and no profile category but the ticker `IS3N.DE` gives "ETF: Global Emerging Markets Equity" (industry too); a whitespace-only own sector falls through to the next source; with no source at all `by_sector[0].label == "Unclassified"` and `by_industry[0].label == "Unclassified"` and a note containing the ticker and "category not set"; every ETF holding's `by_country` label is `"Funds"`; a stock with an unknown country is still `Unclassified`; a resolved ETF does not get the "profile unavailable" note.
- [ ] **Step 2: Run them and see them fail** (`cd backend && .venv/Scripts/python.exe -m pytest tests/test_portfolio_analytics_math.py <universe test file> -q`).
- [ ] **Step 3: Implement.** `etf_category_for` as specified. In `analyze_portfolio` replace the ETF branch: compute `category = (holding.sector or "").strip() or profile.get("category") or etf_category_for(ticker)`; when truthy set `sector[ticker] = industry[ticker] = f"ETF: {_label(category)}"` and keep the "no constituent look-through" note; otherwise leave sector and industry as `UNCLASSIFIED` and add the note `"{ticker}: ETF category not set; add one in the holding."`; set `country[ticker] = FUNDS` for every ETF; do not add the "profile unavailable" note for an ETF whose category resolved. Keep `_label` truncation to 100 characters.
- [ ] **Step 4: Run the tests, ruff (check and format on the changed files), `mypy.exe app`; see them pass. Commit** `feat: classify ETF holdings by category in the portfolio`.

### Task 2: Frontend spread rule

**Files:**
- Modify: `frontend/lib/portfolio/risk.ts`
- Test: `frontend/lib/portfolio/risk.test.ts`, `frontend/components/portfolio/RiskPanel.test.tsx` only if its fixture needs a `Funds` case

**Interfaces:**
- Produces: `export const FUNDS = "Funds"` beside `UNCLASSIFIED`; in `spread`, `known()` for the country list excludes both `Unclassified` and `Funds`; `by_sector` handling is unchanged (a fund category such as `ETF: Global Equity` counts as a sector and can be the largest).

- [ ] **Step 1: Failing tests** in `risk.test.ts`: `by_country` of `[Germany 0.4, Funds 0.5, Unclassified 0.1]` gives `countries === 1`; a portfolio whose only country slice is `Funds` gives `countries === 0`; `Funds` never appears as a country count or as the largest sector; `unclassifiedSector` still reads the `Unclassified` sector slice only; the existing spread tests stay untouched and pass.
- [ ] **Step 2: Fail. Step 3: Implement** the constant and the filter. **Step 4: Run the portfolio tests, lint, typecheck. Commit** `feat: do not count the Funds slice as a country`.

### Task 3: Holding form Category field

**Files:**
- Modify: `frontend/components/portfolio/HoldingForm.tsx`
- Test: `frontend/components/portfolio/HoldingForm.test.tsx`

**Interfaces:**
- Consumes: `holding.sector` from the holding object (check the `Holding` type in `frontend/lib/api/` includes `sector: string | null`; add it if missing), the existing `assetType` state, the `apiFetch("/portfolio/holdings", ...)` POST body.
- Produces: when `assetType === "ETF"`, an optional text field labelled "Category" (helper text "Used to group this fund on the Portfolio page", max 100 characters, same `TextField` styling as the neighbouring fields), prefilled from `holding?.sector`; on save the trimmed value is sent as `sector` only when non-empty; an empty field sends nothing (the existing sector is left unchanged). Hidden for STOCK and Automatic.

- [ ] **Step 1: Failing tests:** the Category field is absent for Type Automatic and Stock and present for ETF; editing an ETF holding prefills it from `sector`; saving with "  Global Equity  " sends `sector: "Global Equity"` in the POST body; saving with the field empty sends no `sector` key; the input rejects more than 100 characters (maxLength attribute); switching the type from ETF back to Stock does not send the old value.
- [ ] **Step 2: Fail. Step 3: Implement** with one new state value and a conditional field; follow how `costBasis` and `target` are handled for building `purchaseDetails`. **Step 4: Run the portfolio component tests, lint, typecheck. Commit** `feat: let a person set an ETF's category in the holding form`.

### Task 4: Docs and a full check

**Files:**
- Modify: `docs/ARCHITECTURE.md` (the portfolio analytics section: how an ETF is classified, the precedence, the `Funds` country label, the unresolved case and its note, the holding form's Category field)

- [ ] **Step 1:** Update ARCHITECTURE.md where it says an ETF's category is Yahoo's or a "single bucket"; add the rule from the Global Constraints. **Step 2:** Run the full backend suite (`docker compose up -d` from `backend/` if ports are not published) and the full frontend suite, lint and typecheck; do not run `npm run build` while the owner's dev server is on port 3000. **Step 3:** Local check if the app can run: a held UCITS ETF shows "ETF: <category>" in the allocation donut by sector, `Funds` by country, and no "Sector not known" for it. **Step 4: Commit** `docs: describe how ETF holdings are classified`.

---

## Self-review

- **Spec coverage:** category precedence and labels, `Funds` country, unresolved note (Task 1); frontend count rule (Task 2); the form field (Task 3); docs (Task 4). The design's "no ISIN matching" and "free text field" calls are respected (no ISIN code, plain TextField).
- **Types:** `etf_category_for`, `FUNDS` (Python in `sectors.py`, TypeScript in `risk.ts`) and the existing `UNCLASSIFIED` are named the same way in every task that uses them.
- **Proportion:** three small code tasks and one docs task; one existing test is deliberately updated for the new precedence (Task 1).
