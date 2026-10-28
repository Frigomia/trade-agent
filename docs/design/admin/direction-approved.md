# Direction approved: Admin in the Soft direction

Shown (2026-10-27): one proposal, [adm-soft.html](adm-soft.html), with screenshots in `shots/`, light and dark, for Users, Usage and limits, the phone and every state. It applies the Soft direction (chosen 2026-10-20, see `../today-discovery/direction-approved.md`) to the two Admin screens. [SPEC.md](SPEC.md) maps each part from today to the proposal.

Chosen by the owner: the proposal as shown. The owner merged the proposal (#249) and, asked whether to build, chose "Approved, build Admin": "At limit" and "Disabled" in amber with an icon and a word instead of red, the status icons, and one pull request for [#195](https://github.com/Frigomia/trade-agent/issues/195) in two commits (Users, then Usage and limits).

What this means for the build:

- Same content, states and copy as today. No new data and no backend change. "You manage access, not data." and the note that a key is never shown stay.
- Users: the filter is the shared pill control with counts (`aria-pressed`); each row keeps its columns, with a hairline role pill and the status as an icon and a word (check Active, envelope Invited, ban Disabled in amber); the selected row is tinted; the details panel and the phone sheet use the Soft sizes and 44px targets on a phone.
- Usage and limits: the default limits panel on the Soft fields with a check beside "Saved"; the table uses the shared `Bar` with a name and "used of limit" for each meter, and a level pill per person ("OK", "Near limit", "At limit", amber with a warning icon for both limit levels).
- Still open for #195: the sign-in screens, each with its own mock and approval.
