# Orders tab: three design directions

Drafts for Task 2 of `docs/superpowers/plans/2026-10-09-orders-tab.md`. Nothing is chosen yet;
`direction-approved.md` is written after the user picks.

## Files

- `a-stacked.html`, `b-plan-chips.html`, `c-groups.html`: one direction each, rendered by `ob.js` (`window.OB`)
  and styled by `ob.css`, on top of `../contribution-planner/` (`base.css`, `shell.js`, `cp.css`/`cp.js`),
  `../portfolio-nav/` (sidebar, header, strip look) and `../order-tickets/` direction D (`ot.js`/`ot.css`: the
  approved order cards, auto-advance status line, Record placed order sheet). Add `?theme=light` and/or
  `&view=phone` to the address.
- `shoot.mjs`: `node shoot.mjs [a b c]` writes `shots/{a,b,c}-{dark,light}-{desktop,phone}.png` and the dark
  phone crops `shots/{a,b,c}-phone-dark-{strip,view,old,placed,gone,sheet,empty}.png` (each at most 1000 px).
  It reports horizontal scroll at 390 px (none) and the lowest text contrast of the new pieces (dark 7.2:1 or
  more, light 5.0:1 or more).

Every direction shows: (a) the four-segment strip with the badge at 0 (hidden), 1, 4, 12 and 99+; (b) the
Orders view, October first with IWDA.L opened; (c) the old-plan note on September and August; (d) IWDA.L just
placed (October 1 open, NVDA opens, badge 3) and the last August line placed (the group is gone); the Record
placed order sheet over the view; (e) the empty state. Sample data: October 2026 (IWDA.L 407.70, NVDA 100.00),
September 2026 (EIMI.L 92.30), August 2026 (CSSPX.MI 250.00); 4 open.

## The directions

- **A · Stacked plan sections.** Every plan with open orders, newest first, one under the other; the plan
  heading (month, open count, saved date, Copy all lines) sticks while its lines scroll. Phone labels:
  Holdings, Plan, Saved, Orders, badge as a pill. Strength: nothing is hidden, so an old line cannot be
  forgotten, which is the point of the tab; simplest to build (`OrdersSection` once per plan). Risk: long on a
  phone once several plans are open; the old-plan notes repeat.
- **B · Plan chips.** A row of plan chips (month and open count, a clock on older plans on desktop) above one
  plan's cards, with "Also open: ..." under them. Phone labels: Holdings, This month, Saved, Orders, segments
  as wide as their label. Strength: the shortest screen, one plan in focus, the chips double as a summary.
  Risk: older plans sit behind a tap, the opposite of "cannot be forgotten"; an extra selection state to keep
  in sync after a plan's last line is placed.
- **C · Collapsible plan groups.** The newest plan open, older ones folded to one line ("EIMI.L 92.30 EUR ·
  Planned 8 Sep"). Phone labels: Holdings, Plan, Saved, Orders, badge as a plain number. Strength: every plan
  and every open line is named on the first screen, with depth one tap away; the amber "Planned 8 Sep" flags
  age without the full note. Risk: the most moving parts (fold state per plan); the plain-number badge is the
  quietest and easiest to miss.

My pick: **C**, with A's pill badge. It keeps the whole backlog visible like A while staying short like B,
and the folded summary already names the line and its age. A is the safe fallback if fold state feels like
too much for a list that is usually one or two plans long.
