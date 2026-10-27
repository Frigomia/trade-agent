# Account and Preferences in the Soft direction

Proposed 2026-10-27 for [#195](https://github.com/Frigomia/trade-agent/issues/195) (the Soft restyle of the screens still on the older look), second screen after Plan. This is a mock and a plan, not a change to the app. Nothing is approved until the owner says so; then this folder gets a `direction-approved.md` like the others.

Mock: [account-soft.html](account-soft.html) (`acct.css`, `acct.js`; it loads the shared Soft files from `../today-discovery`, `../company-overview`, `../portfolio` and `../plan`). Add `?theme=dark` to start dark; `?show=d-account,phones` shows only some blocks and `?st=2-4` only some states. Screenshots in `shots/`, light and dark: `account-desk` and `prefs-desk` (the two screens on a desktop), `phones` (Account and Preferences at 390px) and `states` (every state of both screens).

## What changes and what does not

Same content, same states, same copy as the app today. Both screens already sit in the Soft shell (page title, sidebar, tab bar); what is still on the older look is the content, which is MUI defaults on flat panels.

| Part | Today | Soft proposal |
|---|---|---|
| Account, who is signed in | Two text lines in a panel | A panel with a round monogram, "Signed in as" and the email |
| Usage | MUI progress bars, a small caption for the reset date | Rounded 8px bars on the track colour; the count at the right; "Near limit" or "At limit" stays as a bold word and the bar turns amber; the allowance message is a soft amber box |
| Claude | Panel with an outlined chip and MUI buttons | The same panel with the Soft chip (Connected, Needs attention, Not connected), the masked key in a quiet monospace tag, Replace or Reconnect and Remove as the shared buttons |
| Telegram | Panel plus a preview card; MUI switches and an outlined field | Same two panels; Soft switches, rows with a hairline between them, the threshold as a Soft field, the message preview in an accent-wash bubble |
| Links (Track record, Signal backtest, Preferences) | A flat list | One panel of 52px rows with icon and chevron |
| Change password | MUI outlined fields | Soft fields with the label above; an error box and a "Password changed." line with a check; a folded row on a phone, as today |
| Export and Delete my data | Two text buttons; the typed-email confirm inline | The same two rows; the confirm stays inline (text, field, "Confirm delete my data" disabled until the email matches) |
| Sign out | Outlined full-width button | The shared ghost button |
| Preferences sections | MUI toggle group, chips, outlined fields, one panel per section | One panel per section with a title and a hint; the pill segmented control for Risk tolerance and Appearance; Soft tags with a remove button; a Soft notes box with the counter; Soft fields with their unit |
| The two automatic-analysis switches | Two panels | Two panels, same copy; the paused note is an amber line with an icon and the word "Paused" |
| Save bar | Sticky panel with a chip, Discard, Save preferences | A sticky Soft bar: "Unsaved changes" pill or "Saved" with a check, Discard (disabled until there is a change) and Save preferences; on a phone the status takes its own line above two equal buttons |

No new data and no backend change. Every field is one the two pages already read (`/me`, `/me/usage`, the Claude and Telegram status, `/preferences`). No copy is new: every line is the one in the app today. "Advisory only. Nothing is sent to a broker." stays in the Telegram note and the message preview.

Rules kept from `DESIGN.md`: sizes in rem (13px body, 12px label, 15px lead, 20px title; nothing in the screens below 12px; the mock's own state captions use the shared 11.5px caption), green and red only for a price move (the red here is for destructive and error only, as on Plan), shape plus word for every status (the chips and the paused notes carry an icon and a word; "Near limit" and "At limit" are words), 44px touch targets on a phone (a switch is 26px tall with an invisible 44px hit area), no horizontal scroll at 390px.

## States in the mock

Account: Claude not connected, needs attention, loading, could not load, remove confirmation; usage near and at the limit; Telegram not connected, waiting for Start, connected with the sample message, blocked, threshold not valid, not available on this server, could not load, disconnect confirmation; Change password (wrong current password, passwords differ, done); Delete my data (typed email not matching, matching); Sign out failed. Preferences: nothing changed, unsaved, saved, invalid amounts, sector list full, automatic analysis and discovery paused (used all runs, no key, last run kept), could not save, could not load.

## Decisions for you

1. **Approve the look**, or say what to change. One proposal on the approved Soft direction, as #195 asks; say if you want alternatives for either screen.
2. **Two columns on a desktop Account** (identity, usage, Claude, Telegram and the links on the left; Change password, data and Sign out on the right) instead of the single 680px column today. The phone stays one column in the same order. Say if you prefer to keep one column.
3. **Telegram preview** stays beside the Telegram panel on a desktop and follows it on a phone (today the phone shows the preview first).
4. **Preferences stay one column** (760px) with the sticky save bar, as today.
5. **Build order after approval:** one build PR for Account and one for Preferences (they share almost no components), or one for both. Recommended: two PRs, Account first.

## Build notes (after approval)

- Components: `app/(shell)/more/account/page.tsx`, `UsageSummary`, `ClaudeKeyPanel`, `TelegramPanel`, `ChangePasswordForm`, `DataActions`, and `app/(shell)/more/preferences/page.tsx`, `AutoAnalysisSwitch`, `AppearanceSetting`. Reuse `Panel`, `Pill`, `SegmentedControl` and the Soft tokens; the monogram is `Logo`-style (round), and a small `Switch` wrapper may be worth adding if the Soft switch is used in more than these two screens.
- Keep every test that asserts text, roles or labels (the Remove and Disconnect dialogs keep their MUI `Dialog` behaviour; only the look changes). Add a phone check for no horizontal scroll at 390px.
- The off-ramp sizes (0.78125rem, 0.84375rem and similar, converted from pixels in #192) move onto the type ramp as part of this restyle.
- A browser pass at 1280, 390 and 320px, light and dark, before each PR.
