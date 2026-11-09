# Reopen a saved company Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening a saved discovery idea from Discover shows the newer analysis, a Withdrawn view, or the research read-only with the person's decision, instead of a dead-end message or the confirmation screen.

**Architecture:** The backend adds two computed fields to `GET /analysis/recommendations/{id}` (`successor_id`, `withdrawal`) and a `report_status` to each Discover item; no table or column changes. The frontend company page (`today/[id]`) routes on those: redirect, Workbench with a status strip and a decided or withdrawn rail, or the existing confirmation shown only in the visit that decided. The Discover card gets a decision chip.

**Tech Stack:** FastAPI, SQLAlchemy sync sessions, pytest; Next.js 16, MUI 9, SWR, Vitest.

**Spec:** `docs/design/reopen-saved-company/SPEC.md` (approved mock `reopen.html`, same folder), GitHub issue #283.

## Global Constraints

- The system never places a trade: no Buy, Sell, Deposit or Withdraw control. "Log the trade I placed" is the existing past-tense log (`LogTradeCta`).
- No database migration. Do not touch `backend/migrations/versions/`.
- Green and red appear only on a price move. Status is shape plus word, never colour alone. AI text (the withdrawn reason) sits in the dashed box; the person's own dismissal note and system sentences do not.
- "replaced" appears in copy only when a replacement exists. A withdrawn idea never says it.
- Every note and reason is rendered as text, never markup. A long unbroken note wraps (`overflowWrap: "anywhere"`).
- Sizes in rem (DESIGN.md); 44px touch targets on a phone; named exports; backend calls through `apiFetch`; no `useEffect` for anything derivable during render.
- After backend Python: `uv run ruff check --fix <files>` from `backend/`, then `uv run pytest` for the touched tests. Frontend: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.
- Conventional Commits, ending with the attribution trailer the session gives. Branch `feature/reopen-saved-company` from master.

## Rulings (differences from the approved mock, owner to confirm)

- **"Run a new analysis" is shown on the withdrawn page but disabled (owner decision, 2026-11-09).** `POST /discover/{ticker}/analyze` returns the saved result without a new run when the latest company analysis is `report` or `no_opportunity` (`backend/app/discovery/company_jobs.py`, around line 322), so an enabled button could not start anything for many withdrawn ideas. The button stays in the rail, disabled, with the line "Re-running a researched company is not available yet." under it, and calls nothing. Company overview is the primary action. Making it work is a separate ticket with its own usage rules. This resolves open question 3.
- The "Newer analysis" strip is driven by `?from=superseded` and has no dismiss control (open question 2 default). The sidebar still highlights Today (open question 1 default).

## File Structure

- Backend create: `backend/app/discovery/withdrawal.py` (successor and withdrawal lookup), `backend/tests/test_discovery_withdrawal.py`.
- Backend modify: `backend/app/schemas.py` (`WithdrawalOut`, two fields on `RecommendationOut`), `backend/app/routers/analysis.py` (`get_recommendation`), `backend/app/routers/discover.py` (`_analysis`, `DiscoverItemOut`, `_item_out`), `backend/tests/test_analysis_router.py`, `backend/tests/test_discover.py`.
- Frontend create: `frontend/lib/decisionView.ts` (+test), `frontend/components/workbench/StatusStrip.tsx` (+test), `frontend/components/workbench/DecidedRail.tsx` (+test).
- Frontend modify: `frontend/lib/api/recommendation-types.ts`, `frontend/lib/api/discover-types.ts`, `frontend/lib/discoverList.ts` (+test), `frontend/components/workbench/Workbench.tsx`, `frontend/components/workbench/DecisionRail.tsx` (DecisionSummary only), `frontend/components/recommendations/ConfirmationPanel.tsx`, `frontend/app/(shell)/today/[id]/page.tsx` (+test), `frontend/components/discover/DiscoverCard.tsx` (+test).
- Docs: `docs/ARCHITECTURE.md`, `DESIGN.md`, `docs/design/README.md`, `docs/design/reopen-saved-company/*` (commit the folder with this work).

## Review Focus

1. A superseded idea whose newest successor is already approved or dismissed: the redirect lands on the decided view and nothing says "waiting" (Task 5).
2. A superseded idea with nothing saved by any scan or analysis: Withdrawn view, generic sentence, no dashed box, no "replaced" (Tasks 1 and 5).
3. `price_at_recommendation` or `current_price` null or zero: no "since recommended" line, no NaN or Infinity (Task 3).
4. Reload, back button or reopen after deciding: the decided view with its strip, not the confirmation (Task 5).
5. A reason or note containing markup or a very long unbroken string renders as text and wraps (Task 4).
6. Successor and withdrawal lookups never read another person's rows (Task 1).

---

### Task 1: Successor and withdrawal lookup (backend)

**Files:**
- Create: `backend/app/discovery/withdrawal.py`, `backend/tests/test_discovery_withdrawal.py`
- Modify: `backend/app/schemas.py` (near `RecommendationOut`, line ~146), `backend/app/routers/analysis.py` (`get_recommendation`, line ~191), `backend/tests/test_analysis_router.py` (near `test_get_recommendation_by_id`, line ~528)

**Interfaces:**
- Produces in `schemas.py`: `class WithdrawalOut(BaseModel)` with `kind: Literal["invalidated", "not_compelling"]`, `reason: str | None`, `as_of: datetime | None`. `RecommendationOut` gains `successor_id: int | None = None` and `withdrawal: WithdrawalOut | None = None`.
- Produces in `withdrawal.py`: `def successor_id(db: Session, rec: Recommendation) -> int | None` and `def withdrawal_for(db: Session, rec: Recommendation) -> WithdrawalOut`.
- Consumes: models `Recommendation`, `ScanRun`, `CompanyAnalysis`; the session is the per-user RLS session from `get_user_db`.

**Rules to implement:**
- Both apply only to a `SUPERSEDED` row with `source == "discovery"`; anything else leaves both fields `None`. The list endpoint leaves them `None` (compute only in `get_recommendation`).
- `successor_id`: the highest `Recommendation.id` for the same user and ticker with `source == "discovery"`, `idea` not null and `id` greater than the opened one, any status; else `None`.
- `withdrawal_for` is called only when there is no successor. Candidates, all strictly newer than `rec.created_at`, same user and ticker: (a) the newest `ScanRun` whose `excluded` holds an entry for the ticker with `reason == "thesis_invalidated"` gives kind `invalidated`, reason its `explanation`, as_of the scan's `created_at`; (b) the newest `CompanyAnalysis` with `status == "no_opportunity"` and `researched` gives kind `not_compelling`, reason its `reason`, as_of `finished_at` or `created_at`; (c) the newest `ScanRun` whose `coverage_summary["set_aside_ideas"]` lists the ticker gives kind `not_compelling`, reason `None`, as_of the scan's `created_at`. Return the candidate with the latest `as_of` (ties: a, then b, then c). With no candidate return `WithdrawalOut(kind="not_compelling", reason=None, as_of=None)`.

- [ ] **Step 1: Write the failing tests** in `test_discovery_withdrawal.py` (seed rows the way `tests/test_discover.py` does, with `seed` and the fixtures in `tests/discovery_fixtures.py`): `test_a_superseded_idea_with_a_newer_one_points_at_the_newest`, `test_the_successor_may_already_be_decided` (newest is `APPROVED`, still returned), `test_no_successor_and_a_later_invalidated_exclusion_gives_its_explanation` (assert `kind == "invalidated"`, `reason` equals the explanation, `as_of` equals the scan's `created_at`), `test_a_later_company_analysis_with_no_opportunity_gives_its_reason`, `test_a_later_set_aside_entry_gives_no_reason`, `test_nothing_saved_gives_a_generic_withdrawal_without_a_date`, `test_evidence_older_than_the_idea_is_ignored`, `test_the_latest_candidate_wins`, `test_other_kinds_get_neither_field` (PENDING, APPROVED, and a `manual` SUPERSEDED row), `test_another_users_scan_and_ideas_are_never_used`.
- [ ] **Step 2:** Run `uv run pytest tests/test_discovery_withdrawal.py -v` from `backend/`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the two functions and the schema fields as specified above; wire both into `get_recommendation` after `_attach_names`, before `db.close()`.
- [ ] **Step 4:** In `test_analysis_router.py` add `test_get_recommendation_returns_successor_id_for_a_superseded_discovery_idea` and `test_get_recommendation_returns_a_withdrawal_when_nothing_replaced_it` and `test_the_list_does_not_compute_successor_or_withdrawal`. Run both files with `uv run pytest tests/test_discovery_withdrawal.py tests/test_analysis_router.py -v`. Expected: PASS.
- [ ] **Step 5:** `uv run ruff check --fix app/discovery/withdrawal.py app/schemas.py app/routers/analysis.py tests/test_discovery_withdrawal.py tests/test_analysis_router.py`, then commit `feat: tell a superseded idea what replaced it or why it was withdrawn`.

### Task 2: Decision status on each Discover item (backend)

**Files:**
- Modify: `backend/app/routers/discover.py` (`DiscoverItemOut` line ~83, `_item_out` line ~134, `_analysis` line ~198), `backend/tests/test_discover.py`

**Interfaces:**
- Produces: `DiscoverItemOut.report_status: Literal["PENDING", "APPROVED", "REJECTED", "SUPERSEDED"] | None = None` (`None` when the item has no saved discovery idea). `_analysis` returns `dict[str, tuple[int, str | None, str]]` (id, headline, status); update every caller (grep `_analysis(` and `found`).
- The status is that of the newest saved discovery idea, the same row that already supplies `report_id`.

- [ ] **Step 1: Write the failing tests** in `test_discover.py`: `test_report_status_is_the_status_of_the_newest_saved_idea` (parametrize PENDING, APPROVED, REJECTED, SUPERSEDED), `test_report_status_ignores_an_older_idea_with_a_different_status`, `test_an_item_without_a_saved_idea_has_no_report_status`.
- [ ] **Step 2:** Run `uv run pytest tests/test_discover.py -v -k report_status`. Expected: FAIL.
- [ ] **Step 3:** Extend `_analysis` to also select `Recommendation.status`, thread it through `_item_out`, add the field. The idea-less `CompanyAnalysis` path in `_attach_state` leaves it `None`.
- [ ] **Step 4:** Run `uv run pytest tests/test_discover.py -v`. Expected: PASS (existing tests unchanged).
- [ ] **Step 5:** Ruff on the two files, commit `feat: show the decision status on each Discover item`.

### Task 3: Types and pure helpers (frontend)

**Files:**
- Modify: `frontend/lib/api/recommendation-types.ts`, `frontend/lib/api/discover-types.ts`, `frontend/lib/discoverList.ts` (+ `discoverList.test.ts`)
- Create: `frontend/lib/decisionView.ts`, `frontend/lib/decisionView.test.ts`

**Interfaces:**
- `RecommendationOut` gains `successor_id?: number | null` and `withdrawal?: Withdrawal | null`; export `interface Withdrawal { kind: "invalidated" | "not_compelling"; reason: string | null; as_of: string | null }`. `DiscoverItem` gains `report_status?: RecommendationStatus | null`.
- `decisionView.ts` exports `moveSinceRecommended(rec: Pick<RecommendationOut, "price_at_recommendation" | "current_price">): number | null` (percent, one decimal; `null` when either price is missing, not finite, or the earlier price is zero or negative) and `decisionStamp(rec: Pick<RecommendationOut, "reviewed_at">): string | null` (date text in the app's existing format, `null` when absent).
- `discoverList.ts` exports `type DecisionChip = "approved" | "dismissed" | "withdrawn"`, `decisionChip(item: DiscoverItem): DecisionChip | null` (`APPROVED`, `REJECTED`, `SUPERSEDED` map to the three; `PENDING`, `null`, absent give `null`) and `viewLabel(chip: DecisionChip | null): "View decision" | "View"` ("View decision" for approved and dismissed only).

Before writing `moveSinceRecommended`, grep how `price_at_recommendation` and `current_price` are already compared elsewhere (for example `PriceBlock` and the track record) and keep the same unit handling; if the two can differ by currency unit, return `null` in that case.

- [ ] **Step 1: Write the failing tests:** `decisionView.test.ts` (`computes the percent move to one decimal`, `is null when the price at recommendation is missing, zero or negative`, `is null when the current price is missing or not finite`, `never returns NaN or Infinity`, `decisionStamp is null without a review date`) and `discoverList.test.ts` additions (`maps each status to a chip`, `has no chip while pending or without a report`, `says View decision only for a decided idea`).
- [ ] **Step 2:** `npx vitest run lib/decisionView.test.ts lib/discoverList.test.ts` from `frontend/`. Expected: FAIL.
- [ ] **Step 3:** Implement the types and helpers.
- [ ] **Step 4:** Run the same command. Expected: PASS. Run `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat: types and helpers for decided and withdrawn ideas`.

### Task 4: Status strip (frontend)

**Files:**
- Create: `frontend/components/workbench/StatusStrip.tsx`, `frontend/components/workbench/StatusStrip.test.tsx`

**Interfaces:**
- Produces: `export type StripKind = "approved" | "dismissed" | "withdrawn" | "newer"` and `export function StatusStrip({ kind, rec }: { kind: StripKind; rec: DiscoveryRecommendation })`, `role="status"`.
- Copy and structure follow `reopen.html` (`strip()` and the `.sbn` styles): icon circle (check-circle, x-circle, slashed circle, refresh), a status chip (shape plus word) with the date, then:
  - approved: "You approved this idea. No order was placed; trade-agent never trades. If you acted on it in your broker app, log the trade you placed." Date from `decisionStamp(rec)`.
  - dismissed: "You dismissed this idea. The research below is what you decided on. Nothing else changed." plus "Your note: {rec.dismissal_reason}" only when there is one.
  - withdrawn: "The latest scan no longer found this compelling. The research below is the earlier analysis from {date of rec.created_at}; nothing replaced it." and, when `rec.withdrawal?.reason` exists, that reason in the dashed AI box labelled "From the latest scan · {date of withdrawal.as_of}" (label without the date when `as_of` is null). For `kind === "invalidated"` the first sentence is "This idea was withdrawn." instead.
  - newer: title "Newer analysis", "Updated {date of rec.created_at}", and "You opened an earlier analysis of this company. It was replaced, so this is the newer one, still waiting for your decision."
- Only the withdrawn reason is AI text, so only it gets the dashed box.

- [ ] **Step 1: Write the failing tests:** `renders the approved strip with the no-order sentence`, `renders the dismissed strip with and without a note`, `shows a long unbroken note wrapped, as text` (assert the style `overflow-wrap: anywhere`), `shows the withdrawn reason in the dashed box as text, not markup` (reason `<img src=x onerror=alert(1)>`: assert no `img` element and the literal text is present), `withdrawn without a reason has no dashed box`, `an invalidated withdrawal says it was withdrawn`, `the withdrawn strip never says replaced` (assert `queryByText(/replaced/i)` is null), `the newer strip says still waiting for your decision`, and `each strip pairs a word with a shape` (the chip text is present and an `svg` sits beside it).
- [ ] **Step 2:** `npx vitest run components/workbench/StatusStrip.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement with MUI `sx`, CSS variables (`--accent-wash`, `--track`, `--line2`, `--muted`), `lucide-react` icons, rem sizes.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat: a status strip for decided, withdrawn and newer ideas`.

### Task 5: Decided and withdrawn rails, and the page routing (frontend)

**Files:**
- Create: `frontend/components/workbench/DecidedRail.tsx`, `frontend/components/workbench/DecidedRail.test.tsx`
- Modify: `frontend/components/workbench/Workbench.tsx`, `frontend/components/workbench/DecisionRail.tsx` (`DecisionSummary`), `frontend/components/recommendations/ConfirmationPanel.tsx`, `frontend/app/(shell)/today/[id]/page.tsx`, `frontend/app/(shell)/today/[id]/page.test.tsx`, `frontend/components/workbench/Workbench.test.tsx`

**Interfaces:**
- `DecidedRail.tsx` exports `DecidedRail({ rec, onChanged }: { rec: DiscoveryRecommendation; onChanged: (u: RecommendationOut) => void })`, `WithdrawnRail({ rec }: { rec: DiscoveryRecommendation })`, `DecidedPhoneBar({ rec, onChanged })`, `WithdrawnPhoneBar({ rec })`, and `SinceRecommended({ rec })` (renders nothing when `moveSinceRecommended` is `null`; otherwise "Recommended {date}" then the price at recommendation and the move through the existing `Change` component, so green and red mark only that move).
- Decided rail, top to bottom: price block, `SinceRecommended`, confidence and risk meters, last analysis, portfolio fit, then actions. Approved: `LogTradeCta` (primary), "Change my decision" (opens `DismissSheet`, as `ConfirmationPanel` does), Ask AI (`askHref`). Dismissed: "Change my decision" (POST approve, as `ConfirmationPanel` does), Ask AI. Note line: "Recorded only. No order was placed." (approved) or "Recorded only. Nothing was sent to a broker." (dismissed).
- Withdrawn rail: price block, `SinceRecommended`, meters, last analysis, then Company overview (a link to `/discover/company/{ticker}`, primary), "Run a new analysis" (a disabled outlined `Button` with `aria-disabled`, no handler, no request) with the line "Re-running a researched company is not available yet." beneath it, and Ask AI. No decision controls. `WithdrawnPhoneBar` shows Company overview and Ask AI only (the disabled button lives in the summary area above the tabs on a phone, as a full-width disabled button with the same line).
- `Workbench` gains the optional prop `notice?: "newer"`. It derives the view from `recommendation.status`: `PENDING` keeps today's rail and, with `notice`, renders `StatusStrip kind="newer"`; `APPROVED` or `REJECTED` renders `StatusStrip` plus `DecidedRail` (phone: `DecisionSummary` with `showSince`, `DecidedPhoneBar`); `SUPERSEDED` with a `withdrawal` renders the withdrawn strip and rail. The strip sits between the identity header and the tabs. The page's `BackRow` reads "Back to Discover" (linking to `/discover`) for the decided and withdrawn views and for a redirect with `from=superseded`, because Today lists only pending ideas so those are reached from Discover; every other view keeps "Today". Tabs stay unchanged and read-only.
- `ConfirmationPanel` gains the optional prop `onViewCompany?: () => void`; when given it renders an outlined "View the company page" button between "Log the trade I placed" and "Back to Today".
- `page.tsx` routing, in order: invalid id or load error as today; `status === "SUPERSEDED"` with `successor_id` set: `router.replace(\`/today/${successor_id}?from=superseded\`)` from a named function called by an effect, render nothing meanwhile; `SUPERSEDED` with `idea` and `withdrawal`: `Workbench`; other `SUPERSEDED`: the existing "A newer analysis replaced this recommendation for {ticker}." alert (manual and scheduled runs always have a replacement); decided with `idea` and not decided in this visit: `Workbench`; decided otherwise: `ConfirmationPanel` as today; pending with `idea`: `Workbench`, passing `notice="newer"` when `useSearchParams().get("from") === "superseded"`. "Decided in this visit" is a `useState(false)` set to `true` by the `setDecided` callback; the confirmation's `onViewCompany` sets it back to `false`.

- [ ] **Step 1: Write the failing tests.** `DecidedRail.test.tsx`: `approved rail offers Log the trade I placed, Change my decision and Ask AI`, `dismissed rail offers Change my decision and Ask AI but no log button`, `Change my decision on an approved idea opens the dismiss sheet`, `Change my decision on a dismissed idea approves it`, `the since line shows the price at recommendation and the move`, `no since line when a price is missing`, `no control anywhere reads buy, sell, deposit or withdraw`, `withdrawn rail links to the company overview, shows Run a new analysis disabled with its explanation, makes no request when it is clicked, and has no decision buttons`. `page.test.tsx` (replace the discovery case of the existing "newer analysis replaced" test and keep a manual-run case that still shows the alert): `redirects a superseded idea to its successor with from=superseded`, `a successor that is already decided shows the decided strip and never says waiting`, `a superseded idea with a withdrawal shows the withdrawn view and never says replaced`, `a superseded idea with no idea payload keeps the old alert`, `a decided discovery idea opened later shows the strip and the research, not Decision recorded`, `deciding in this visit shows Decision recorded once, and View the company page then shows the decided view`, `a decided recommendation without an idea still shows the confirmation`, `from=superseded on a pending idea shows the newer strip`. `Workbench.test.tsx`: `the strip sits above the tabs and the four tabs still work read-only in a decided view`.
- [ ] **Step 2:** `npx vitest run components/workbench app/\(shell\)/today` from `frontend/`. Expected: FAIL.
- [ ] **Step 3:** Implement `DecidedRail.tsx`, then `Workbench`, `DecisionSummary` (`showSince` prop), `ConfirmationPanel` and `page.tsx` as specified. Reuse `useDecision`, `DismissSheet`, `useAction`, `LogTradeCta`, `PriceBlock`, `Meter`, `Panel` as `DecisionRail` and `ConfirmationPanel` already do.
- [ ] **Step 4:** Run the same command, then `npm run lint`, `npx tsc --noEmit`, `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: reopen a decided or withdrawn idea on its company page`.

### Task 6: Decision chip on the Discover card (frontend)

**Files:**
- Modify: `frontend/components/discover/DiscoverCard.tsx`, `frontend/components/discover/DiscoverCard.test.tsx`

**Interfaces:**
- Consumes `decisionChip` and `viewLabel` from Task 3. `StatusPill` gains an optional `decision?: DecisionChip | null` that overrides the analyzed pill: Approved (check-circle, accent wash), Dismissed (x-circle, outlined), Withdrawn (slashed circle, muted outline), each shape plus word.
- The first button reads `viewLabel(chip)` (its `aria-label` becomes "View the decision for {name}" when "View decision"). For a withdrawn item the one-line reading is replaced by "The latest scan no longer found this compelling." Edit, Remove and the company-name link are unchanged.

- [ ] **Step 1: Write the failing tests:** `shows Approved, Dismissed and Withdrawn chips with a shape and a word`, `the first button says View decision for approved and dismissed`, `a withdrawn card replaces the old reading with the scan sentence`, `a pending card keeps AI analyzed and View`, `a card without report_status behaves as before`.
- [ ] **Step 2:** `npx vitest run components/discover/DiscoverCard.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test, then `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: show the decision on each Discover card`.

### Task 7: Docs and a real browser pass

**Files:**
- Modify: `docs/ARCHITECTURE.md` (the recommendation and Discover API rows: the two new fields and `report_status`, and one short paragraph on the reopen behavior), `DESIGN.md` (the strip, the decided and withdrawn rails, the Discover chips), `docs/design/README.md` (status "Built"), `docs/design/reopen-saved-company/SPEC.md` and `direction-approved.md` (record the withdrawn-rail ruling: no "Run a new analysis")
- Add to the commit: the whole `docs/design/reopen-saved-company/` folder.

- [ ] **Step 1:** Update the docs above.
- [ ] **Step 2:** Start backend and frontend locally, sign in, and walk through: an approved idea, a dismissed idea with a note, a superseded idea with a newer pending one (redirect and strip), a withdrawn idea, deciding a pending idea (confirmation once, then "View the company page"), the Discover chips, and a phone-width pass of each. Report anything that differs from `reopen.html`.
- [ ] **Step 3:** Run `/code-review` on the branch diff, address findings, rerun the affected checks, then commit `docs: record the reopen flow and its design`.
