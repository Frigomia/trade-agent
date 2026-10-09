# Direction approved — Orders tab

Shown (2026-10): three directions (A stacked plan sections, B plan chips, C collapsible groups), screenshots in `shots/`.

Chosen by the user: **A, stacked plan sections with a sticky plan heading** ("A").

Build notes:

- Strip: Holdings | This month | Saved plans | Orders on desktop; on a phone (390px) the labels shorten to Holdings, Plan, Saved, Orders. The Orders badge is a pill with the total open lines: hidden at 0 and while loading or on error, "99+" above 99, accessible name "N open orders".
- Orders view: one section per plan, newest first, each with a sticky heading ("October 2026, 2 open", saved date) and that plan's open lines as the approved order cards (direction D of order tickets: collapsed ledger row with status marker, expanded Copy/Placed/ticket/ISIN) plus Copy all lines per plan. Nothing is collapsed or hidden.
- Old plans (saved more than 14 days ago) show under their heading: "Planned 8 Sep. Prices and weights have moved since; make a new plan if this is no longer what you want." (the date is the plan's saved date).
- Placing a line: the same Record placed order sheet and auto-advance (the next open line of that plan opens, with the status line); the placed card leaves the list, the heading count drops, and a section with no lines left disappears.
- Empty: "No open orders." with a line that orders come from saving a plan, and a link to This month.
- Deep link `/portfolio/plan?tab=orders`. "Advisory only. Nothing is sent to a broker." once per screen.
