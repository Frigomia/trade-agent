# Plan ledger polish — design

## Goal

Finish three items of the approved plan screen design that the first build left out, so the saved plan
and the portfolio look as designed: the target tick on the weight bars, tickers left out of a plan shown
as 0.00 rows with their reason, and the Avg cost column back on the holdings table at narrower widths.
No new behaviour of the planner: the same plan comes out, with a little more recorded about it.

## Decisions (agreed in brainstorming)

| Question | Decision |
| --- | --- |
| Target tick | Each plan line stores the plan-time target weight (the normalised target the planner used). The ledger shows the tick and "target 19 %" next to "17.9 % to 18.4 %". Lines saved before this change have no target and show no tick (no guessing). |
| Left-out rows | The plan carries structured left-out entries (ticker, name, reason) instead of only free-text notes. The ledger shows them as 0.00 rows with the reason. Saved plans keep them. Notes that are not about one ticker stay as notes. |
| Avg cost | Moved into the Shares cell's second line ("1.407 sh · avg 1,492.38") so no column is dropped and the P/L and Weight / Target cells still fit at every width. |

Out of scope: header actions on the plan views, changing how the planner decides anything, showing left-out
tickers in the Telegram message, editing a plan.

## What exists today

- `contribution_plan_lines` has the amount, shares, price, currency, rate, before/after weights and the
  reason, but not the target. `contribution_plans.notes` is a JSON list of strings; a ticker left out of
  the plan appears only as a sentence such as "NVDA is left out: no price available." or "AAPL gets no
  money: its newest pending call is SELL." The ledger lists the notes under the table.
- The planner (`app/planner.py`) builds those sentences for tickers it excludes (a TRIM or SELL call, an
  unusable price, less than one share); `app/plans.py` adds the ones for tickers `app/fx.py` could not
  price and for holdings without a target.
- The holdings table (`frontend/lib/portfolio/holdingColumns.ts`) shows Avg cost only from the `xl`
  breakpoint (1536px) because seven numeric columns do not fit below that.

## Data change

One hand-written migration (a new file):

- `contribution_plan_lines.target_weight`: nullable `numeric(7,6)` (the normalised target, 0 to 1, check
  0 to 1 when set).
- `contribution_plans.left_out`: nullable JSON (a list of `{ticker, name, reason, kind}`), where `kind`
  is one of `no_price`, `no_currency`, `no_rate`, `out_of_range`, `excluded_call`, `unusable_price`,
  `too_small` (less than one whole share). Old plans keep NULL and show their notes as before.
- The data export carries both. Row security is unchanged (existing tables).

## API

- `PlanLineOut` gains `target_weight: float | None`; `PlanOut` gains `left_out: list[LeftOutOut]`
  (`ticker`, `name`, `reason` text, `kind`). Both are filled by the preview and by the saved plan.
- The reason texts stay the sentences the notes have today (so the wording does not change); the notes list
  keeps only the sentences that are not about one ticker (for example "1 holding has no target weight and
  is left out of the plan.", "No ticker with a target could be priced right now.").
- The planner returns the structured left-out entries together with its notes; `plans.compute` merges the
  entries from `fx` and from the no-target counting. The saved plan stores them in `left_out`.

## The screens

The designs exist (the contribution planner direction C and its screenshots show the tick and the 0.00
rows; the portfolio navigation mockup shows the Avg cost). No new design directions are needed; a short
visual check against those mockups happens at the end.

- Weight bar: a target tick on the bar and "target 19 %" in the numbers line, when the line has one.
- Left-out rows: after the funded lines, one muted row per left-out ticker: ticker and name, the reason,
  "0.00" in the amount column, no weight bar. Counted nowhere in the total or the leftover.
- The saved plan's Orders cards: a left-out ticker is not an order, so it is not an order card; it shows
  in a "Left out of this plan" list below the cards (a saved plan keeps what was left out).
- Holdings table: the Shares cell reads "1.407274" with "avg 1,492.38" as its second line at every width
  (the separate Avg cost column is removed); the phone line is unchanged.

## Security and privacy review points

Nothing new is exposed: the target weight is the person's own number and the left-out entries repeat what
the notes already said. No new route. Plan data is not logged or sent to Telegram.

## Testing

- Backend: the planner and plan service return a target on each line (normalised, summing to 1 across the
  funded and unfunded targeted lines) and one structured entry per excluded ticker with the right `kind`;
  the sentences are unchanged; notes keep only the general ones; save and load round-trip the new fields;
  old rows (NULL) load without error and show no target and their notes; export carries them; the migration
  upgrade and downgrade.
- Frontend: the tick and the target text, no tick when the target is null, the 0.00 rows and their reasons,
  the left-out list on a saved plan, a plan without `left_out` keeps its notes list, the Shares cell with the
  Avg cost second line and the column grid without the Avg cost column, no horizontal scroll at 390px.

## Documentation

ARCHITECTURE (data model, the plan response, the ledger), PRODUCT, the planner spec's screens section if it
still describes notes only.

## Open points to confirm during implementation

- Exact `kind` names and whether `unusable_price` and `no_price` can be merged.
- Whether the target should be stored on lines that are funded only, or on every targeted candidate that
  becomes a line (the plan only has lines for funded tickers; left-out entries have no target).
