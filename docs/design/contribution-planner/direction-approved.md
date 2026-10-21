# Direction approved — contribution planner

> Cleanup note (2026-10-21): the options that were not chosen, and the old screenshot scripts, were removed from this folder. They are in git history before commit `18ce2f5`; read any mention of them below as history. Regenerating screenshots: see [../README.md](../README.md).

Shown (2026-10-08): three directions, each with dark/light and desktop/phone screenshots in `shots/`.

- A, one column, amount first: `a-one-column.html`
- B, split screen with a history rail: `b-split-rail.html`
- C, ledger: `c-ledger.html`

Chosen by the user: **C, the ledger.** User's words: "C".

Build notes:

- One table of plan lines with an inline weight bar (before, what this plan adds, target).
- Skipped tickers stay in the table at 0.00 with the reason, so the person sees what was left out.
- History is a table of months.
- On a phone the table collapses to two-line rows without the price column; check there is no horizontal scroll at 390px.
- The Today drift card, the target field, the Preferences fields and the Telegram panel follow the same screens in `c-ledger.html` (identical in all three directions).
- Copy: page title "Plan", "Make plan", "Save plan", "Whole shares only", "Advisory only. Nothing is sent to a broker." No Buy/Sell wording, no emoji.
