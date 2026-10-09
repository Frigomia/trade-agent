# Orders tab — design

## Goal

A saved plan's order lines can be placed over several days. The Orders tab lists every order line the
person has not placed yet, across all their saved plans, so a line from last month cannot be forgotten.
It is a view over data that already exists: nothing new is stored. The system still never places a trade
and never calls a broker; "Placed" only records what the person did (see the order tickets spec).

## Decisions (agreed in brainstorming)

| Question | Decision |
| --- | --- |
| Where it lives | A fourth view in the Portfolio strip, with an open-count badge: Holdings, This month, Saved plans, Orders (3). |
| What it shows | Open (unplaced) lines of the person's saved plans, grouped by plan ("October 2026, 2 open"), newest plan first. The same order cards as a saved plan: ticket, Copy, Placed, Add ISIN; Copy all lines per plan. |
| Placing from it | The same Record placed order sheet and auto-advance (the next open line of that plan opens). A placed line leaves the list. |
| Old plans | A plan older than 14 days shows a note: "Planned 8 Sep. Prices and weights have moved since; make a new plan if this is no longer what you want." The ticket still copies as written. |
| Phone | Four segments are tight at 390px: shorter labels at phone width only (Holdings, Plan, Saved, Orders). The designer renders it and the person picks. |
| Empty | "No open orders." with a line saying where orders come from (save a plan). |

Out of scope: deleting or dismissing a line without placing it, snoozing, notifications about open
orders, a Telegram line for open orders, and editing a plan's lines.

## What exists today

- Saved plans and lines (`contribution_plans`, `contribution_plan_lines`) with `placed_at` and
  `placed_trade_id`; `GET /plans` (summaries), `GET /plans/{id}` (a plan with its lines, the live ISIN and
  the placed shares and price), `POST /plans/{plan_id}/lines/{line_id}/placed`.
- The frontend: `OrdersPanel` (the cards, one plan at a time), `OrdersSection` (the Record placed order
  sheet, auto-advance, the status line) used by This month and by Saved plans (one opened plan), and the
  Portfolio strip `PortfolioTabs` with links `/portfolio`, `/portfolio/plan`, `/portfolio/plan?tab=saved`.

## API

One new read route, `GET /plans/orders/open`, declared above the `/{plan_id}` routes.

- Returns the person's saved plans that still have at least one unplaced line, newest first, each as the
  existing plan shape (`PlanOut`) with ONLY its unplaced lines, plus the count of open lines in total.
  Shape: `{ open_lines: int, plans: [PlanOut] }`.
- Built from the same loaders as `GET /plans/{id}` (live ISIN, placed fields), in a bounded number of
  queries (not per plan). Bounded by the 120-plan cap.
- Filtered to the caller's own rows (scoped session plus `user_id` filters). No new table or column.
- No rate limit beyond the other plan reads (it is a plain read of the person's own data).

## The screens

Designed with the huashu-design and impeccable skills before any frontend code (three directions for the
four-segment strip on a phone and the grouped Orders view; the user picks one).

- The Orders view: one block per plan with its heading (month, open count, saved date), the old-plan note
  when it applies, and that plan's open lines as the existing order cards. Placing a line updates the badge
  and removes the card; the block disappears when its last line is placed.
- The strip: the badge shows the total open lines and is hidden at zero. On the Holdings view the badge
  data is still needed: it is read once with the strip (a light request) and revalidated after a placement.
- Deep link: `/portfolio/plan?tab=orders`.

## Security and privacy review points

The route works only on the caller's own rows and cannot expose another person's lines (RLS plus
`user_id`). It returns no more than `GET /plans/{id}` already returns. Nothing is logged or sent to
Telegram. The old-plan note is plain text derived from the plan's saved date.

## Testing

- Backend: only unplaced lines are returned; plans with no open line are omitted; ordering newest first;
  the count; another person's lines never appear; the live ISIN and the placed fields on the lines; plans
  with some placed lines show only the unplaced ones; the bounded query count (no per-plan queries);
  authentication required; the route is not shadowed by `/{plan_id}`.
- Frontend: the tab and its badge (hidden at zero), grouping and ordering, the old-plan note at the 14-day
  boundary, placing a line updates the badge and the list, the empty state, Copy all lines per plan, the
  deep link, the phone labels, no Buy or Sell wording.

## Documentation

ARCHITECTURE (the route, the Orders view), PRODUCT (the Orders tab is built), the order tickets spec's
Future work (mark done).

## Open points to confirm during implementation

- The 14-day threshold is a constant in the frontend; confirm it reads right on a phone.
- How the badge is fetched on the Holdings view without making that screen heavier (a dedicated cheap
  count in the same response, or one shared SWR key).
