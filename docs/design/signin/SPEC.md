# The sign-in screens in the Soft direction (Sign in, Set your password, Reset your password)

Proposed 2026-10-28 for [#195](https://github.com/Frigomia/trade-agent/issues/195) (the Soft restyle of the screens still on the older look), after Plan, Account, Preferences, Chat, the recommendation page, Track record, the Signal backtest and Admin. These three are the last screens of the issue. This is a mock and a plan, not a change to the app. Nothing is approved until the owner says so; then this folder gets a `direction-approved.md` like the others.

Mock: [signin-soft.html](signin-soft.html) (`si.css`, `si.js`; it loads the shared Soft files from `../today-discovery`, `../company-overview`, `../portfolio`, `../plan` and `../account`). Add `?theme=dark` to start dark; `?show=d-login,phones` shows only some blocks and `?st=2-4` only some states. Screenshots in `shots/`, light and dark: `login-desk`, `invite-desk`, `reset-desk`, `phones` and `states`.

## What changes and what does not

The fields, buttons and alerts already use the Soft theme in the app (`lib/theme/buildMuiTheme.ts`), so the "Today" column is about layout and sizes, not a new palette. The real changes are the desktop panel, the 44px targets, the acknowledgement checkbox and the type ramp.

Same content, same states, same copy as the app today, including the promise on the brand panel, "by invitation only", the 24-hour note and the advisory line. No new data, no new copy, no backend or auth change. The checks that keep the invitation and reset forms from changing the wrong person's password are untouched.

| Part | Today | Soft proposal |
|---|---|---|
| Frame | A brand half on the left from a tablet up (hairline between the halves) and one form column; one column on a phone | The same two halves on the Soft page background; the promise, the sub-line and the advisory line keep their words |
| The form | Fields straight on the page | On a desktop the fields and the button sit in one Soft panel (22px radius, the quiet lift), the heading above it. On a phone the form stays flat on the page, as today, so no width is lost |
| Fields | MUI outlined fields with an icon | The Soft fields: label above, 44px, a hairline border, the accent ring on focus, the icon inside on the left. The invited email is a quiet filled field (disabled) |
| Show or hide password | A small icon button on Sign in only | The same button on Sign in only, at 44px, with the same names ("Show password", "Hide password"); the two new-password screens stay without one, as today |
| Errors | A MUI error alert; the password field turns red | The shared Soft error box, same words; the field border and the helper text ("Use at least 8 characters.", "Passwords don't match.") keep their red because they mark a field that needs fixing, not a price move |
| Invitation only | An info alert with a mail icon | The same note as a quiet tinted box |
| Acknowledgement | A MUI checkbox | A 22px Soft box with a check, inside a 44px target; the words are the same |
| Primary button | The contained button | The Soft primary button, full width, 44px; greyed while it works or until the form is valid, as today |
| Forgot password? | A text link | The same link with a 44px target |
| Link not valid, link sent | A warning alert, a success alert, with no heading | The shared amber box and the tinted note, same words, still with no heading |
| Theme toggle | The round toggle (34px) | The same toggle at 44px |

Rules kept from `DESIGN.md`: sizes in rem on the build (the mock's px are its own base), green and red only for a price move or return (the red on a field that needs fixing, and the error box, is the existing form-error convention, not a price move), shape plus word for every status, 44px touch targets, no horizontal scroll at 390px (the mock shows 390px; 320px is checked in the build's browser pass, with a long email and the Logo.dev credit as the likely overflow points). The small `Logos provided by Logo.dev` credit (shown only when the token is set) is drawn at the foot of the form column in the mock, 44px tall. Below 900px the brand half goes and the advisory line moves under the form, as today.

## States in the mock

Sign in: the default, a wrong password, no access, signing in with the password shown. Set your password: ready, too short, not matching, could not record the acceptance, link not valid. Reset: ask for the link, the request failed, link sent, choose a new password (a recovery link) and a failure on that step. The phone shows Sign in, Set your password, Reset, Link sent and Choose a new password. The mock is static: the show/hide button and the theme toggle do not respond. Light and dark, desktop and phone.

## Decisions for you

1. **Approve the look**, or say what to change. One proposal on the approved Soft direction; say if you want alternatives.
2. **The form in a panel on a desktop** (and flat on a phone). This is the one visible change in structure. Say if you want it flat on both, as today.
3. **A dead end on "link not valid".** Today that screen shows only the warning, with no way out. A "Back to sign in" link would fix it, but it is new copy, so the mock leaves it out. Say if you want it added in the build (a one-line change).
4. **Build:** one PR for the three screens (they share the frame and the field styling). Recommended.

## Build notes (after approval)

- Components: `components/auth/AuthShell.tsx` (the frame, the brand half, the heading), `app/login/page.tsx`, `app/accept-invitation/page.tsx`, `app/reset-password/page.tsx`. Reuse `Panel` and the Soft theme; the fields, buttons and alerts are already Soft in `lib/theme/buildMuiTheme.ts`; the 22px acknowledgement checkbox is new (`MuiCheckbox` has no override yet), drawn with the on-accent tick so it reads in dark mode. The form sits 96px below the top on a desktop, as today.
- Keep every test that asserts text, roles or labels; the redirect and session behaviour is unchanged.
- The off-ramp sizes (1.0625rem, 1.75rem, 0.90625rem, 0.78125rem) in these files move onto the type ramp: the heading becomes 1.875rem (1.625rem on a phone, as the page title elsewhere). The form column stays 380px.
- A browser pass at 1280, 390 and 320px, light and dark, with the Logo.dev credit shown and a long email before the PR. The real flows need a signed-out browser; the invitation and reset screens need a link from the email.
