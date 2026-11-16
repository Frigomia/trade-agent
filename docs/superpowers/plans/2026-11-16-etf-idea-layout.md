# ETF idea layout implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved ETF idea layout in the frontend: the Today card for an ETF idea (direction A) and the recommendation page Overview for an ETF (direction C), with the tabs Overview, Price and Sources.

**Architecture:** Everything branches on `idea.asset_type === "ETF"`; the stock layouts are untouched. Pure helpers in one new library file (name shortening, effective positions, strip scale, gap parts, quality-filter rows, card filter line) feed four new components (a strip, the hero, the side column, the card body) that the existing `Workbench`, `OpportunityCard` and `TopOpportunity` mount for ETFs. No backend change: every number comes from the `IdeaOut` the ETF lane already saves.

**Tech Stack:** Next.js, TypeScript, MUI `sx`, Lucide icons, Vitest and Testing Library (see `frontend/AGENTS.md` for the exact lint, typecheck and test commands).

**Spec:** `docs/design/etf-ideas/SPEC.md`, the decision record `docs/design/etf-ideas/direction-approved.md` and the approved mock `docs/design/etf-ideas/etf-idea.html` (open with `?theme=dark`). The backend contract is in `docs/superpowers/specs/2026-11-16-etf-discovery-design.md`. Work happens on the branch of PR #298 (`feature/etf-discovery`), ticket #296.

## Global Constraints

- The ETF qualifying gate is its own constant, 50 (controller ruling 2026-11-16 after the owner asked for separate gates, chosen as the recommended 50 over 45; the gap score proved to sit at 37 to 54 for realistic funds: stocks keep 60). The frontend mirrors it as `ETF_GATE = 50` in `lib/etfIdea.ts` with a comment pointing at `ETF_NO_OPPORTUNITY_MIN_OVERALL` in `backend/app/analysis/discovery_score.py`.
- Branch on `idea.asset_type === "ETF"`; every stock render and every existing stock test stays byte-identical and untouched.
- DESIGN.md (the Soft look): rem sizes only (body 0.875rem, labels at least 0.75rem), green and red only for price moves, pass and unknown carried by shape plus a word (a filled circle with a tick and "Pass"; a dashed circle and "Unknown"), AI text in dashed boxes marked "Written by AI" or "AI headline", no emoji, no decorative icons, colours only through the existing CSS variables (`var(--text)`, `var(--accent)`, `var(--line2)`, ...), light and dark.
- The score is always called "Gap score", never quality or overall quality. No peers table, no quality or valuation scores, no sector, no competitors for ETFs.
- Advisory wording stays ("for human review, not a licensed advisor"); Approve and Dismiss only record a decision.
- An ETF idea's data: `scores == [fit]`, `overall` = the gap score, `peers == []`, `snapshot.sector` null, `snapshot.industry` = Yahoo category, `snapshot.fundamentals` = `expenseRatio` (a fraction: 0.0018 is 0.18%), `totalAssets`, `fundSizeEur`; `fit` = `CandidateFit` (`avg_correlation_to_portfolio`, `portfolio_vol_before`, `portfolio_vol_after`, `hhi_before`, `hhi_after`, `hypothetical_weight`).
- Phone width 390px must not overflow horizontally; touch targets at least 44px as the existing components do.
- Conventional Commits with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` trailer, GPG-signed (never `--no-gpg-sign`); no push.

## Review Focus

1. A `fit` that is missing, not applicable, or has null parts (no volatility before, HHI 0): the hero shows the gap score and hides only the strips it cannot draw; no NaN, no division by zero (Tasks 1, 2).
2. Unknown fund size: the quality filter row says Unknown, the card line is "Quality filter: 5 passed, size unknown", the side column says "Not saved with this idea" (Tasks 1, 3, 5).
3. Strip scale and 1/HHI edge cases: equal before and after, a tiny span, values at the edge, negative correlation, volatility above the scale (Tasks 1, 2).
4. Fund names: odd or long names are shortened by the rule, and wrap at 390px without overflow (Tasks 1, 5).
5. Stock regression and theme: the existing stock tests pass untouched, and an ETF idea renders in light and dark without a hard-coded colour (Tasks 4, 5).

---

### Task 0: ETF gate 50 (backend and docs)

**Files:**
- Modify: `backend/app/analysis/discovery_score.py` (`ETF_NO_OPPORTUNITY_MIN_OVERALL`), `backend/tests/test_discovery_score.py`, `docs/ARCHITECTURE.md`, `docs/superpowers/specs/2026-11-16-etf-discovery-design.md`, `docs/superpowers/specs/2026-10-14-market-discovery-design.md`

**Interfaces:**
- Produces: `ETF_NO_OPPORTUNITY_MIN_OVERALL = 50`; `is_opportunity` for an ETF requires `overall >= 50` and confidence `medium` or `high`; the stock gate `NO_OPPORTUNITY_MIN_OVERALL = 60` is unchanged.

- [ ] **Step 1: Write the failing tests:** the ETF boundary tests that used 59 and 60 now use 49 and 50 (49 is not an opportunity, 50 with `medium` is); a stock at 59 still is not and at 60 still is; a test that the two constants are separate (`ETF_NO_OPPORTUNITY_MIN_OVERALL != NO_OPPORTUNITY_MIN_OVERALL`). Also grep the backend tests for a hard-coded ETF 60 (for example in persistence and runner tests that build qualifying ETF ideas) and move those fixtures to a gap score of at least 50 where they assumed 60.
- [ ] **Step 2: Fail. Step 3: Change the constant (one line plus a comment: "gap scores for realistic funds sit at 37 to 54, so the stock gate of 60 is unreachable; see the 2026-11-16 design"). Step 4:** update the three docs: the ETF gate is 50 (stocks 60) everywhere the old ETF 60 is stated, and add one sentence in the design spec "Gap score" section with the measured range (world equity 37, emerging-market equity 43, gold 50, government bonds 54, negatively correlated hedge 61) as the reason. Run the discovery tests, ruff, mypy. **Commit** `fix: qualify ETF ideas at a gap score of 50`.

---

### Task 1: Pure helpers

**Files:**
- Create: `frontend/lib/etfIdea.ts`, `frontend/lib/etfIdea.test.ts`

**Interfaces:**
- Consumes: `IdeaOut`, `CandidateFit` from `@/lib/api/discovery-types`; `fitScore`, `etfFacts` from `@/lib/discovery`; `eurCompact`, `formatMetric` from `@/lib/metrics`.
- Produces (exact names, all exported):
  - `ETF_GATE = 50`
  - `isEtf(idea: IdeaOut): boolean`
  - `shortFundName(name: string): string` drops a trailing parenthetical share class (`(Acc)`, `(Dist)`) and then trailing ` UCITS ETF`, ` UCITS`, ` ETF` words: "iShares Core MSCI EM IMI UCITS ETF (Acc)" becomes "iShares Core MSCI EM IMI"; a name without such a suffix is unchanged; never returns an empty string (falls back to the full name).
  - `fundTags(idea: IdeaOut): string[]` returns `["ETF", ...]` plus "UCITS" when the name contains UCITS and "Acc" when it contains "(Acc)" or "Accumulating" (a distributing fund gets "Dist"); only what is detected.
  - `effectivePositions(hhi: number | null | undefined): number | null` is `1 / hhi`, null when hhi is missing, not finite or not above 0.
  - `type Scale = { min: number; max: number }` and `stripScale(values: number[], step: number): Scale`: `span = max - min`, `pad = Math.max(span, step / 2)`, `min = floor((lo - pad) / step) * step`, `max = ceil((hi + pad) / step) * step` (volatility uses step 0.01: 15.1% and 14.2% give 13% to 16%; effective positions use step 1: 4.8 and 5.3 give 4 to 6; correlation uses the fixed scale 0 to 1 and does not call this).
  - `gapParts(fit: CandidateFit | null | undefined): { volatility: number | null; concentration: number | null; correlation: number | null }` mirrors the backend `fit_dimension` in `backend/app/analysis/discovery_score.py`: correlation `100 * (1 - corr) / 2`, volatility `50 + 50 * (1 - after / before)`, concentration `50 + 50 * (1 - hhiAfter / hhiBefore)`, each clamped to 0..100 and rounded; null when its inputs are missing or the baseline is not above 0.
  - `partsAgree(parts, saved: number | null): boolean` is true when all three parts exist and their rounded mean is within 1 of `saved`.
  - `correlationWords(c: number): string`: under 0.3 "Moves mostly on its own", 0.3 to 0.7 "Moves about half in step", above 0.7 "Moves mostly with your holdings" (proposed bands).
  - `type FilterState = "pass" | "unknown"`, `type FilterRow = { key: string; label: string; detail: string; state: FilterState }` and `filterRows(idea: IdeaOut): FilterRow[]` returning six rows in order: `cost` ("Cost", detail "Expense ratio 0.18% · at most 0.50%"), `size` ("Size", "Fund size EUR 5.6B · at least EUR 100M"; `unknown` with detail "Fund size not saved · at least EUR 100M" when `fundSizeEur` is missing), `history` ("History", "At least 200 daily closes"), `plain` ("Plain fund", "Not leveraged, inverse or a trading fund"), `near-copy` ("Cheapest of its kind", "Not a near-copy of a cheaper fund in its category"), `overlap` ("No overlap with your ETFs", "Correlation to each ETF you hold · below 0.95"). A saved idea already passed the filter, so every row is `pass` except an unknown size.
  - `filterSummary(rows: FilterRow[]): string`: "6 of 6 pass" or "5 pass · 1 unknown".
  - `cardFilterLine(idea: IdeaOut): string`: "Quality filter passed: cost 0.18%, size EUR 5.6B, no overlap with your ETFs"; with an unknown size "Quality filter: 5 passed, size unknown".

- [ ] **Step 1: Write the failing tests** in `etfIdea.test.ts`: the `shortFundName` cases above plus "Vanguard FTSE All-World UCITS ETF USD Accumulation" (becomes "Vanguard FTSE All-World USD Accumulation") and "SPDR Gold" (unchanged); `stripScale([0.151, 0.142], 0.01)` is `{0.13, 0.16}` (to two decimals), `stripScale([4.76, 5.26], 1)` is `{4, 6}`, equal values give a step-sized window around them, a tiny span never returns `min === max`; `effectivePositions(0.21)` is about 4.76 and `effectivePositions(0)`, `null`, `NaN` are null; `gapParts` for correlation 0.52, vol 0.151 to 0.142, HHI 0.21 to 0.19 gives 24, 53, 55 and a mean of 44 that `partsAgree` accepts for a saved score of 44 and rejects for 72; negative correlation clamps at 100; `filterRows` has six rows, `size` is `unknown` when `fundSizeEur` is missing, `filterSummary` gives both strings; `cardFilterLine` gives both variants; stock ideas are not passed to these helpers (no test needed).
- [ ] **Step 2: Run them and see them fail.** Run the test command from `frontend/AGENTS.md` for `lib/etfIdea.test.ts`.
- [ ] **Step 3: Implement** `lib/etfIdea.ts` to the signatures above, reusing `eurCompact` and `formatMetric` (do not re-implement formatting).
- [ ] **Step 4: Run the tests, lint and typecheck; see them pass. Commit** `feat: helpers for the ETF idea layout`.

### Task 2: Gap strip and hero

**Files:**
- Create: `frontend/components/workbench/GapStrip.tsx`, `frontend/components/workbench/EtfHero.tsx`, `frontend/components/workbench/EtfHero.test.tsx`

**Interfaces:**
- Consumes: Task 1 helpers; `Panel` from `@/components/ui/Panel`; `H3` from `./Cases`; `fitScore` from `@/lib/discovery`; the mock's "If you add 5% of this fund" panel in `docs/design/etf-ideas/etf-idea.html` (read its markup and CSS).
- Produces: `GapStrip({ label, caption, change, now, withFive, nowText, withFiveText, scale, score }: { label: string; caption: string; change: string; now: number; withFive: number; nowText: string; withFiveText: string; scale: Scale; score: number | null })` draws one strip: a labelled range with both scale ends printed, a ring for now and a filled dot for with 5%, a short filled segment between them, the two values as text next to the dots, and "{score} of 100" on the right (hidden when score is null); the strip element has `role="img"` and an `aria-label` that reads like "Portfolio volatility: now 15.1%, with 5% 14.2%". A correlation variant takes an optional `reference?: { value: number; text: string }` drawn as a vertical tick labelled "Moves exactly with you 1.00". `EtfHero({ idea }: { idea: IdeaOut })` renders the panel: title "If you add 5% of this fund", the one-line explanation using the saved portfolio size when the idea carries it (otherwise "your portfolio"), the gap score as the headline number with the words "Gap score" and "of 100" (2rem, within DESIGN.md) and "Qualifies" with a tick when the gap score is at least `ETF_GATE` (50) and confidence is medium or high, the legend (Now, With 5% of {ticker}, Reference), the three strips (volatility with step 0.01 and change text "0.9 points lower"; spread of your money from `effectivePositions` with step 1 and change text "0.5 more effective positions", caption "Effective positions · HHI 0.21 to 0.19"; moves with your holdings with `correlationWords` and the fixed 0 to 1 scale), and the closing sentence "The gap score is the mean of the three part scores ({a}, {b} and {c}). An ETF qualifies at 50 or more with medium or high confidence. Computed from prices; no AI text goes into it.". A strip whose inputs are missing is not drawn; part scores are shown only when `partsAgree` is true, otherwise the strips show no score and the closing sentence drops the numbers.

- [ ] **Step 1: Write the failing tests** (Testing Library): with a sample idea whose fit gives gap 54 (correlation -0.10, volatility 0.150 to 0.142, HHI 0.200 to 0.183: parts 55, 53, 55) the hero shows "If you add 5% of this fund", "Gap score", "54", "of 100", "Qualifies", three strips with accessible names containing "now 15.1%" and "with 5% 14.2%", "4.8" and "5.3" and "HHI 0.21 to 0.19"; a `fit` of null shows the score but no strips and no NaN text; a fit with `portfolio_vol_before: null` draws two strips; `partsAgree` false hides every "of 100" part score; confidence `low` does not say "Qualifies"; an idea with gap score 49 does not say "Qualifies" and one with 50 does.
- [ ] **Step 2: Fail. Step 3: Implement** both components from the mock's markup (sx styles with the CSS variables only; no hard-coded colour; the track and dots use `var(--accent)`, `var(--track)` and `var(--line2)`). **Step 4: tests, lint, typecheck pass. Commit** `feat: gap strips and the ETF hero`.

### Task 3: Side column (fund facts and quality filter)

**Files:**
- Create: `frontend/components/workbench/EtfSideColumn.tsx`, `frontend/components/workbench/EtfSideColumn.test.tsx`

**Interfaces:**
- Consumes: `filterRows`, `filterSummary`, `fundTags` (Task 1); `etfFacts` from `@/lib/discovery`; the mock's "Fund facts" and "Quality filter" panels.
- Produces: `EtfSideColumn({ idea }: { idea: IdeaOut })` renders two panels. Fund facts: Expense ratio ("0.18% a year"), Fund size (compact EUR), Category, Structure (from `fundTags`: "UCITS · Acc"), Listing (exchange and currency from `listingText`/snapshot as the existing identity line does) and ISIN only when the snapshot carries one; a missing value reads "Not saved with this idea". Quality filter: heading with `filterSummary`, then the six rows, each with its label, its detail line and a state: a filled circle with a tick and the word "Pass", or a dashed circle and the word "Unknown".

- [ ] **Step 1: Failing tests:** all six rows with "Pass" for the sample; the unknown-size idea shows "Unknown" on the size row, "5 pass · 1 unknown" in the heading and "Not saved with this idea" for Fund size; the state words are present as text (not colour alone); no row mentions a correlation number. **Step 2: Fail. Step 3: Implement. Step 4: Pass. Commit** `feat: ETF fund facts and quality filter panels`.

### Task 4: ETF Overview, tabs and rail wiring

**Files:**
- Create: `frontend/components/workbench/EtfOverview.tsx`, `frontend/components/workbench/EtfOverview.test.tsx`
- Modify: `frontend/components/workbench/Workbench.tsx`, `frontend/components/workbench/Overview.tsx` (export `ChartPanel`), `frontend/components/workbench/DecisionRail.tsx` (and `DecidedRail.tsx` if it shows the score), their existing tests only by adding ETF cases

**Interfaces:**
- Consumes: Tasks 2 and 3; `BearCase`, `H3`, `BODY` from `./Cases`; `SourcesTab`; `ChartPanel` (now exported from `Overview.tsx`).
- Produces: `EtfOverview({ idea, recommendationId })` renders, in the mock's order: `EtfHero`; "The role it plays" (the thesis in the dashed box with "Written by AI · N cited sources", reuse the existing thesis expand behaviour if it can be shared without changing stock output, otherwise a small ETF-only version); catalysts and the bear case side by side in dashed boxes (catalysts only when present, "Dated events only"); the conclusion in a dashed box; and the sources list (reuse `SourcesTab`). In `Workbench.tsx`, for an ETF the tab list is Overview, Price, Sources (a second constant `ETF_TABS`; the stock `TABS` stays as is) and `tab` state resets to a valid key; Price renders `ChartPanel`. On desktop the right column stacks the decision rail and `EtfSideColumn`; on a phone `EtfSideColumn` follows the hero as in the mock's phone section. In the rails, an ETF's score row is labelled "Gap score" (find the "Fit" label via `fitScore` use in `DecisionRail.tsx` line ~26 and the decided rail) and the stock label stays unchanged.

- [ ] **Step 1: Failing tests:** an ETF `Workbench` shows exactly the tabs Overview, Price, Sources and no Numbers or Risk tab; the rail shows "Gap score"; the Overview contains the hero, the role panel with its "Written by AI" label, the bear case, the conclusion and the side column panels; a stock `Workbench` still shows its four tabs and the existing stock tests pass untouched; the Price tab shows the chart panel; keyboard arrows still move between the ETF tabs; no "Peers" or "Valuation" text appears for an ETF; an approved ETF idea shows the status strip and the decided rail with "Gap score".
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: run the workbench, discovery and page tests plus lint and typecheck. Commit** `feat: ETF recommendation page with before and after Overview`.

### Task 5: Today card

**Files:**
- Create: `frontend/components/discovery/EtfCardBody.tsx`, `frontend/components/discovery/EtfCardBody.test.tsx`
- Modify: `frontend/components/discovery/OpportunityCard.tsx`, `frontend/components/discovery/TopOpportunity.tsx` (ETF branch only), `frontend/components/discovery/DiscoveryFeed.test.tsx` (add cases)

**Interfaces:**
- Consumes: `shortFundName`, `fundTags`, `cardFilterLine` (Task 1); `Meter`, `confidenceLabel`, `meterFill`; `fitScore`; the mock's Today card (direction A).
- Produces: `EtfCardBody({ idea }: { idea: IdeaOut })` renders: a chip "Gap score 72" with a small 0 to 100 track (accent fill), the confidence chip (meter and word), the category chip (`snapshot.industry`, plain chip with the same shape as the existing chips), the headline in a dashed box marked "AI headline" (`headline`, falling back to the thesis clamped to three lines as the stock card does), and the filter line with a filled tick. `OpportunityCard` and `TopOpportunity` mount it instead of `IdeaChips` plus the headline for an ETF; the identity row shows `shortFundName(name)`, a second line `{ticker} · {fundTags}` and the price and quote date as the stock card does (`PriceBlock`); Open research and Save are unchanged. `TopOpportunity` keeps its hero frame and only swaps the body.

- [ ] **Step 1: Failing tests:** the sample card shows "iShares Core MSCI EM IMI" (shortened), the ticker line with "ETF · UCITS · Acc", "Gap score 72", "High confidence", the category, "AI headline", and "Quality filter passed: cost 0.18%, size EUR 5.6B, no overlap with your ETFs"; the unknown-size idea shows "Quality filter: 5 passed, size unknown"; a 90-character name renders with the `overflowWrap` rule (assert the class or style); the stock card's output is unchanged (existing tests untouched); the old ETF facts test in `DiscoveryFeed.test.tsx` is updated to the new card text, not weakened (it must still assert expense ratio, fund size and category).
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass. Commit** `feat: Today card for ETF ideas`.

### Task 6: Browser pass and docs

**Files:**
- Modify: `DESIGN.md` (a short note after the "Scan results" paragraph: the ETF idea layout, the gap strips, the pass and unknown shapes), `docs/design/README.md` (status "Built (#296)"), `docs/design/etf-ideas/SPEC.md` (a "Changed during the build" section if anything differs from the mock)

- [ ] **Step 1:** Run the full frontend checks (`frontend/AGENTS.md`: lint, typecheck, tests, build). **Step 2:** Do the real-browser pass `frontend/AGENTS.md` asks for if the app and a seeded ETF idea can run here (compare light, dark and 390px with `etf-idea.html`); if they cannot, say exactly why in the report and list what the owner should look at. **Step 3:** Update the three docs. **Step 4: Commit** `docs: record the ETF idea layout`.

---

## Self-review

- **Spec coverage:** card (Task 5), hero with strips and the 1/HHI and scale rules (Tasks 1, 2), side column and the six filter rows with the unknown variant (Tasks 1, 3), tabs Overview, Price, Sources and the "Gap score" label in the rails (Task 4), name shortening (Tasks 1, 5), sample defaults 1 to 8 of `direction-approved.md` (Tasks 1 to 5), docs and browser pass (Task 6).
- **Types:** `Scale`, `FilterRow`, `gapParts`, `partsAgree`, `stripScale`, `effectivePositions`, `filterRows`, `filterSummary`, `cardFilterLine`, `shortFundName`, `fundTags` are defined in Task 1 and used with the same names in Tasks 2 to 5.
- **Rulings for the executor:** `TopOpportunity` gets the same ETF body (the mock shows only the list card); the Sources list appears in the ETF Overview as in the mock and in the Sources tab; the part scores are recomputed from the saved fit with the backend formula and shown only when they agree with the saved gap score (the backend does not save them).
