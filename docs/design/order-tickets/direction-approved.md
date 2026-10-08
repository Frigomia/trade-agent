# Direction approved — Order tickets

Shown (2026-10): directions A (ticket strip), B (orders checklist), C (expandable rows) and a hybrid D, with screenshots in `shots/`. The user asked for D to be changed to show the approved ledger row when collapsed and Copy / Placed only when expanded, then approved it ("ok looks good").

Chosen: **D, as updated** (`d-hybrid.html`, `shots/d-*`, README "D - hybrid").

Build notes:

- Collapsed row = the approved ledger row (ticker and amount, name and about N shares, reason, weight bar with target tick and numbers). A small non-button status marker on the right: empty circle open, check placed. The whole card is the tap target and opens it (accessible name like "EIMI.L, 92.30 EUR, not placed, press to open").
- Expanded row = the collapsed content plus Copy and Placed side by side (touch targets 44px or more, "Copied" shown in place), the ticket text block, the ISIN row (or the Add ISIN control with its states: empty, typing, wrong check digit error, saved). No "Why" row.
- Placed row: the weight bar is replaced by "Placed 8 Oct · 1.69 sh at 54.60", the check marker, quiet card, no buttons; it can still be opened to read the ticket.
- Auto-advance: after Placed succeeds, the next unplaced row opens by itself, with a status line "EIMI.L recorded as placed. Next: IWDA.L, opened for you."
- Header "Orders  N of M placed" with progress dashes and "Copy all lines" (copies the unplaced tickets; disabled with "All lines placed" when none are left).
- Desktop follows the same rule as the phone (no buttons on closed rows).
- The Record placed order sheet (drawer on desktop, bottom sheet on phone) is as in the other directions: ticker fixed, planned shares prefilled, price EMPTY with "Price in the currency of this holding", date today, asset type for a new position, "Record order", error states.
- Tickets only on saved plans (also right after Save plan on This month); a preview has none.
