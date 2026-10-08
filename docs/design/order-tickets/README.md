# Order tickets: four design directions

Drafts for Task 7 of `docs/superpowers/plans/2026-10-09-order-tickets.md`. Nothing is chosen yet;
`direction-approved.md` is written after the user picks.

## Files

- `a-ticket-strip.html`, `b-orders-checklist.html`, `c-expand-rows.html`, `d-hybrid.html`: one direction each, rendered by
  `ot.js` (`window.OT`) and styled by `ot.css`, on top of the app tokens and shell in
  `../contribution-planner/` (`base.css`, `shell.js`, the approved ledger in `cp.css`/`cp.js`) and the approved
  Portfolio strip and sidebar in `../portfolio-nav/` (`pn.css`, `pn.js`). Add `?theme=light` and/or
  `&view=phone` to the address.
- `shoot.mjs`: `node shoot.mjs [a b c d]` writes `shots/{a,b,c,d}-{dark,light}-{desktop,phone}.png` (phone = 390 px)
  and reports any horizontal scroll at 390 px (none in this round).

Every direction shows, in order: the saved plan right after Save plan (none placed, EIMI.L "Copied"); one
placed (status chip "Placed 8 Oct · 1.69 sh at 54.60"); all placed ("All lines placed", Copy all lines
disabled); the Record placed order sheet for an existing holding, for a new position (Asset type ETF /
Stock), with a 422 and with a 409; Add ISIN on the NVDA ticket (empty, open, typing, wrong check digit,
saved). Sample plan: October 2026, 600.00 EUR over EIMI.L 92.30, IWDA.L 407.70 and NVDA 100.00 (new
position, no ISIN). The sheet is a right drawer on desktop and a bottom sheet on a phone; its price field is
empty with "Price in the currency of this holding", and it says nothing is sent to a broker.

## The directions

- **A · Ticket strip.** The approved ledger stays as it is; each line carries its ticket in an inset strip
  right below it, with Copy and Placed beside the text. Strength: the order sits next to the numbers that
  justify it, and it is the smallest change to the approved screen. Risk: the page doubles in height and the
  ticket repeats the amount already in the row.
- **B · Orders checklist.** A separate "Orders to place" panel above the untouched ledger (now "Plan
  details"): one tick-off row per order with a status circle, the ticket, Copy and Placed. Strength: it reads
  as a to-do list for the broker session and maps straight onto the future cross-plan Orders tab. Risk: two
  lists of the same three tickers on one screen.
- **C · Expandable rows.** A compact ledger with an Order column (Not placed / the placed chip); tapping a
  line opens its ticket, ISIN and a primary Placed button. Strength: the calmest screen, and on a phone the
  all-placed plan fits in one view. Risk: the ticket is hidden until tapped, so copying three orders takes
  extra taps (Copy all lines covers the common case).

Which I would pick: **B**, because placing orders is a sequential errand done beside the broker app and a
checklist fits that errand best, while the approved ledger stays untouched.

## D - hybrid

Revised after the user's feedback (phone first). The rows are the approved saved-plan ledger rows, with no
buttons until a line is opened.

- **Closed line.** The whole card is one button (chevron at the bottom right; accessible name such as
  "EIMI.L, 92.30 EUR, not placed, press to open"). On a phone: ticker and "92.30 EUR", then the name
  (truncated) and "about 1.69 sh", the reason, the weight bar with its target tick and "17.9 % to 18.4 % ·
  target 19 %". A status mark sits at the right of the ticker line: an empty circle while open, a filled
  check once placed. It is not a button.
- **Opened line.** The same content, then Copy and Placed side by side (48 px on a phone; Copy turns into
  "Copied" in place), the ticket ("Ticket, the text Copy copies") and the ISIN row, or for NVDA "None saved"
  with Add ISIN (typing, wrong check digit, saved). The old Why row is gone: the reason is already on the card.
- **Placed line.** The weight bar gives way to "Placed 8 Oct · 1.69 sh at 54.60", the text goes quiet and
  the mark becomes the check. It still opens to show its ticket and ISIN, with no buttons.
- **Auto-advance.** After Placed (the Record placed order sheet, unchanged from the previous D), the next
  unplaced line opens by itself, and a status line says so: "EIMI.L recorded as placed. Next: IWDA.L,
  opened for you."
- The Orders header (progress dashes, Copy all lines, "All lines placed" with Copy all lines disabled) is
  unchanged.
- **Desktop** keeps the same logic: one row per line (ticker and name, reason, weight, amount, mark,
  chevron) and the opened line shows the ticket on the left, Copy | Placed and the ISIN on the right. I kept
  the buttons off closed rows on desktop too: one rule on every screen, and with auto-advance the line you
  need is already open, so the buttons are one press away at most.
- Sample data as before; for D the NVDA after-weight is 1.2 % (100 EUR of the roughly 8,310 EUR pool the
  IWDA.L numbers imply) and its placed price 116.40.

Phone states (frames a to e, cropped in `shots/d-phone-{dark,light}-{a..e}.png`): (a) none placed, all
closed; (b) EIMI.L open with "Copied"; (c) Add ISIN on NVDA; (d) EIMI.L just placed, IWDA.L now open; (e) all
placed, EIMI.L opened to read its ticket.

- Strength: the closed screen is the approved ledger, calm and readable, with status at a glance; the
  errand becomes open, Copy, place at the broker, Placed, and the next line is already waiting. Copy sits
  right above the text it copies, so a wrong or missing ISIN is in view when it is copied.
- Risk: one extra tap per line compared with buttons on every row (auto-advance removes it after the first
  line); an auto-opened line moves content under the user's finger, which needs a short animation and the
  status line to stay understandable; a placed line's ticket is only reachable by opening it.
