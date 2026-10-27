# Direction approved: Account and Preferences in the Soft direction

Shown (2026-10-27): one proposal, [account-soft.html](account-soft.html), with screenshots in `shots/`, light and dark, desktop, phone and every state. It applies the Soft direction (chosen 2026-10-20, see `../today-discovery/direction-approved.md`) to the Account and Preferences screens. [SPEC.md](SPEC.md) maps each part from today to the proposal.

Chosen by the owner: the proposal as shown. The owner merged the proposal (#237) and, asked whether to build, chose "Approved, build Account": Account first as its own pull request, Preferences after.

What this means for the build:

- Account is built in one pull request for [#195](https://github.com/Frigomia/trade-agent/issues/195)'s second screen. Preferences follows in its own pull request.
- Settled by building as proposed: Account in two columns on a wide desktop (from 1280px, the width of the mock; below that it stays the single 680px column, because two columns would leave the Telegram panel too narrow); the Telegram preview beside its panel on a desktop and after it on a phone; Preferences stays one column with the sticky save bar.
- Where the mock and the app differ, the app's behaviour wins and the look follows the mock. The MUI theme already carries the Soft fields, buttons, switches, dialogs and alerts, so the build is layout, the usage bar, the identity panel, the link rows, the shared state chip and the move onto the type ramp.
- Still open for #195: Preferences, Chat, the recommendation pages and Track record, the Signal backtest, Admin, and the sign-in screens, each with its own mock and approval.
