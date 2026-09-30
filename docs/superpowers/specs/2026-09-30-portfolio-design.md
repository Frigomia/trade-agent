# Portfolio — design

Status: approved in the brainstorming session on 2026-09-30. Sub-project 6 of the frontend roadmap
(`docs/superpowers/specs/2026-09-28-frontend-design-direction-design.md`). Sub-projects 2 (auth and
multi-user backend), 3 (frontend foundation), 4 (login and admin screens) and 5 (recommendations
workflow) are merged.

## Purpose

The Portfolio screens: holdings with live value and per-holding P/L, a watchlist, a value-over-time
chart from snapshots, and the Log a trade flow. Visual design and copy are already approved in the
design-direction spec ("Portfolio", "Log a trade") and the mockups
(`docs/design/mockups/direction-A-dark-and-light.html` mobile portfolio,
`docs/design/mockups/user-sections.html` `#desktop` block: portfolio table and Log a trade sheet).

This cycle also picks up the two pieces sub-project 5 explicitly deferred here: the Portfolio value
tile with sparkline on Today's header, and the "Log the trade I placed" button on the approval
confirmation.

**Hard constraint (root CLAUDE.md): this system never places a trade.** Log a trade only records a
trade the user already made elsewhere, in past tense ("Bought" / "Sold"), and says so.

## Decisions made this cycle

Checking the approved design against the backend contract surfaced these forks, each resolved
explicitly:

1. **Live prices and P/L** — the backend returns stored rows only; nothing computes market value,
   P/L or totals. **Decision: a new backend `GET /portfolio/summary`** (not frontend math), reusing
   the existing 5-minute Redis-cached `fetch_quote_and_history`, so Portfolio and Today share one
   computation.
2. **How positions get in** — `POST /portfolio/trades` returns 404 unless the holding already
   exists, and no screen creates holdings. **Decision: an Add-holding form plus Log a trade.** The
   form covers importing existing positions and opening new ones; Log a trade handles later buys
   and sells. No backend change for this.
3. **Snapshots chart** — snapshots exist only when someone posts one; there is no scheduler.
   **Decision: the manual "Record snapshot" button (per the spec) plus an automatic once-a-day
   snapshot triggered by the frontend when Today or Portfolio is opened.** A write triggered by
   viewing a page is a deliberate choice; it is guarded (below) and best effort.
4. **Deferred items** — **Decision: do both here** (Today tile, approval-screen button).

## Backend

`GET /portfolio/summary` (new, `async def`, user-scoped through `get_user_db` like every route in
this router). No new tables, no migration.

Response:
- `holdings`: for each holding, the stored `ticker`, `name`, `asset_type`, `shares`, `cost_basis`
  (average cost per share), plus computed `current_price`, `market_value`, `unrealized_pl`,
  `unrealized_pl_pct`, `weight` (its share of the priced total). All computed fields are `null` when
  that holding's quote fails.
- `watchlist`: each item (`ticker`, `asset_type`, `note`) with computed `current_price`.
- Totals: `total_market_value`, `total_cost_basis`, `total_pl`, `total_pl_pct`, `unpriced_count`.

Rules:
- A holding whose quote fails is left out of the market-value total. `unpriced_count` says so and
  the UI shows a quiet note, rather than silently under-reporting. Its cost basis is likewise left
  out of the cost-basis total, so P/L compares like with like.
- Quotes come from `fetch_quote_and_history` (already cached 5 minutes and retry-wrapped), tickers
  deduped and fetched concurrently. A non-finite price (NaN/inf) is treated as a failed quote — a
  NaN reaching the response would 500 it (Starlette serializes with `allow_nan=False`).
- The DB session is closed after the rows are copied out and before awaiting quotes, so a slow
  market-data outage cannot hold a pooled connection.
- Quote failures are logged with the exception class name only, never the exception text
  (backend/CLAUDE.md, non-negotiable).
- No currency conversion: mixed currencies are added as entered, and the UI says so.
- Holdings with zero shares (a fully sold position stays as a row) are included in the response with
  `shares == 0` and excluded from totals and weights.

Existing endpoints used unchanged: `POST /portfolio/holdings` (upsert, used for add and edit),
`DELETE /portfolio/holdings/{ticker}`, `POST /portfolio/trades`, `POST /portfolio/watchlist`,
`POST /portfolio/snapshot`, `GET /portfolio/snapshots`. `POST /portfolio/snapshot` still returns a
500 with "No current price available for X" if any holding is unpriced; the manual button shows
that message, and the automatic snapshot never fires in that state.

`docs/ARCHITECTURE.md` gets the new endpoint row and the response shape.

## Frontend

`frontend/app/(shell)/portfolio/page.tsx` replaces the placeholder. Client component, two SWR reads:
`/portfolio/summary` and `/portfolio/snapshots`.

Layout (one responsive page, as in the mockups):
- Header: "Portfolio", **Record snapshot** and **Log a trade** buttons.
- Stats: portfolio value large with dimmed decimals (e.g. `10,204.10`), cost basis, total P/L
  (amount and %). A quiet line: "Mixed currencies are not converted; totals add amounts as
  entered", and when `unpriced_count > 0`: "N holding(s) have no live price and aren't in these
  totals". No currency symbol.
- Chart: value over time with range chips 1W / 1M / 3M / 1Y / All, filtering snapshots client-side.
- Holdings: table on desktop, stacked rows on phone — shares, average cost, price, value, P/L.
  Clicking a row opens edit. Zero-share holdings are hidden from the table and totals.
- Watchlist panel: ticker, price, and an inline add row (ticker plus type).

Components, in `frontend/components/portfolio/`:
- `PortfolioChart.tsx` — hand-rolled inline SVG area chart from `(created_at,
  total_market_value)` points, no chart dependency. Snapshots are collapsed to the last point per
  UTC day. A `sparkline` variant (no axes, no chips) serves Today's tile. Fewer than 2 points shows
  "Record a snapshot to start your history"; no fake line.
- `TradeSheet.tsx` — Log a trade: a bottom sheet on phone, a right drawer on desktop (MUI `Drawer`,
  anchor chosen by breakpoint). Fields: Ticker (a select of your holdings, including closed ones so
  you can buy back in), Bought/Sold toggle, Shares, Price, Date (default today). States "This only
  records it here. Nothing is sent to a broker." The backend's own 422 ("Cannot sell 5; holding has
  3") shows inline.
- `HoldingForm.tsx` — Add / Edit holding drawer: ticker, name, ETF or Stock, shares, average cost,
  first purchase date. Sector and target weight (optional in the API) are left out. Because
  `POST /portfolio/holdings` upserts, adding a ticker you already hold would overwrite its shares
  and average cost, so the form warns inline: "You already hold X. This replaces its shares and
  average cost; use Log a trade to add to a position." Edit mode has Remove holding with an inline
  confirm.
- `LogTradeCta.tsx` — the approval-screen button (below).
- `frontend/lib/format.ts` — `formatAmount` (thousands separators, dimmed decimals) and `formatPct`,
  shared by Portfolio and Today.
- `frontend/lib/portfolio/useDailySnapshot.ts` — the automatic snapshot hook (below).
- `frontend/lib/api/portfolio-types.ts` — types for the summary, holdings, trades and snapshots.

No per-holding sparklines: the mockup shows them, but they need per-holding price history the
backend does not expose.

## Data flow

- Reads: Portfolio and Today's tile both read `/portfolio/summary` and `/portfolio/snapshots`
  through SWR and share the cache.
- Writes: add, edit or remove a holding, Log a trade, and Add to watchlist each re-fetch the summary
  on success. Record snapshot posts, then re-fetches snapshots. Every write's error comes from
  `ApiError.detail`, shown inline.
- **Automatic daily snapshot** — `useDailySnapshot`, used by both Today and Portfolio. It posts a
  snapshot only when all hold: the summary and snapshots have loaded; there is at least one
  holding with shares; `unpriced_count === 0` (never record a partial total); and the latest
  snapshot's UTC date is not today. A module-level once-per-day guard stops repeated attempts when
  moving between Today and Portfolio. Failure is silent (the manual button is where errors show).
  Two tabs racing could record two same-day snapshots; that is harmless because the chart keeps the
  last point per UTC day.
- The form and trade submit buttons are disabled while a request is in flight, so a double click
  sends one request.

## Today's tile and the approval button

- **Today tile:** Today's header gains a Portfolio tile beside "Awaiting you": the value, a P/L
  pill, and the sparkline variant of the chart. With no holdings it reads "Add your holdings in
  Portfolio" and links there. When `unpriced_count > 0` it adds a small "N not priced".
- **"Log the trade I placed"** — `LogTradeCta`, rendered by `ConfirmationPanel` after an approval
  (the detail page only; the list never shows a confirmation):
  - BUY or ADD opens Log a trade with Bought prefilled; TRIM or SELL with Sold prefilled.
  - HOLD or WATCH shows no button (nothing to record).
  - A ticker the user does not hold yet (for example a new BUY) opens the Add-holding form with the
    ticker prefilled, because Log a trade cannot open a position.
  - "Back to Today" and "Change my decision" are unchanged. After a successful log the panel shows
    "Trade logged" inline.

## Empty and error states

- No holdings: "Your portfolio is empty" with an Add holding button; stats, chart and Log a trade
  are hidden or disabled.
- Summary or snapshots fail to load: an inline "Could not load your portfolio" `Alert` for that
  part; the other part still renders.
- A holding whose quote failed: shares and average cost shown, an em dash for price, value and P/L;
  counted in `unpriced_count` and left out of totals.
- Forms validate before sending (ticker required; shares and price positive).

## Testing

- Backend: `GET /portfolio/summary` — values, weights and P/L correct; a failed quote and a NaN
  quote each give null fields and an incremented `unpriced_count` (never a 500); ticker dedupe;
  zero holdings gives empty totals; zero-share holdings excluded from totals; user-scoped (another
  user's holdings never appear); unauthenticated is 401. Every test mocks `fetch_quote_and_history`
  (never a real network call).
- Frontend: Portfolio page (stats and holdings, empty state, load errors, Record snapshot success and
  inline error); `TradeSheet` (Bought/Sold payload, the 422 inline, double-click guard);
  `HoldingForm` (the replace warning, Remove with confirm); `PortfolioChart` (empty state, range
  filtering, one point per day); `useDailySnapshot` (posts once when stale; not when fresh, when a
  holding is unpriced, or with no holdings); `LogTradeCta` (each action's prefill, no button for
  HOLD or WATCH, unheld ticker opens the Add-holding form); Today tile (renders, empty state).

## Out of scope (this cycle)

Per-holding sparklines; removing watchlist items (needs a new `DELETE` endpoint); currency
conversion; sector and target-weight editing; a chart that extends to the live value between
snapshots.
