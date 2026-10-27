# Direction approved: Chat in the Soft direction

Shown (2026-10-27): one proposal, [chat-soft.html](chat-soft.html), with screenshots in `shots/`, light and dark, a conversation, the empty starters, the phone and every state. It applies the Soft direction (chosen 2026-10-20, see `../today-discovery/direction-approved.md`) to the Chat screen. [SPEC.md](SPEC.md) maps each part from today to the proposal.

Chosen by the owner: the proposal as shown. The owner merged the proposal (#241) and, asked whether to build, chose "Approved, build Chat": the squared corners, the starters as rows and the two allowance words as proposed, built in one pull request for [#195](https://github.com/Frigomia/trade-agent/issues/195).

What this means for the build:

- Same content, states and copy as today, plus the words "Near limit" and "At limit" beside the allowance.
- Text sizes stay on the type ramp the components already used (the message text stays 0.9375rem); the mock's 13px sample text is the mock's base, not a change. The off-ramp sizes (0.78125rem, 0.84375rem, 0.875rem) in the Chat components moved onto the ramp.
- `ClaudeRequired` is shared with Today, so its padding, title size and softer warning border change there too.
- Still open for #195: the recommendation pages and Track record, the Signal backtest, Admin, and the sign-in screens, each with its own mock and approval.
