# Admin in the Soft direction (Users, Usage and limits)

Proposed 2026-10-27 for [#195](https://github.com/Frigomia/trade-agent/issues/195) (the Soft restyle of the screens still on the older look), after Plan, Account, Preferences, Chat, the recommendation page, Track record and the Signal backtest. Only the sign-in screens remain after this. This is a mock and a plan, not a change to the app. Nothing is approved until the owner says so; then this folder gets a `direction-approved.md` like the others.

Mock: [adm-soft.html](adm-soft.html) (`adm.css`, `adm.js`; it loads the shared Soft files from `../today-discovery`, `../company-overview`, `../portfolio`, `../plan` and `../account`). Add `?theme=dark` to start dark; `?show=d-users,phones` shows only some blocks and `?st=2-4` only some states. Screenshots in `shots/`, light and dark: `users-desk`, `usage-desk`, `adm-phones` and `adm-states`.

## What changes and what does not

Same content, same states, same copy as the app today. No new data, no new copy, no backend change. The admin manages access, never data: the notes "You manage access, not data." and "You see only whether a key is connected, never the key and never its digits." stay.

| Part | Today | Soft proposal |
|---|---|---|
| Users header | Title, Invite user | The Soft title, a primary Invite user with a plus; the "You manage access, not data." note as a quiet tinted box |
| Filter | Chips with counts (All, Active, Invited, Disabled) | The pill control with the counts as small chips; the chosen one raised (`aria-pressed`) |
| The list | A panel of rows: a small avatar, the email, the role chip, the status chip, the Claude chip, actions | The same columns: a monogram, the email (it keeps its width, the actions wrap under it before it truncates), a hairline role pill, the status as an icon and a word (check Active, envelope Invited, ban Disabled), the Claude state chip, Resend and Revoke, Enable, the details button; the selected row is tinted |
| User details | A side panel (a bottom sheet on a phone) with the limits, Disable, Remove | The same panel on the Soft tokens: the email, the status, the Claude chip, "Monthly limits" with the used-of-limit labels and Use default, Save limits, Disable or Enable, Remove user with the typed email (Remove stays off until it matches) |
| Invite | A MUI drawer with an email field | The same drawer in the Soft look: the field, "Send invite", the error box |
| Usage and limits | Default limits panel and a table with a MUI progress bar per cell and a status pill | The default limits panel with Soft fields, "Save defaults" and "Saved" with a check; the table with the 6px Soft bar and a level pill per person ("OK", "Near limit", "At limit", an icon and a word, amber for both limit levels); a card per person on a phone |

Rules kept from `DESIGN.md`: sizes in rem on the build, green and red only for a price move or return (so "At limit" is amber with a word, not red as it is today on this page), shape plus word for every status, 44px touch targets on a phone, no horizontal scroll at 390px.

## States in the mock

Users: the invite drawer and a refused invite, an action that failed, could not load, the filter on Invited, nothing selected (a desktop), a disabled person, Remove with the email typed and not typed, a change that failed. Usage and limits: default limits saved and invalid, could not load. Light and dark, desktop and phone.

## Decisions for you

1. **Approve the look**, or say what to change. One proposal on the approved Soft direction; say if you want alternatives.
2. **"At limit" in amber**, the same as "Near limit" with a different word, instead of the red it has on this page today. This follows the Account and Chat screens and the rule that red means a price move. Say if you want it to stay red.
3. **The status icons** (check, envelope, ban) beside Active, Invited and Disabled, and **Disabled in amber** instead of the red it has today (the same rule as decision 2). A small change for the shape-plus-word rule; the words stay.
4. **Build:** one PR for Users and one for Usage and limits (they share only the avatar and the note), or one for both. Recommended: one PR, in two commits.

## Build notes (after approval)

- Components: `app/(shell)/admin/page.tsx`, `UserDetailDrawer` (its inline content and the phone sheet), `InviteDrawer`, `DefaultLimitsPanel`, `app/(shell)/admin/usage/page.tsx`. The Claude chip is already the shared Soft pill. Reuse `Panel`, `Pill`, `Bar` and the tokens; the MUI `Table` on the usage page keeps its phone card layout.
- Keep every test that asserts text, roles or labels; the busy and dismissal behaviour from #239 is unchanged.
- The off-ramp sizes (0.78125rem, 0.84375rem, 1.0625rem) in these files move onto the type ramp.
- A browser pass at 1280, 390 and 320px, light and dark, with a long email, many users and a person at their limit before the PR.
