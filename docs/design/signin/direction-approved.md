# Direction approved: the sign-in screens in the Soft direction

Shown (2026-10-28): one proposal, [signin-soft.html](signin-soft.html), with screenshots in `shots/`, light and dark, for Sign in, Set your password, Reset your password, the phone and every state. It applies the Soft direction (chosen 2026-10-20, see `../today-discovery/direction-approved.md`) to the three signed-out screens. [SPEC.md](SPEC.md) maps each part from today to the proposal.

Chosen by the owner: the proposal as shown. The owner merged the proposal (#252) and, asked whether to build, chose "Approved, build sign-in": the form in a panel on a desktop and flat on a phone, no "Back to sign in" link on the "link not valid" screen (it would be new copy), and one pull request for [#195](https://github.com/Frigomia/trade-agent/issues/195).

What this means for the build:

- Same content, states and copy as today. No backend or auth change; the session and recovery checks are untouched.
- A new `AuthPanel` holds the fields and the button: a Soft panel from the md breakpoint, flat below it. A new `AckCheckbox` is the 22px acknowledgement box inside a 44px target, with the tick in the on-accent colour. The theme toggle, the show-password button and "Forgot password?" are 44px. The heading, brand name and sub-lines move onto the type ramp.
- This closes the screens listed in #195.
