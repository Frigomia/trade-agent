# Recommendations workflow — design

Status: approved in the brainstorming session on 2026-09-29. Sub-project 5 of the frontend
roadmap (`docs/superpowers/specs/2026-09-28-frontend-design-direction-design.md`). Sub-project 2
(auth/multi-user backend, PRs #21-#23), sub-project 3 (frontend foundation, PR #24), and
sub-project 4 (login and admin screens, PR #27) are merged.

## Purpose

The product-defining screen: the human-in-the-loop approval gate the whole system exists for.
A "Today" list of pending recommendations, a detail view per recommendation, and an
approve/dismiss flow with confirmation — built against the visual design and copy already
approved in `docs/superpowers/specs/2026-09-28-frontend-design-direction-design.md`'s "Today /
recommendation review", "Recommendation detail", and "After Approve" sections, and the mockups
at `docs/design/mockups/direction-A-dark-and-light.html` (Today list) and
`docs/design/mockups/user-sections.html` (`#reco` block: detail, confirmation).

## Scope decisions made this cycle

Checking the approved mockups against the actual backend contract (`RecommendationOut` only
exposes `reasoning: list[str]` and `ai_analysis: str | None` — no structured score/signal fields,
no live price, and "similar past calls" requires a live external embedding search) surfaced five
real forks, each resolved explicitly rather than assumed:

1. **Structured evidence fields** — `fundamental_score` and `technical_signal` are already
   computed in the analysis pipeline (`app/agents/graph.py`'s state) but never persisted or
   exposed. **Decision: add them** (two nullable columns + schema fields) so the frontend can
   render the mockup's distinct fundamentals-score-bar / technical-signal-pill treatment
   structurally, instead of parsing backend-internal wording out of `reasoning` strings.
2. **Price on cards** — the backend stores `price_at_recommendation` but not a live quote.
   **Decision: fetch a live quote + day-change per card/detail**, server-side, reusing the
   existing Redis-cached `fetch_quote_and_history` (5 min TTL, already retry-wrapped). Gated to
   `status == "PENDING"` queries only, so a future historical/bulk query doesn't trigger needless
   live fetches.
3. **Similar past calls** (`/memory/similar`, a live Voyage embedding call with its own
   503-if-unconfigured failure mode) — **decision: omit for this cycle.** It fits naturally
   alongside Track record (roadmap item 8, also memory/history-based) rather than adding a live
   external call to every detail-view open now.
4. **"Log the trade I placed" CTA** on the confirmation screen leads into Portfolio
   (holdings, cost basis), which doesn't exist yet (sub-project 6). **Decision: skip the CTA this
   cycle.** Confirmation keeps "Decision recorded", the broker reminder, "Back to Today", and
   "Change my decision" — no dead-end button, no pulling sub-project 6 scope forward.
5. **Portfolio value tile + sparkline** on Today's header is Portfolio's own domain (holdings +
   live quotes, or snapshot history). **Decision: omit for this cycle.** Today's header shows
   only the "Awaiting you: N" tile; the value tile arrives once sub-project 6 builds real
   portfolio-value computation.

Also confirmed while checking the backend: `POST /analysis/recommendations/{id}/approve|reject`
have no status guard (`_set_recommendation_status` unconditionally overwrites), so "Change my
decision" (call the opposite endpoint on an already-decided recommendation) needs **no** backend
change — this was verified, not assumed.

## Screens & routes

- **`frontend/app/(shell)/today/page.tsx`** — the Today list. Client component,
  `useSWR("/analysis/recommendations?status=PENDING", apiFetch)`. Header: "Today" + last-run
  hint, "Run analysis" button, "Awaiting you: N" tile (no portfolio-value tile). Below it, one
  `RecommendationCard` per pending recommendation.
- **`frontend/app/(shell)/today/[id]/page.tsx`** — recommendation detail, deep-linkable.
  `useSWR(`/analysis/recommendations/${id}`, apiFetch)`.
- **Confirmation is in-page state on the detail page only, not a route.** The mockups only ever
  show the full "Decision recorded" screen following the detail page's Approve — never an inline
  version on the list. A list-card decision just removes that card from Today (the list
  revalidates); showing "Back to Today" there would be nonsensical navigation copy on the screen
  you're already standing on. After a successful Approve/Dismiss on the detail page, its content
  swaps to `ConfirmationPanel` in place — no route, no throwaway page for a transient state.
- No filter chips, no historical (approved/rejected) view on Today — pending-only per the
  approved spec; history is Track record's job (roadmap item 8).

## Data flow

- **List:** `useSWR("/analysis/recommendations?status=PENDING", apiFetch)`, default SWR caching.
- **Detail:** `GET /analysis/recommendations/{id}` (new endpoint, see Backend additions) — needed
  for a direct link/refresh to work, not just client-side navigation from an already-loaded list.
- **Run analysis:** click → `POST /analysis/run` → store the returned `job_id` in local state →
  `useSWR(`/analysis/run/${jobId}`, apiFetch, { refreshInterval: (data) => data?.status ===
  "RUNNING" ? 2000 : 0 })` polls every 2s while running, stops itself on `DONE`/`FAILED`. On
  `DONE`: `mutate("/analysis/recommendations?status=PENDING")`; if any per-ticker
  `results[].error` entries exist, show a small inline note ("3 analyzed, 1 failed"). On
  `FAILED`: inline error banner. The button is disabled with a spinner for the whole RUNNING
  window.
- **Approve/Dismiss from a list card:** `POST /analysis/recommendations/{id}/approve` or
  `/reject`. On success: `mutate` the list — the card disappears because it's no longer `PENDING`.
  On failure: inline `ApiError.detail`, submitting state re-enables the buttons.
- **Approve/Dismiss from the detail page:** same endpoints; on success, swap the page's content to
  `ConfirmationPanel` in place (no navigation) rather than removing anything.
- **"Change my decision":** calls the opposite endpoint, then returns to the normal
  approve/dismiss view.
- **Rate limit / monthly cap on Run analysis:** `POST /analysis/run` can 429 immediately (5/min
  limiter, or the monthly-cap check). `ApiError.detail` already carries the backend's existing
  friendly message ("Monthly limit reached... Resets next month, or ask your admin to raise
  it.") — shown inline, same pattern as every other error surface in this app.

## Backend additions (small, scoped to this cycle)

- **Migration:** two new nullable columns on `recommendations` — `fundamental_score` (Integer),
  `technical_signal` (String). Both values already exist in `app/agents/graph.py`'s
  `AnalysisState`; `app/agents/jobs.py`'s `_process_ticker` just needs to pass them into the
  `Recommendation(...)` constructor, same pattern already used for `price_at_recommendation`.
- **`RecommendationOut` schema** gains: `fundamental_score: int | None`,
  `technical_signal: str | None`, `price_at_recommendation: float | None` (already stored, not
  previously exposed), plus two **computed, never-persisted** fields —
  `current_price: float | None`, `price_change_pct: float | None`.
- **`GET /analysis/recommendations/{id}`** (new) — user-scoped, 404 if missing or not owned.
- **Live quote augmentation** — both the list endpoint (only when `status == "PENDING"`) and the
  new by-id endpoint compute `current_price`/`price_change_pct` server-side, reusing
  `app.agents.market_data.fetch_quote_and_history` (already Redis-cached 5 min, already
  retry-wrapped). Unique tickers deduped and fetched concurrently via `asyncio.gather`.
  `price_change_pct` is the day change (`closes[-1]` vs `closes[-2]`); both fields are `None` if
  there are fewer than 2 closes or the fetch fails — degrades gracefully, never 500s the endpoint
  over a flaky quote.
- **`list_recommendations` becomes `async def`** to `await` the quote fetch — consistent with
  this router's existing async endpoints (`run_analysis`, `get_run_status`), not a new pattern;
  the blocking yfinance call is already isolated in a thread via `asyncio.to_thread` inside
  `fetch_quote_and_history`, so this doesn't stall the event loop the way the sync-routes
  convention (`backend/CLAUDE.md`) exists to prevent.

## Components

In `frontend/components/recommendations/`:

- **`EvidencePanel.tsx`** — fundamentals score bar + technical-signal pill + suggested-size row.
  Shared between the compact card and the full detail view (no duplicated bar/pill rendering).
- **`RecommendationCard.tsx`** — Today's list item: ticker, action badge (color-coded per
  action, mirroring the existing admin status-chip pattern), price + day-change pill (omitted
  entirely, not shown as an error, when `current_price` is null), `EvidencePanel`, one compact
  reasoning line (`ai_analysis`'s first sentence, falling back to the technical-signal reasoning
  entry when `ai_analysis` is null — e.g. HOLD actions), inline Approve/Dismiss.
- **`WebOpinionBox.tsx`** — the dashed "not part of the score" box — detail-only, never on the
  card, per the approved spec.
- **`ConfirmationPanel.tsx`** — the detail page's "Decision recorded" view (see Screens & routes —
  the list never shows this). No "Log the trade" CTA. "Back to Today" and "Change my decision".
- The detail page itself composes `EvidencePanel`, the full `reasoning` list, `WebOpinionBox`,
  and Approve/Dismiss directly — no separate `RecommendationDetail` wrapper. It has exactly one
  consumer (the page), matching how `admin/page.tsx` already keeps its own single-consumer content
  inline rather than extracting it.

## Error and empty states

- **No pending recommendations:** calm empty state on Today — "No recommendations right now." +
  the Run analysis button front and center.
- **List/detail load failure:** inline `Alert`, same `loadError` pattern as the admin screens.
- **Detail already decided** (stale link, or acted on in another tab — the by-id endpoint
  doesn't filter by status): if the fetched recommendation's status isn't `PENDING`, render
  `ConfirmationPanel` immediately instead of an approve/dismiss form that would silently fail.
- **Approve/Dismiss/Run-analysis failure:** inline `ApiError.detail`, submitting state re-enables
  the buttons — same shape as every other action handler already in this codebase.

## Testing

- **Backend:** unit test for the quote-augmentation logic (mock `fetch_quote_and_history`,
  assert dedup across repeated tickers, assert `current_price`/`price_change_pct` are `None` on
  a fetch failure rather than a 500, assert augmentation is skipped for non-`PENDING` queries);
  endpoint tests for `GET /analysis/recommendations/{id}` (found/not-found/not-owned); a test
  that `fundamental_score`/`technical_signal` round-trip through `jobs.py`'s row construction.
- **Frontend:** `RecommendationCard` (renders evidence, missing-quote degrades quietly,
  Approve/Dismiss call the right endpoint and swap to `ConfirmationPanel`, action-error shows
  inline); `RecommendationDetail` (already-decided status renders `ConfirmationPanel` instead of
  the form); Today page (empty state, load-error banner, Run-analysis polling — mocked SWR/timers
  advancing RUNNING→DONE, 429/monthly-cap detail shown inline); `ConfirmationPanel`'s "Change my
  decision" round-trip.

## Out of scope (explicitly, this cycle)

- Similar past calls / memory similarity search on the detail screen (deferred alongside Track
  record, roadmap item 8).
- "Log the trade I placed" CTA and any trade-logging UI (sub-project 6, Portfolio).
- Portfolio value tile + sparkline on Today's header (sub-project 6, Portfolio).
- Any filter/history view on Today (Track record, roadmap item 8).
