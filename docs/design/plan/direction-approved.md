# Direction approved: Plan in the Soft direction

Shown (2026-10-26): one proposal, [plan-soft.html](plan-soft.html), with screenshots in `shots/`, light and dark, desktop and phone, 16 states. It applies the Soft direction (chosen 2026-10-20, see `../today-discovery/direction-approved.md`) to the three Plan views of the Portfolio page. [SPEC.md](SPEC.md) maps each part from today to the proposal.

Chosen by the owner: the proposal as shown. The owner asked for the build after merging the proposal (#235); the user's words: "Approved, build it".

What this means for the build:

- Built in one pull request for [#195](https://github.com/Frigomia/trade-agent/issues/195)'s first screen: the form, the ledger, Saved plans, Orders, the Placed sheet and the callouts.
- Where the mock and the app differ, the app's behaviour wins and the look follows the mock:
  - A saved plan is still shown as its orders (Copy, Placed, the ticket, the ISIN row), on This month after Save plan and under an opened plan in Saved plans, so those views use the Orders panel, not a read-only ledger.
  - A closed order line is short (logo, ticker and name, the amount and shares, a status mark, a chevron). Its why and its weight bar open with the line.
  - The Saved plans table's Orders column reads from the open-orders read the Orders tab already uses ("N open" or "All placed"), so no backend change was needed. It shows nothing while that read loads or fails.
  - The Orders tab's plan heading shows "N of M placed" with the progress segments. The open-orders read has only the unplaced lines, so M comes from the saved plans' `line_count` and N is M minus the open lines; the progress is left out if the saved plans cannot be read. The panel also names the plan's left-out tickers in one line, as in the mock.
- Open from the SPEC, settled by building as proposed: left-out tickers stay in the ledger at 0.00; the Orders count badge on the tab stays; red for Delete plan and the invalid-amount error, and the app's existing amber for notes and the old-plan banner.
- Still open for #195: Account and Preferences, Chat, the recommendation pages and Track record, the Signal backtest, Admin, and the sign-in screens, each with its own mock and approval.
