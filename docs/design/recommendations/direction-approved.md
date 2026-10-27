# Direction approved: the recommendation page and Track record in the Soft direction

Shown (2026-10-27): one proposal, [rec-soft.html](rec-soft.html), with screenshots in `shots/`, light and dark, desktop, phone and every state. It applies the Soft direction (chosen 2026-10-20, see `../today-discovery/direction-approved.md`) to the recommendation page for a call on a holding and to Track record. [SPEC.md](SPEC.md) maps each part from today to the proposal.

Chosen by the owner: the proposal as shown. The owner merged the proposal (#243) and, asked whether to build, chose "Approved, build recommendation page": the verdict icons and the "Pending" clock as proposed, the recommendation page in its own pull request for [#195](https://github.com/Frigomia/trade-agent/issues/195), Track record after.

What this means for the build:

- The recommendation page: the shared Soft `Bar` (amber under 60, `role="progressbar"`) replaces the MUI progress bar, "Pending" carries a clock, Ask about this is a 44px link, the evidence rows on a phone are 56px, the phone decision buttons sit in one panel, and Decision recorded is one panel (maxWidth 760) with the amber "No order was placed" box. Same copy as today.
- Track record is built in the next pull request, with the verdict icons.
- Still open for #195: the Signal backtest, Admin, and the sign-in screens, each with its own mock and approval.
