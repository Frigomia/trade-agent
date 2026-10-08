# Monthly contribution planner — design

## Goal

Someone who adds money to their portfolio every month types the amount (or uses their saved one) and
gets a plan: how much to put into each holding or watchlist ticker so the portfolio moves toward the
weights they want. The plan is advice on a screen. Nothing here changes what the system does: it still
never places a trade, never calls a broker, and a plan line is an instruction to a person, not an order.
A later feature, order tickets, turns saved plan lines into copy-ready text; it is a separate spec.

## Decisions (agreed in brainstorming)

| Question | Decision |
| --- | --- |
| What decides the split | The person's target weights, minus what the analysis says to avoid. A ticker whose newest pending call is TRIM or SELL gets no money; one whose newest pending call is ADD or BUY has its gap counted 25 % larger. |
| Who computes it | Plain arithmetic in the backend. No Claude call, no Claude cost, no key needed. |
| Currency | Converted at plan time, nothing stored: the plan fetches each ticker's trading currency and a current exchange rate and converts everything to the base currency (EUR) for that calculation only. A ticker whose currency or rate cannot be found is left out of the plan with a visible note, never guessed. |
| How a line reads | A euro amount with the approximate share count at the current price ("150 EUR, about 0.83 shares"). A "Whole shares only" switch on the plan rounds each line down to whole shares and shows the leftover. |
| Extras in version one | A saved monthly amount; saved plan history; a drift card on Today; a monthly Telegram reminder. |
| The reminder | Sent at the start of each month, which is the first weekday of the month (UTC), because the notify step only runs on weekdays. The person does not choose a day. It is one line in that day's single Telegram message ("Plan this month's contribution: <app address>/portfolio/plan"), with no amounts and no tickers, and has its own on/off switch next to the existing two. |

Out of scope: order tickets and marking lines as bought (the order-ticket spec), selling or trimming to
rebalance (the plan only decides where new money goes), tax, fees and spreads, dividends, cash tracking,
a base currency other than EUR, per-line manual edits of a plan, and any broker integration.

## What exists today

- `holdings.target_weight` (nullable, 0 to 1) is stored and editable in the holding form, and nothing uses
  it yet. `watchlist_items` has no target. `GET /portfolio/summary` computes live prices, market values and
  current weights per holding with no currency conversion (`app/routers/portfolio.py`).
- `app/agents/market_data.fetch_quote_and_history(ticker)` returns the price and daily closes (cached in
  Redis for 5 minutes). The ticker pattern is validated, so an exchange-rate symbol such as `EURUSD=X` needs
  its own validation path.
- Recommendations carry `ticker`, `action` (BUY, ADD, HOLD, TRIM, SELL, WATCH), `status` and `created_at`.
- Preferences live in `investment_preferences` (one row per user, read and written by `/preferences`,
  which now only updates the fields sent). Telegram settings live in `telegram_links`; the weekday `notify`
  step builds one message per person with a per-day marker.
- Every user table has a `user_id`, forced owner-only row-level security, and an entry in `app/rls.py`
  `USER_TABLES`; deleting data and the data export cover every such table.
- `docs/ARCHITECTURE.md` used to mention a `rebalance.py` that was never built; that remark has been removed.

## The calculation

Inputs: the contribution `A` in EUR; the person's holdings (open positions, shares > 0) and watchlist items
with their live prices and converted EUR values; each item's target weight; the newest PENDING recommendation
per ticker; the whole-shares switch.

1. **The pool.** `A` is first floored to whole cents. Weights and gaps are computed on the pool of items
   that have a target (holdings and watchlist): `pool_before` is the sum of their EUR values and
   `pool = pool_before + A`.
2. **Targets.** Targets are normalised if they do not add up to 1. A holding without a target is outside
   the pool: it neither receives money nor counts in any weight (the plan notes how many such holdings it
   left out). A watchlist item without a target is ignored.
3. **Gaps.** For each item `gap = max(target * pool - current_value, 0)`. An item with no shares yet has
   current value 0, so a new position with a target is the furthest below it.
4. **The analysis.** An item whose newest pending call is TRIM or SELL gets `gap = 0` (its money goes to the
   others). One whose newest pending call is ADD or BUY has `gap * 1.25` (constant `FAVOUR_FACTOR`).
5. **Sharing out.** If the gaps add up to at least `A`, each item receives `A * gap / sum(gaps)`. If they add
   up to less, every gap is filled and the remainder is shared by target weight among the items that may
   receive money. If nothing may receive money (all excluded, or no targets at all), the plan says so and
   proposes nothing.
6. **Minimum line.** Lines under `MIN_LINE_EUR` (25) are merged into the largest line so nobody is told to buy
   3 EUR of a stock. Amounts are rounded to whole cents by largest remainder (floor each amount to the
   cent, then give the missing cents to the largest fractions; ties go to the larger amount, then the
   ticker), so the lines add up to `A` exactly.
7. **Shares.** `shares = amount / price_in_EUR` (shown to three decimals). With "Whole shares only" each line
   is `floor(amount / price)` shares, its amount becomes `shares * price`, and the plan shows the leftover.
8. **Before and after weights** are computed for every line within the pool, so the screen can show the
   movement.

Currency handling: for each ticker the quote source gives a trading currency (UK listings that quote in pence,
`GBp`, are treated as pence of GBP). If it is not EUR, one exchange-rate lookup per currency converts the price.
The conversion is done once per plan; the rate and the currency used are returned with each line so the screen
can show them. The same helper can later fix the portfolio totals; that is not part of this feature.

## API

All routes require an active user and run through `get_user_db`.

| Method | Path | Behaviour |
| --- | --- | --- |
| POST | `/plans/preview` | Body `{amount, whole_shares}`. Computes and returns the plan without saving it. Rate limited, 10 a minute. |
| POST | `/plans` | Same body; computes again on the server and saves the plan and its lines, returns it. The client never sends lines. |
| GET | `/plans` | The person's saved plans, newest first (id, date, amount, number of lines). |
| GET | `/plans/{id}` | One saved plan with its lines. 404 for another person's id. |
| DELETE | `/plans/{id}` | Deletes it. |
| GET | `/plans/drift` | Open holdings with a target whose weight (within the pool of such holdings) is at least the drift threshold away from it, for the Today card. Watchlist items are not included. |

`amount` is a positive number up to a sane cap (1,000,000 EUR). A plan response carries the lines
(ticker, name, amount in EUR, shares, price in EUR, currency, rate, weight before, weight after, reason code
and text: `underweight`, `favoured`, `new position`, `remainder`), the notes (skipped tickers with the
reason: no price, no currency, no rate, excluded by a TRIM or SELL call, no target), the total, the leftover and
the "Advisory only" line. The holdings and watchlist `POST` routes accept `target_weight`. On the watchlist upsert an omitted value keeps the saved one and an explicit `null` clears it; the holdings upsert replaces the whole record, so an omitted `target_weight` resets it to null (the holding form always sends the full record).
Preferences gain `monthly_contribution` (nullable) and `drift_threshold_pct` (default 5, range 1 to 50).

## Data change

- `watchlist_items.target_weight` (nullable `numeric(5,4)`, check 0 to 1).
- `investment_preferences.monthly_contribution` (nullable `numeric(12,2)`) and `drift_threshold_pct`
  (`numeric(4,1)`, default 5.0, check 1 to 50).
- `telegram_links.plan_reminder_enabled` (boolean, default true).
- New tables `contribution_plans` (id, user_id, created_at, amount_eur, whole_shares, total_before_eur, leftover_eur,
  notes as JSON) and `contribution_plan_lines` (id, user_id, plan_id, ticker, name, amount_eur, shares, price_eur,
  currency, rate, weight_before, weight_after, reason). Both carry `user_id`, are in `USER_TABLES`
  (forced owner-only row security, grants with their id sequences), and are included in the data export and
  cleared by data deletion. There is no foreign key from the lines to the plans, like every other user
  table: the delete route and data deletion remove the lines explicitly. All of this is one hand-written migration.

## The screens

- **Plan** (new page at `/portfolio/plan`, reached from the Portfolio view strip "Holdings | This month | Saved plans",
  from the desktop sidebar's Plan sub-item under Portfolio, and from the Today card and reminder; the title stays
  "Portfolio" and the phone tab bar keeps Portfolio lit): the amount field
  pre-filled with the saved monthly amount, a "Whole shares only" switch, and the lines as a list with euro
  amount, approximate shares, weight before and after; notes under it (skipped tickers and why); a "Save plan"
  button; "Advisory only. Nothing is sent to a broker." The saved monthly amount is edited in Preferences, which the Plan page links to.
- **History** (the "Saved plans" view, `/portfolio/plan?tab=saved`; the This month preview survives switching): saved plans by month with their lines; opening one shows it as
  saved, with the prices and rates of that day.
- **Today drift card:** shown only when `GET /plans/drift` returns something: "AAPL is 7.2 points above its
  target, NVDA 6.1 below" with a link to the Plan page.
- **Targets:** the holding form already has the field; the watchlist gets the same field.
- **Telegram panel:** a third switch, "Monthly plan reminder".
- The frontend design is done with the huashu-design and impeccable skills before any code (three directions,
  the user picks one), as for the earlier features.

## The reminder

In the `notify` step, on the first weekday of the month (UTC) for a person with a linked, `ok` Telegram link and
`plan_reminder_enabled`, who has at least one target weight set (otherwise there is no plan to make), the day's
message gets one more line: "Plan this month's contribution: <app address>/portfolio/plan". If nothing else would
be sent that day, the line alone is the message. The existing once-a-day marker keeps it to one message, and
because the line is only added on the first weekday a month's reminder cannot repeat, so there is no second
marker. The line carries no amounts and no tickers.

## Security and privacy review points

Every plan is built inside the person's own scoped session from their own rows; `/plans/{id}` and delete only
touch the caller's row (row-level security with the runtime role); the plan response and the history contain
amounts, so they are never sent to Telegram or logged; the server computes lines itself and never trusts client
lines; the amount and the exchange-rate and ticker inputs are validated (a symbol built for the rate lookup comes
from a fixed currency list, never from user text); the preview route is rate limited because it triggers
outbound price lookups, and only items with a target are priced (never more than the 100 holdings and 100
watchlist items a person can have), 8 lookups at a time; a failing or
poisoned price source cannot produce a negative, infinite or NaN amount (such items are dropped with a note);
the reminder line contains no financial data. The security reviewer runs on the full diff before the pull request.

## Testing

- The calculation: gaps and sharing (a worked example with exact numbers), targets that do not add up to 1, a
  holding without a target, a new position from the watchlist, TRIM/SELL exclusion and its redistribution,
  ADD/BUY favouring, the remainder rule, the minimum-line merge, cent rounding that adds up exactly, whole
  shares and the leftover, nothing to fund, a contribution of zero or negative, tickers without prices.
- Currency: EUR passes through, USD converts with a fixed rate, pence quotes, a missing currency or rate leaves the
  ticker out with a note, one rate lookup per currency.
- API: preview versus save, the saved plan equals a fresh computation, another person's plan is invisible and
  undeletable, the amount bounds, the rate limit, history ordering, the export and data deletion.
- Drift: threshold boundaries, holdings without targets and watchlist items ignored.
- The reminder: first weekday logic including months starting on a weekend, a person without targets, the switch,
  the once-a-day marker keeping it to one message, combined with the daily message and alone, no amounts in the text.
- Frontend: the amount field and saved default, the lines and notes, whole-shares switch, save and history, the
  Today card, the Telegram switch, targets on the watchlist form.

## Documentation

ARCHITECTURE (data model, API, the calculation, the reminder and the drift card; remove the `rebalance.py`
remark), RUNBOOK (the reminder line and its switch), PRODUCT (the planner is built; the currency gap is closed
for the plan, still open for the portfolio totals).

## Open points to confirm during implementation

- Whether the quote source reliably reports a trading currency for the ETFs and stocks this person holds
  (Xetra, Amsterdam, US and UK listings); if a class of tickers returns nothing, the plan leaves them out with
  a note and the owner decides whether to add a stored currency later.
- The exchange-rate symbol conventions for each currency in use (EUR per USD, GBP and so on) and how a stale
  cached rate (five minutes) behaves around a weekend.
- The exact wording of the plan screen's notes and the reminder line, checked on a phone.
