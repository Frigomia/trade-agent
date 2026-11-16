# ETF ideas in the new-ideas scan: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Today scan recommends UCITS ETFs next to stocks, in a separate lane inside the same scan, judged by how well a fund fills a gap in the person's portfolio and gated by a cost and size filter.

**Architecture:** ETFs bypass the stock peer scoring. A new module `backend/app/discovery/etf.py` holds the ETF eligibility, quality filter, near-copy removal and gap ranking as pure functions over the stored snapshots. The gap score is the existing `fit` dimension, so an ETF idea's `overall` equals it and the existing ranking, gate and saving code is shared. `evaluate_scan` runs both lanes through the same candidate graph, with ETF-specific research wording.

**Tech Stack:** Python, FastAPI, LangGraph, pydantic, yfinance, pytest, ruff, mypy; the frontend is Next.js and TypeScript (types and one safety test only; the ETF idea layout is a later, separately approved design slice).

**Spec:** `docs/superpowers/specs/2026-11-16-etf-discovery-design.md` (approved by the owner, UCITS only).

## Global Constraints

- Advisory only. No code calls a broker or places a trade.
- Numeric decisions stay in code. The model writes prose and never a score, filter result or confidence.
- Stock lane unchanged: same universe rows, peer scoring, `NO_OPPORTUNITY_MIN_OVERALL = 60`, `SHORTLIST_SIZE = 8`.
- Proposed constants, each one named constant, in `backend/app/discovery/etf.py` unless noted: `ETF_SLOTS = 3`, `ETF_MAX_EXPENSE_RATIO = 0.005`, `ETF_MIN_SIZE_EUR = 100_000_000.0`, `ETF_MIN_CLOSES = 250`, `ETF_MIN_SHARED_INTERVALS = 60`, `ETF_NEAR_COPY_CORRELATION = 0.95`, `ETF_MIN_HOLDINGS = 2`; in `analysis/discovery_score.py`: `ETF_NO_OPPORTUNITY_MIN_OVERALL = 60`.
- UCITS only: an ETF is recommendable only when its universe row has `ucits=yes` and a valid ISIN whose prefix is in `UCITS_ISIN_PREFIXES = {"IE", "LU", "DE", "FR", "NL"}`.
- ETF facts travel in the existing idea snapshot (`fundamentals` map: `expenseRatio`, `totalAssets`, `fundSizeEur`; `industry` holds the Yahoo category). `IdeaOut` is reused; no breaking API change.
- Never hand-edit an existing migration (this plan needs none). Conventional Commits with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` trailer. Run ruff by hand (`backend/.venv/Scripts/ruff.exe check --fix <files>` and `format`), then mypy and pytest as `backend/AGENTS.md` requires. Pure-function tests run with `--noconftest`; tests needing the database need `docker start backend-postgres-1 backend-redis-1`.
- Update `docs/ARCHITECTURE.md` in the same change as the code (Task 10). Frontend work follows the design process in `docs/design/README.md`.

## Review Focus

Failure modes the spec implies; each has a test in the named task.

1. Fewer than two valued holdings: the lane is skipped, the scan still completes and says why (Task 7).
2. A fund quoted in GBp, GBP or USD: fund size is converted to EUR before the 100M test (Task 3).
3. A snapshot cached before this change has none of the new fields and must still load (Task 2).
4. An ETF with no expense ratio, or no fit, is excluded or low confidence and can never qualify (Tasks 3 and 5).
5. All ETF candidates failing must not fail a scan whose stock lane worked, and ETFs must not add "needs separate criteria" noise to the stock exclusions (Tasks 4 and 7).

---

### Task 1: Universe file columns and validation

**Files:**
- Modify: `backend/app/discovery/universe.py`, `backend/app/discovery/universe.csv`
- Test: the existing universe test file (find it with `grep -rl load_universe backend/tests`)

**Interfaces:**
- Produces: `UniverseRow` gains `isin: str`, `ucits: bool`, `ter: float | None`, `size_eur_m: float | None`; `COLUMNS` gains `isin, ucits, ter, size_eur_m` appended after `notes`; `UCITS_ISIN_PREFIXES: frozenset[str]`; `is_valid_isin(text: str) -> bool` (12 characters, country letters, ISO 6166 check digit).

- [ ] **Step 1: Write failing tests.** `is_valid_isin("IE00B4L5Y983")`, `("IE00B53SZB19")`, `("IE00BKM4GZ66")` are true and `("IE00B4L5Y984")` (bad check digit) is false. A row with `ucits=yes` must be an ETF with a valid ISIN whose prefix is in `UCITS_ISIN_PREFIXES` (a `US...` ISIN, a stock row, or a blank ISIN each raise `UniverseFileError` naming the line). `ter` must be blank or in (0, 0.05]; `size_eur_m` blank or positive. A row with all four new cells blank except `ucits=no` loads as before.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the columns, `is_valid_isin` (Luhn over the digit expansion of the letters), the validations and `ucits` parsing (`yes` or `no` only; blank is an error).
- [ ] **Step 4: Migrate the CSV** with a throwaway script (not committed): append `,,no,,` to every existing row, then set `isin`/`ucits=yes` on `IWDA.AS` (IE00B4L5Y983), `VWCE.DE` (IE00BK5BQT80) and `VWRL.L` (IE00B3RBWM25). The loader test validates the check digits offline; the live name check is Task 9.
- [ ] **Step 5: Run the universe tests and the full discovery tests; ruff, mypy. Commit** `feat: universe rows carry isin, ucits, ter and size`.

### Task 2: Snapshot carries ETF facts

**Files:**
- Modify: `backend/app/discovery/snapshot.py`, `backend/app/discovery/refresh.py` (and its callers: `grep -rn refresh_snapshot backend/app`)
- Test: `backend/tests/test_discovery_snapshot.py` (the existing snapshot test file)

**Interfaces:**
- Consumes: Task 1 `UniverseRow`.
- Produces: `SymbolSnapshot` gains defaulted `category: str | None = None`, `isin: str | None = None`, `ucits: bool = False`, `inception: str | None = None`. `to_snapshot(ticker, raw, country=None, row: UniverseRow | None = None)` fills them for `asset_type == "ETF"` and sets `metrics["expenseRatio"]` (the row's `ter`, else Yahoo `netExpenseRatio` divided by 100 if the spike (Task 9) shows percent units, else None), `metrics["totalAssets"]` (Yahoo, native currency), `metrics["fundSizeEur"]` (the row's `size_eur_m * 1e6`, else None). `ETF_CORE_FIELDS = ("expenseRatio", "fundSize")` and `etf_coverage_of(metrics) -> Coverage` where `fundSize` counts as present when `fundSizeEur` or `totalAssets` is finite. `refresh_snapshot(..., rows: Mapping[str, UniverseRow] | None = None)` passes each ticker's row through.

- [ ] **Step 1: Write failing tests:** an ETF `info` with `category`, `netExpenseRatio`, `totalAssets` produces the new fields; a row's `ter` overrides Yahoo; `etf_coverage_of` lists `fundSize` missing when neither source has it; a snapshot JSON string written before this change (no new keys) loads through `SymbolSnapshot.from_json` with defaults; stock snapshots are unchanged.
- [ ] **Step 2: Fail. Step 3: Implement.** Keep `normalize_metrics` for stocks untouched; add `normalize_etf_metrics(info, row)`.
- [ ] **Step 4: Update the callers** that build the `countries` mapping to also pass `rows`.
- [ ] **Step 5: Tests, ruff, mypy. Commit** `feat: snapshot stores ETF category, cost and size`.

### Task 3: ETF eligibility, quality filter and overlap

**Files:**
- Create: `backend/app/discovery/etf.py`, `backend/tests/test_discovery_etf.py`
- Modify: `backend/app/schemas_discovery.py` (the `Exclusion.reason` literal at line 310)

**Interfaces:**
- Consumes: `SymbolSnapshot` (Task 2); `market_cap_to_eur(cap, currency, rates)` from `app/discovery/risk.py`; `ReturnSeries`, `log_returns`, `clean_history`, `pairwise_correlation` from `app/analysis/portfolio.py`.
- Produces: `Exclusion.reason` gains `"not_ucits"`, `"fails_quality_filter"`, `"overlaps_holding"`. In `etf.py`: the constants from Global Constraints; `fund_size_eur(snap: SymbolSnapshot, rates: Mapping[str, Decimal]) -> float | None` (the `fundSizeEur` override when present, else `market_cap_to_eur(totalAssets, currency, rates)`); `etf_exclusion(snap, *, stale: str | None, rates, returns: ReturnSeries, holding_returns: Mapping[str, ReturnSeries], held_etfs: Collection[str], held_categories: Mapping[str, str | None]) -> Exclusion | None` (None means eligible and passed the filter).

Order inside `etf_exclusion` (first failure wins, each with a plain-language `explanation`): not UCITS (`not_ucits`, "not available to EU retail investors"); currency not in `fx.SUPPORTED`, or price or history missing or invalid, or stale (the same reasons as stocks, `unreliable_price` and `currency_unsupported`); fewer than `ETF_MIN_CLOSES` closes (`insufficient_data`); fewer than `ETF_MIN_SHARED_INTERVALS` matching return intervals with the holdings (`insufficient_data`); no expense ratio (`insufficient_data`); name or category marks it leveraged or inverse (`fails_quality_filter`); overlap with a held ETF (`overlaps_holding`: same category and correlation at least `ETF_NEAR_COPY_CORRELATION`, and when the held fund's category is unknown, correlation alone decides: a ruling, because an unknown category cannot prove a difference); expense ratio above `ETF_MAX_EXPENSE_RATIO` or fund size below `ETF_MIN_SIZE_EUR` when size is known (`fails_quality_filter`; unknown size does not fail, it lowers confidence in Task 5).

- [ ] **Step 1: Write failing tests**, one per rule above plus: a GBp-quoted fund and a USD fund with size just above and just below 100M EUR after conversion (Review Focus 2); `fundSizeEur` override beats Yahoo; a fund with exactly 0.50% passes; the three named funds (IWDA.AS, a Nasdaq 100 fund, an EM IMI fund) pass with healthy fixtures.
- [ ] **Step 2: Fail. Step 3: Implement** `fund_size_eur` and `etf_exclusion`. Leveraged markers are a named tuple of lowercase tokens (`"2x"`, `"3x"`, `"leveraged"`, `"inverse"`, `"ultrashort"`, `"short "`), tested against name and category.
- [ ] **Step 4: Extend the `Exclusion.reason` literal and the frontend union later in Task 10. Tests, ruff, mypy. Commit** `feat: ETF eligibility, quality filter and overlap tests`.

### Task 4: ETF candidates, near-copy removal and gap ranking

**Files:**
- Modify: `backend/app/discovery/etf.py`, `backend/app/discovery/screen.py` (the stock loop), `backend/app/analysis/discovery_score.py` (rename `_fit_dimension` to the public `fit_dimension`, update its one caller)
- Test: `backend/tests/test_discovery_etf.py`, the existing screen tests

**Interfaces:**
- Consumes: Tasks 1 to 3; `marginal_effect(exposure, candidate_returns, candidate_sector, hypothetical_weight=0.05, *, ticker, portfolio_returns)`; `PortfolioExposure` and `Histories` (as imported in `discovery/runner.py`); `build_risk_profile` (called with `group="etf"`; if it raises or returns "unknown" for an ETF, adapt it in this task and test it).
- Produces: `build_etf_candidate(snap, rates, uncertain: str | None) -> CandidateMetrics` (`asset_type="ETF"`, `sector=None`, `industry=snap.category`, `peers=[]`, `fundamentals=snap.metrics`, `coverage=etf_coverage_of(...)`); `@dataclass(frozen=True) class EtfShortlist: candidates: list[CandidateMetrics]; excluded: list[Exclusion]; eligible: int; skipped_reason: str | None`; `shortlist_etfs(snapshots: Sequence[SymbolSnapshot], freshness: Freshness, rates, *, holdings: Collection[str], held_etfs: Collection[str], exposure: PortfolioExposure, histories: Histories, today: date, size: int = ETF_SLOTS) -> EtfShortlist`.

`shortlist_etfs` behaviour: when `len(exposure.positions) < ETF_MIN_HOLDINGS` return an empty list with `skipped_reason = "ETF ideas need at least two holdings with price history"` and no exclusions. Otherwise: skip held tickers; run `etf_exclusion` per ETF snapshot (candidate returns come from `log_returns(clean_history(dict(zip(snap.dates, snap.closes, strict=True)), today))`); among the survivors drop near-copies (same category and correlation at least `ETF_NEAR_COPY_CORRELATION`, keep the lowest expense ratio, then the largest size; the dropped ones are `fails_quality_filter` exclusions saying which fund replaced them); score each with `marginal_effect` then `fit_dimension`, dropping a fund whose fit score is None as `insufficient_data`; sort by score descending then ticker; take at most one fund per category; cut to `size`. `eligible` counts the survivors before the cut.

- [ ] **Step 1: Write failing tests** with synthetic return series: VT, VWCE and IWDA-like near-copies leave only the cheapest; a low-correlation fund outranks a high-correlation one; at most one per category; a held ETF is not recommended; fewer than two positions gives `skipped_reason`; ETF snapshots add no entries to the stock lane's exclusions (Review Focus 5).
- [ ] **Step 2: Fail. Step 3: Implement.** In `shortlist_for_user` (`screen.py`), skip `snap.asset_type == "ETF"` before `is_eligible` (the ETF branch inside `is_eligible` stays as a guard for the mentions path in `admit.py`). Update the screen tests that expected the "needs separate criteria" exclusion.
- [ ] **Step 4: Tests, ruff, mypy. Commit** `feat: ETF shortlist ranked by portfolio gap`.

### Task 5: ETF scoring, confidence and gate

**Files:**
- Modify: `backend/app/analysis/discovery_score.py`
- Test: `backend/tests/test_discovery_score.py`

**Interfaces:**
- Consumes: `fit_dimension`, `Evaluation`, `CandidateMetrics`, `ResearchEvidence`.
- Produces: `ETF_NO_OPPORTUNITY_MIN_OVERALL = 60`; `evaluate` returns, for `candidate.asset_type == "ETF"`, `scores=[fit_dimension(fit)]`, `overall` equal to that fit score (None when the fit score is None), `style_tags=[]` and confidence from `_etf_confidence`; `is_opportunity(idea)` uses the minimum for `idea.asset_type` (60 for stocks, `ETF_NO_OPPORTUNITY_MIN_OVERALL` for ETFs) and still requires `medium` or `high`.

`_etf_confidence` is `low` when the fit score is None, the expense ratio or the category is missing, the price is missing or has no date, or no non-forum research exists; `medium` when the fund size is unknown, the price date is uncertain, there are research conflicts or gaps, an unresolved negative development, or no official or reliable-reporting fact; otherwise `high`. Reuse the research checks of `_confidence` by extracting them into a helper rather than copying them.

- [ ] **Step 1: Write failing tests:** an ETF evaluation with a fit of 72 and clean evidence is overall 72, `high`; fit None gives overall None, `low`; missing expense ratio gives `low`; a fit of 59 is not an opportunity and 60 with `medium` is; a stock at 59 still is not; stock evaluations are byte-for-byte unchanged (compare an existing fixture).
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Tests, ruff, mypy. Commit** `feat: score ETF ideas by portfolio gap with their own confidence`.

### Task 6: ETF research and synthesis wording

**Files:**
- Modify: `backend/app/agents/research.py` (`research_candidate`, line 530), `backend/app/agents/discovery_graph.py` (`research_node`, `synthesize`, `_quant_only`)
- Test: `backend/tests/test_discovery_graph.py` and the research tests (no network; patch `_gather` and `_extract`)

**Interfaces:**
- Consumes: `CandidateMetrics.asset_type`.
- Produces: `research_candidate(..., asset_type: str = "STOCK")`: for `"ETF"` it builds queries about the issuer, the index tracked, replication method, fees, domicile, and fund events (index change, merger, closure, fee change), and uses `ETF_RESEARCH_SYSTEM_PROMPT`; `ETF_SYNTHESIS_SYSTEM_PROMPT` describes the fund's role in this portfolio. Both prompts keep every untrusted-data, no-trade, citation and "not a licensed advisor" clause of the stock prompts verbatim; only the subject changes from "one company" to "one ETF". `research_node` passes `candidate.asset_type`; `synthesize` picks the ETF prompt; `_quant_only` returns ETF wording (no company language).

- [ ] **Step 1: Write failing tests:** the ETF queries mention "index" and "closure" and the stock ones are unchanged; the ETF prompt contains the same safety clauses as the stock prompt (assert on the shared substrings); an ETF `synthesize` run with a stub model yields an `IdeaOut` with `asset_type == "ETF"`, `snapshot.industry` equal to the category and `snapshot.fundamentals` carrying `expenseRatio`.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Tests, ruff, mypy. Commit** `feat: research and write up ETF ideas`.

### Task 7: Scan runs the ETF lane

**Files:**
- Modify: `backend/app/discovery/runner.py` (`evaluate_scan`, `ScanEvaluation`)
- Test: the existing runner tests (`grep -rl evaluate_scan backend/tests`)

**Interfaces:**
- Consumes: `shortlist_etfs`, `EtfShortlist` (Task 4), `evaluate_candidate`, `load_fit_context`.
- Produces: the `PositionInput` list also feeds `held_etfs` (tickers whose `asset_type == "ETF"`). `evaluate_scan` loads the fit context whenever there are holdings, builds the stock shortlist as today and the ETF shortlist from the same snapshots, then evaluates `stock candidates + ETF candidates` under the same semaphore. Counts are summed (`eligible`, `shortlisted`, `researched`). `coverage_summary["etf_lane"] = {"eligible": int, "shortlisted": int, "researched": int, "skipped_reason": str | None}`. ETF exclusions join `excluded`. `CandidateEvaluationUnavailable` is raised only when every candidate of both lanes failed. Progress totals include both lanes.

- [ ] **Step 1: Write failing tests:** a scan with two holdings and a healthy ETF returns an ETF idea next to stock ideas; one holding gives `skipped_reason` and the stock result is unchanged (Review Focus 1); every ETF candidate failing while a stock succeeds does not raise (Review Focus 5); a stock-only universe produces `etf_lane` with zeros.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Tests, ruff, mypy. Commit** `feat: run the ETF lane inside the discovery scan`.

### Task 8: Saving, bounds and search budget

**Files:**
- Modify: `backend/app/discovery/persistence.py` (the `set_aside_ideas` bound), `backend/app/scheduled.py` (line 419 budget)
- Test: `backend/tests/test_discovery_persistence.py` and the scheduled tests

**Interfaces:**
- Consumes: `ETF_SLOTS`. Produces: the set-aside bound becomes `SHORTLIST_SIZE + ETF_SLOTS`; the scheduled search budget becomes `(SHORTLIST_SIZE + ETF_SLOTS) * (research.CANDIDATE_QUERY_BUDGET + 1)`.

- [ ] **Step 1: Write failing tests:** `save_scan` with one qualifying ETF idea writes a `Recommendation` with `asset_type="ETF"`, `action="BUY"`, `source="discovery"`, status PENDING and the suggested size by the stock rule; a second scan supersedes the earlier pending ETF row; the set-aside list can hold eleven entries; the scheduled budget check counts the ETF slots. Check `notify.py` and `discovery/company_jobs.py` (both call `is_opportunity`) for stock-only assumptions and add a test if they have any.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Tests, ruff, mypy. Commit** `feat: save ETF ideas and budget their research`.

### Task 9: Validator, Yahoo field spike and first universe batch

**Files:**
- Modify: `backend/app/discovery/validate_universe.py`, `backend/app/discovery/universe.csv`
- Create: `docs/superpowers/specs/2026-11-16-etf-yahoo-fields.md`

This task needs a network without TLS interception (not this machine, where Avast blocks Yahoo). Ask the owner to run the commands, or run them in CI. Tasks 1 to 8 do not wait for it, because `ter` and `size_eur_m` in the CSV override Yahoo.

- [ ] **Step 1: Extend `check_symbol`** for ETF rows: live quote type is ETF, name matches, currency matches, and the result reports which of `category`, `netExpenseRatio`, `totalAssets`, `fundInceptionDate` Yahoo returned; add the counts to `build_report`. Offline tests with a fake fetch.
- [ ] **Step 2: Run the spike** for the three named funds (iShares NASDAQ 100 UCITS Acc IE00B53SZB19, iShares Core MSCI World IE00B4L5Y983 as `IWDA.AS`, iShares Core MSCI EM IMI IE00BKM4GZ66) and about 40 other UCITS funds (global, US, Europe, EM, Japan and Asia, small caps, a few sectors, government and corporate bonds, gold). Record in the findings doc, per field, how many funds had it, its units (percent or fraction for the expense ratio), and the decision: Yahoo, CSV, or drop the size test.
- [ ] **Step 3: Add the validated rows** to `universe.csv` (one listing per ISIN, EUR venue preferred, else London; `ucits=yes`; fill `ter` and `size_eur_m` where Yahoo lacks them). Update the `netExpenseRatio` unit handling in Task 2 to the finding. Update the regional composition note in the market-discovery spec (the ETF target is about 100 to 150, grown in batches).
- [ ] **Step 4: Run the validator and the universe tests. Commit** `feat: validate and add UCITS ETFs to the discovery universe`.

### Task 10: API types, safe rendering and documentation

**Files:**
- Modify: `frontend/lib/api/discovery-types.ts` (the exclusion reason union), `frontend/components/discovery/ScanLedger.tsx` and `frontend/lib/scanResults.ts` (reason labels), `docs/ARCHITECTURE.md` (discovery sections and the exclusion reasons), `docs/superpowers/specs/2026-10-14-market-discovery-design.md` (ETF out-of-scope note and the fit rule)
- Test: `frontend/lib/scanResults.test.ts`, `frontend/components/discovery/ScanResults.test.tsx`, `frontend/app/(shell)/today/[id]/page.test.tsx`

**Interfaces:**
- Produces: the union gains `not_ucits`, `fails_quality_filter`, `overlaps_holding` with plain labels ("Not available to EU retail investors", "Failed the cost or size filter", "Overlaps a fund you hold"); the Scan results page shows `coverage_summary.etf_lane.skipped_reason` as a note when present.

- [ ] **Step 1: Write failing frontend tests:** the new reasons render with their labels; an ETF idea fixture (empty `peers`, only a `fit` score, `snapshot.fundamentals` with `expenseRatio`, `totalAssets`, `industry` as category) renders on the recommendation page and the card without throwing; the `etf_lane.skipped_reason` note shows.
- [ ] **Step 2: Fail. Step 3: Implement the types, labels and note; the minimal ETF fields on the card** (expense ratio, fund size, category) only, no redesign.
- [ ] **Step 4: Update `ARCHITECTURE.md`** (ETF lane, the new `Exclusion` reasons, `coverage_summary.etf_lane`, the universe columns) and the spec notes.
- [ ] **Step 5: Frontend lint, typecheck, tests per `frontend/AGENTS.md`. Commit** `feat: show ETF scan results and document the ETF lane`.

### Task 11: ETF idea layout (design gate, no code)

The idea detail and Today card for ETFs follow the repository design process: show the owner three real options in a mock in `docs/design/etf-ideas/` (use `/huashu-design` and `/impeccable`, Soft look from `DESIGN.md`: expense ratio, fund size, category, the gap evidence of correlation, volatility and concentration change, and the quality-filter result), record the choice in `direction-approved.md`, add it to `docs/design/README.md`, and write a short build plan for the approved layout. Nothing is built before the owner approves.

---

## Self-review

- **Spec coverage:** UCITS-only and the universe (Tasks 1, 9); data and the spike (Tasks 2, 9); eligibility, per-fund 60-interval check, quality filter with EUR conversion (Task 3); near-copy dedupe, overlap exclusion, one per category, gap score (Tasks 3 to 5); confidence and gate (Task 5); research and thesis (Task 6); slots, counts and skipped lane (Task 7); saving, supersede, size, budget (Task 8); Scan results and API (Task 10); docs (Tasks 9 and 10); ETF layout (Task 11). Nothing is left without a task.
- **Types:** `fit_dimension` (renamed in Task 4, used in Tasks 4 and 5), `EtfShortlist`, `etf_coverage_of`, `fund_size_eur` and the constant names match across tasks.
- **Proportion:** the plan states interfaces, test names and rules, not the function bodies.
