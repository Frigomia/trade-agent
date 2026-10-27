# Direction approved: the Signal backtest in the Soft direction

Shown (2026-10-27): one proposal, [bt-soft.html](bt-soft.html), with screenshots in `shots/`, light and dark, a result, the first visit, the phone and every state. It applies the Soft direction (chosen 2026-10-20, see `../today-discovery/direction-approved.md`) to the Signal backtest. [SPEC.md](SPEC.md) maps each part from today to the proposal.

Chosen by the owner: the proposal as shown. The owner merged the proposal (#246) and, asked whether to build, chose "Approved, build Signal backtest": the arrow beside the edge pills as proposed, in one pull request for [#195](https://github.com/Frigomia/trade-agent/issues/195).

What this means for the build:

- Same content, states and copy as today. The page layout, the chart and the data are unchanged.
- A new `EdgePill` (an arrow and the words or the signed number; green or red because it is a return, quiet and arrowless when level with buy-and-hold) is used for the result header and for each recent run. The open run carries `aria-current` and the accent tint. Running shows three dots beside its status line. The hit-rate table has hairlines, tabular numbers and the muted header, and sizes in these files moved onto the type ramp.
- Still open for #195: Admin and the sign-in screens, each with its own mock and approval.
