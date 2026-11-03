# The signed-out screens: the modern soft look (D1)

Proposed 2026-11-03. The owner asked for a redesign of Sign in, Set your password (the invitation), Reset your password and their states that looks modern and not template-made. Four rounds of options were shown and the owner chose **D1**. This folder holds the chosen mock only; the options that were not chosen were removed from the PR (they stay in the git history of this branch). This is a mock and a plan, not a change to the app, and it is not approved to build yet: see `direction-approved.md`.

Mock: [d1-reference.html](d1-reference.html) (`d.css`, `d.js`, `common.css`, `common.js`). Add `?theme=dark` for dark and `?screen=login|loginerr|invite|invalid|forgot|sent|reset` for the other screens. Shots in `shots/`: sign-in light and dark, tall and wide windows, the wrong-password state, the invitation, "Check your email", and the phone, all for D1.

![D1, sign-in](shots/d1-login-desk-light.png)

## What the chosen look is

The owner's reference image, built with care: a pale blue field with soft curves and a faint ring, the promise as a big tight headline top left with the one-line description under it, the research card (the app's own anatomy: the two meters, the dashed AI box, "Risk to the thesis", the cited sources) over a track-record strip, and a white rounded form card with deep soft shadows on the right. Two columns, light and dark, icons in the fields as in the reference. On a phone the card goes and the headline and the form sit together at the top.

The current screens are the [Soft sign-in restyle](../signin/SPEC.md): a brand half on the left and a flat form on the right. D1 keeps the Soft tokens (cobalt, Geist, 22 to 24px radii, the quiet lift) and changes the composition: the field and curves behind, the product shown beside the form, a larger headline and a card with more depth.

## What stays fixed

- **The words.** Every string is the app's own: the promise, "An advisory-only reasoning partner. You stay the decision-maker.", the invitation-only note, the 24-hour note, the advisory line, the error and link texts. No new claims.
- **The product truth.** Invitation only, advisory only, never places a trade. The acknowledgement checkbox on the invitation stays.
- **The states.** Sign in (also wrong password), Set your password, link not valid, Reset your password (also "Check your email"), Choose a new password.

## Left out on purpose

- **"Continue with Google"**, which is in the reference image. The product has no Google sign-in (access is by invitation, with email and password), so the button would promise something the app cannot do. Adding it is an auth change, not a visual one.
- **The Logo.dev credit** on these screens. They show no logo. Logo.dev's [attribution rules](https://docs.logo.dev/platform/attribution) ask for a visible "Logos provided by Logo.dev" link next to where logos are shown, for commercial projects on the free plan (personal projects and paid plans do not need it). Today the sign-in screens are the only place that carries it, so **leaving it off here means moving it into the signed-in app** (a quiet line in the footer of More, or under the logo lists on Today, Discover and Portfolio) in the same build, unless you are exempt. Logo.dev says to ask them when it is unclear.

## What the other rounds taught (not in this PR)

- A quiet one-question-at-a-time page and an editorial research-note page were shown first; the owner chose the third idea, showing the product's reasoning beside the form.
- Its first version was rejected as looking like a stock UI kit. Two harder passes (a ruled research document with a dark instrument-panel form, and a dark default) were built from the owner's notes, and then the owner went back to the first idea with the reference image.
- Two other compositions of the reference were shown next to D1: the form in the centre with the product on both sides, and the real Today screen in a window overlapping the form. The owner chose D1.
- Things worth keeping from those rounds if the owner wants them later: a research document with a "Computed scores, kept apart from the text" table, and three assurance lines under the form ("No broker connection", "Private by design", "Reasoning shown"). Both are new copy and neither is in D1.

## Decisions for you

1. **Approve the final D1 mock**, or say what to change.
2. **The "+3.1%"** on the track-record strip is the reference's number. It is labelled illustrative, but it is still a performance figure made up for a page that asks for trust. Keep it, or drop it (the strip then says only "Checked 20 trading days later").
3. **Icons in the fields.** D1 keeps them, as the reference does. Say if you want them out.
4. **The Logo.dev credit:** move it into the signed-in app in the same build (my suggestion), or tell me you are exempt.
5. **The logo mark** is a raster image (1536x1024 in an SVG wrapper): fine at 38px, it would blur larger. A vector version would sharpen it.
6. **A "Back to sign in" link** on "link not valid" and "Check your email": today those are dead ends. It is one line of new copy, so the mock leaves it out.

## Build notes (after approval)

- Components: `components/auth/AuthShell.tsx` (the frame: the field and curves, the headline block, the research card and strip, the form card), `app/login/page.tsx`, `app/accept-invitation/page.tsx`, `app/reset-password/page.tsx`. The fields, buttons and alerts are already Soft in `lib/theme/buildMuiTheme.ts`; the research card is a static component with its "Illustrative example" label (no real data), and the field behind it is an inline SVG.
- One PR for all the signed-out screens (they share the frame). Keep every test that asserts text, roles or labels; the redirect and session behaviour is unchanged.
- sizes in rem on the type ramp; a browser pass at 1280, 390 and 320px, light and dark, with a long email, before the PR. The invitation and reset screens need a link from the email.
- DESIGN.md gets the rules for the signed-out screens once built.
