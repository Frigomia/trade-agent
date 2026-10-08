# Contribution planner: three design directions

Drafts for Task 9 of `docs/superpowers/plans/2026-10-08-contribution-planner.md`. Nothing is chosen yet;
`direction-approved.md` is written after the pick.

## Files

- `a-one-column.html`, `b-split-rail.html`, `c-ledger.html`: one direction each (rendered by `cp.js` with
  `window.DIR`), styled by `cp.css` on top of the app tokens in `base.css` and the shell in `shell.js`
  (copied from `docs/design/telegram/`). Add `?theme=light` and/or `&view=phone` to the address.
- `shoot.mjs`: `node shoot.mjs` writes `shots/{a,b,c}-{dark,light}-{desktop,phone}.png` (phone = 390 px) and
  reports any horizontal scroll at 390 px.

Every direction shows, in order: the Plan result; the same plan with "Whole shares only" on (leftover
206.94 EUR); empty "Set a target weight first"; empty "Nothing to fund this month"; history with the
September plan opened as saved; the delete confirm; the Today drift card; the target field on the watchlist
add form and the holding form; the Preferences fields (saved monthly amount, drift threshold); the Telegram
panel with "Monthly plan reminder" and the sample reminder. The last three screens are shared: the Telegram
panel keeps its approved direction C and the forms follow the existing ones, so the directions differ on the
Plan page, its history and the drift card. Numbers are sample data worked through the spec's calculation.

## Comparison

**A · One column, amount first.** The amount is a large field at the top, the plan reads top to bottom as
sentences ("Add 312.04 EUR", "about 1.357 shares at 229.95 EUR", "Weight 0.0 % to 3.8 %, target 10 %"), saved
plans are a separate list with one plan opening in place.
- Strengths: calmest and most phone-native; the same layout on every width; each line reads like advice.
- Risks: the weight movement is text only, so comparing lines takes reading; history is a second view.

**B · Split workspace with a history rail.** A compact form row, a stacked bar of where the money goes, one
card per line with a weight bar, and a rail of saved plans beside it (a "This month / Saved plans" switch on
a phone).
- Strengths: the split is visible at a glance; past plans are one click away on desktop.
- Risks: most parts to build (bar, cards, rail); cards get tight at three columns and the rail is hidden on a phone.

**C · Ledger.** One table: ticker, why, an inline bar (weight before, the part this plan adds, the target
tick), price in EUR with the rate, amount; skipped tickers stay in the table at 0.00 with the reason; a total
row with the leftover. History is a ledger of months with the opened plan as the same table.
- Strengths: densest and most honest (skipped tickers sit next to funded ones); matches a monthly check on desktop.
- Risks: on a phone the table collapses to two-line rows and loses the price column; more to scan for a quick look.

My pick: **A** for the first version, because the planner is a once-a-month, mostly-phone task where a
clear sentence per line matters more than density; I would borrow C's inline weight bar for each line.
