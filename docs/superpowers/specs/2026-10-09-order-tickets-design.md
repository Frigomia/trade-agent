# Order tickets — design

## Goal

A saved contribution plan (see the contribution planner spec) tells the person how much to add to each
ticker. Order tickets turn each saved plan line into text the person copies into their broker (Trade
Republic, Scalable Capital) and places themselves, then lets them record that it was placed. Recording an
order updates the portfolio through the same trade-logging code the app already has, so next month's
weights and plan start from the right numbers.

The system never places a trade and never calls a broker. A ticket is text on a screen. "Placed" records
what the person did; it does not do anything at a broker.

## Decisions (agreed in brainstorming)

| Question | Decision |
| --- | --- |
| After placing the order | "Placed" opens the trade sheet and logs the trade, so the holding, cost basis and trade log update (not only a status mark). |
| How the instrument is identified | An optional ISIN per ticker, entered once by the person. The ticket falls back to ticker and name when none is saved. No automatic ISIN lookup (the price source is unreliable for it, and a wrong ISIN on an order is worse than none). |
| Ticket format | One neutral format for every broker, with a Copy button per line and Copy all lines. No broker setting. |
| A line that starts a new position | "Placed" creates the holding and logs the buy in one step (no detour through Add holding). |
| Where tickets live | Only on saved plans. After Save plan the same screen shows the saved plan with its tickets. A preview has no tickets. |
| Later, not now | An "Orders" tab listing open lines across all saved plans (see Future work). |

Out of scope: a broker preference or broker-specific wording, automatic ISIN lookup, undoing a placed line,
sell tickets (a plan only adds money), several placements per line, any broker integration.

## What exists today

- Saved plans: `contribution_plans` and `contribution_plan_lines` (owner-only RLS, no foreign key between
  them), `GET /plans/{id}`, rate-limited preview and save, a 120-plan cap. A line carries ticker, name,
  EUR amount, shares, EUR price, currency, rate, weights and a reason.
- Trade log: `POST /portfolio/trades` takes `{date, ticker, action, shares, price}`. It requires an existing
  holding (404 otherwise), recomputes shares and average cost on a BUY, refuses to sell more than held, and
  writes a `trades` row. The price is a plain number in the currency the person uses for that holding; the
  portfolio does not convert currencies.
- Holdings are created with `POST /portfolio/holdings` (a full-replace upsert, capped at 100, under a
  per-person insert lock `lock_user_for_insert`). Watchlist rows carry `asset_type` and no name.
- The frontend has `TradeSheet` (a drawer) and the saved-plan view under Portfolio, Saved plans.

## The currency constraint

A plan line's price is in EUR, converted at plan time. A holding's cost basis is in whatever the person
enters (for example USD for a USD-priced fund). Writing the plan's EUR price into the trade log would corrupt
the average cost. So the "Placed" sheet never copies the plan price: the person types the real fill price in
the holding's own currency. Only the planned shares are prefilled.

## The ticket

For each line, built in the frontend from the line data:

`Order (amount): 92.30 EUR · iShares Core MSCI EM IMI UCITS ETF USD (Acc) · ISIN IE00BKM4GZ66 · about 1.69 shares at 54.64 EUR`

- Without an ISIN the ISIN part is left out and an "Add ISIN" link shows beside the ticket.
- "about N shares at X EUR" is the plan-time price, not a promise; whole-shares plans say "N shares".
- The words on screen are "Order" and "Placed", never Buy or Sell, and the "Advisory only. Nothing is sent
  to a broker." line stays.
- Copy copies one ticket; Copy all lines copies every line not yet placed, one per line.

## Data changes

One hand-written migration (a new file; existing migrations are never edited):

- `holdings.isin` and `watchlist_items.isin`: nullable `varchar(12)` with a check that it is empty or
  matches `^[A-Z]{2}[A-Z0-9]{9}[0-9]$`. The API also verifies the ISO 6166 check digit.
- `contribution_plan_lines.placed_at` (nullable timestamp) and `placed_trade_id` (nullable integer, no
  foreign key, like every other user table).
- The ISIN is not copied onto the plan line: `GET /plans/{id}` reads the current ISIN from the person's
  holding or watchlist row for that ticker, so an ISIN added after saving still appears on older plans.
- The data export includes the new fields. Data deletion already covers the tables.

## API

All routes require an active user and run through `get_user_db`.

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/plans/{id}` | Lines gain `id`, `isin`, `placed_at`, `placed_trade_id`. |
| PUT | `/portfolio/instruments/{ticker}/isin` | Body `{isin: string \| null}`. Sets or clears the ISIN on whichever of the person's holding and watchlist rows exist for the ticker; 404 when neither exists; 422 for a bad ISIN or check digit. A small dedicated route, because the holdings upsert replaces the whole record. |
| POST | `/plans/{plan_id}/lines/{line_id}/placed` | Body `{date, shares, price, asset_type?}` (`asset_type` is required only when the ticker is not a holding yet; see Rulings). In one transaction: finds the line (404 for another person's or a missing line, 409 when already placed); creates the holding when none exists (name from the line, `asset_type` from the body, the 100-holding cap and the insert lock as in the holdings route); applies a BUY through the same code as `POST /portfolio/trades`; stamps `placed_at` and `placed_trade_id`; returns the line. Rate limited like the other writes. |

Shares and price are validated like `TradeIn` (positive, finite). The trade-logging logic (update shares and
average cost, write the `trades` row) is extracted from the route into one shared function, so the existing
route and the new one use the same code and the cost basis is computed in one place.

There is no undo: the trade log has no delete, so unmarking a line would leave its trade behind. A mistaken
"Placed" is fixed with a SELL in the trade log, as today.

## The screens

Designed with the huashu-design and impeccable skills before any frontend code (three directions, the user
picks one), as for the earlier features.

- **Saved plan view** (Portfolio, This month right after Save plan, and Saved plans when a plan is opened):
  each line shows its ticket text, Copy, "Add ISIN" when empty, and a "Placed" button. A placed line shows a
  status chip, for example "Placed 8 Oct · 1.69 sh at 54.60", instead of the button. Copy all lines sits
  above the lines.
- **Record placed order sheet:** opened by "Placed". Ticker fixed, shares prefilled from the plan, the price
  empty with the hint "Price in the currency of this holding", the date today. For a new position it also
  asks for the asset type, prefilled from the watchlist item when there is one.
- **Add ISIN:** a small inline field on the ticket that saves through the ISIN route.
- Phone: tickets wrap, controls stay full width, and no horizontal scroll at 390px.

## Security and privacy review points

Every route works only on the person's own rows (scoped session plus `user_id` filters); a line or plan of
someone else is a 404 and cannot be placed. The ISIN is validated server side (pattern and check digit) and
rendered as plain text. The placed route is idempotent against double clicks (409 on an already placed line,
under the per-person lock). The shared trade code keeps the existing refusal to sell more than held. Plan
data and tickets are never sent to Telegram or logged. No code path contacts a broker. The security reviewer
runs on the full diff before the pull request.

## Testing

- ISIN: valid and invalid patterns, wrong check digit, lowercase, empty clears, the route updating a holding
  only, a watchlist item only, and both; 404 for an unknown ticker; another person's data untouched.
- Placed: an existing holding (shares and average cost match what `POST /portfolio/trades` gives for the same
  input), a new position (holding created with the line's name and the given asset type, cap respected),
  already placed (409), another person's line (404), invalid shares or price (422), two parallel requests
  (one wins), the line stamped with the trade id.
- The refactor: the existing trade route behaves exactly as before (its tests unchanged and green).
- `GET /plans/{id}` returns the live ISIN and the placed fields; the export includes them; data deletion
  covers them.
- Frontend: the ticket text with and without an ISIN, Copy and Copy all (placed lines omitted), the sheet
  (shares prefilled, price empty, new-position asset type), the status chip after placing, error display
  (409, 422, 429), Add ISIN save and clear, no Buy or Sell wording.

## Rulings

Settled during implementation; they refine the text above.

1. The placed body's `asset_type` is optional: it is required (422) only when the holding does not exist
   yet. The UI sends it only for a new position.
2. `GET /plans/{id}` and the export resolve each line's ISIN at read time from the holding (which wins) or
   the watchlist item for the same ticker; nothing is copied onto the line.
3. The trade logic lives in `app/trades.py` as `apply_trade(db, user_id, holding, payload) -> Trade`,
   raising the domain exception `TradeRefused`; it does not commit. `POST /portfolio/trades` converts
   `TradeRefused` to the same 422 messages as before.
4. Trades and placements both take the per-person lock (`lock_user_for_insert`), so they serialize.

## Documentation

ARCHITECTURE (data model, the two new routes and the changed plan response, the shared trade function, the
ticket and the currency rule), RUNBOOK (nothing to configure; what "Placed" does and does not do), PRODUCT
(order tickets built; the Orders tab is future work).

## Future work

- **Orders tab:** a tab next to This month and Saved plans listing open (not yet placed) lines across all
  saved plans, so unfinished lines from earlier months stay visible. The data model already supports it (a
  query over lines with no `placed_at`).
- A broker preference with broker-specific wording, if the neutral text proves confusing in one app.
- Undo for a placed line, if the trade log ever gets a delete.

## Open points to confirm during implementation

- The exact check-digit routine for ISINs (ISO 6166, Luhn over the letters expanded to digits) and a few real
  ISINs for the tests.
- Whether asset type should default to ETF when there is no watchlist item (the form still lets the person
  choose).
- The wording of the ticket and the sheet, checked on a phone.
