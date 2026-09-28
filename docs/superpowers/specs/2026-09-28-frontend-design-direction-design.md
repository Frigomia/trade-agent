# Frontend design direction

Status: approved in the brainstorming session on 2026-09-28. This is sub-project 1 of the frontend
roadmap (see "Roadmap" below). It defines what the frontend looks like and how it behaves; it builds
nothing.

Reference mockups (open in a browser, each frame has a working theme toggle):

- `docs/design/mockups/direction-A-dark-and-light.html`: Today (review), Portfolio, desktop, colour tokens
- `docs/design/mockups/auth-and-admin.html`: login, accept invitation, admin users / invite / user detail / usage
- `docs/design/mockups/user-sections.html`: recommendation detail, decision confirmation, track record,
  chat (normal and limit reached), preferences, account, log a trade, desktop portfolio and backtests

Product truth (users, principles, constraints) lives in `PRODUCT.md`. This spec does not repeat it.

## Understanding

The frontend is a phone-first, advisory-only dashboard over the existing FastAPI backend, used by one
admin and invited users (invitation-only, fully private per-user data). Success: a user sees what needs
a decision, understands why, and approves or dismisses in seconds, and can never mistake a recorded
decision for a placed trade. The admin manages access, not data.

## Visual direction: "Emerald Glass"

Chosen from three drafts against two user-supplied references (a dark TradeVision-style desktop
dashboard and a dark mobile finance UI). What is taken from them: a dark, glowing-emerald palette,
large numerals with dimmed decimals, glass panels, sparkline and area charts, a sidebar on desktop and a
tab bar on phones. What is deliberately not taken: any Buy / Sell / Deposit / Withdraw execution panel,
and the warm-orange primary action (the primary action colour is the accent).

### Themes

Two themes, dark and light, both first-class. Behaviour: follow the system setting by default; the round
toggle in the header overrides it and the choice persists; Preferences has a System / Light / Dark
selector as the explicit control. Switching is one attribute flip on the root element, so every
component reads colours only through tokens, never hard-coded values. An inline script in the document
head applies the stored theme before first paint so there is no flash.

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#060d0c` | `#f2f8f5` |
| `--text` | `#e7f3ef` | `#0b1f19` |
| `--text2` | `#cfe2dc` | `#29473c` |
| `--muted` | `#8aa89f` | `#52695f` |
| `--accent` (text, icons) | `#34e7a9` | `#078a5f` |
| `--accent-solid` (fills) | `#34e7a9` | `#067a52` |
| `--on-accent` | `#032116` | `#ffffff` |
| `--up` | `#34e7a9` | `#067a52` |
| `--down` | `#ff6b72` | `#c8323d` |
| `--warn` (TRIM, near limit) | `#f4c04f` | `#9a5b00` |
| `--up-bg` / `--down-bg` / `--warn-bg` | 12-13% tints of the colour | 10-11% tints |
| `--panel` | `rgba(255,255,255,.035)` | `rgba(255,255,255,.78)` |
| `--line` / `--line2` | `rgba(120,255,214,.11)` / `.2` | `rgba(8,110,80,.15)` / `.3` |
| `--track` | `rgba(255,255,255,.08)` | `rgba(10,60,45,.10)` |
| `--field` | `rgba(255,255,255,.045)` | `rgba(255,255,255,.9)` |
| `--scrim` | `rgba(0,0,0,.55)` | `rgba(11,31,25,.35)` |

The exact token set, including shadows and the background glow, is the `.tA` and `.tA.light` blocks in
the mockups; the implementation copies them as CSS variables. Light theme uses darker accent, up, and
warn values than dark on purpose: the dark theme's mint would be too pale on a light background.

### Type, shape, motion

- Geist (400, 500, 600, 700), loaded through `next/font`, system sans as fallback.
- Numbers are always tabular. Money and prices show the decimals dimmed (`10,204` + dim `.10`).
- Radii: panels 18, controls 12-14, pills and chips fully round. Panels are glass: translucent fill,
  hairline border, soft shadow.
- Icons are drawn line icons (1.75 stroke, round caps) from one symbol set; no emoji, no icon per heading.
- Motion is limited to state changes (theme switch, sheet and drawer open, focus). Honour
  `prefers-reduced-motion`.

### Layout

- Phone (primary): 4-tab bar (Today, Portfolio, Chat, More). More holds Track record, Backtests,
  Preferences, Account. Admin users get an Admin tab.
- Desktop: 218px sidebar (all sections; an "Administration" group for the admin), content beside it.
  Detail panels (invite, user) open as a right drawer; on phone the same content is a bottom sheet or a
  full page.

## Screens

Every screen below exists in the mockups in both themes.

**Authentication** (no app chrome, theme toggle in the corner, "Advisory information only, not
investment advice" footer)
- Login: email, password with show/hide, forgot password link. No sign-up link; a note says access is by
  invitation. Wrong-credentials state shows one generic message.
- Accept invitation: read-only email, create and confirm password with a strength meter (minimum 12
  characters), a required acknowledgement that the service is advisory only and a link to the privacy
  notice, and the invitation's expiry.
- Forgot / reset password: same form family. (Not separately mocked; it reuses the login and
  accept-invitation components.)

**Today / recommendation review**: pending recommendations first, one card each with ticker, action
badge, price and move, fundamentals score, technical read, suggested size, one-line reasoning,
Approve and Dismiss. Portfolio value tile with a sparkline above.

**Recommendation detail**: evidence in three visibly different kinds: numbers that decide (fundamentals
against the gate), timing (technicals, stated as not changing the call), and the AI's web second opinion
in its own dashed, labelled box marked "not part of the score". A conflict between web and numbers is
stated in words. Similar past calls from memory. Approve and Dismiss with "Approving records your
decision. Nothing is sent to a broker."

**After Approve**: confirmation "Decision recorded", "Nothing was sold", and the next step: act in your
own broker app, then "Log the trade I placed". Also "Change my decision".

**Portfolio**: value, cost basis, total P/L, holdings with weights and per-holding P/L, watchlist,
value-over-time chart from snapshots (Record snapshot action). Totals carry a quiet note that mixed
currencies are not converted, and no currency symbol.

**Log a trade**: bottom sheet (phone) or drawer (desktop). Past-tense wording (Bought / Sold), fields
ticker, shares, price, date. Text states it only records a trade already placed elsewhere.

**Chat**: portfolio-aware chat with a persistent, quiet usage indicator (used / limit). Web content is
always shown in the dashed "from the web, not part of the score" style. At the limit the indicator turns
warm, the input is disabled, and a banner explains the limit, the reset date, and who to ask. History
stays readable.

**Track record**: the recommendations' 20-day outcomes with a summary ("11 of 16 calls moved the way
the action implied"), each row showing action, date, decision, and the 20-day move. Scoring rule (UI
side, derived from the stored forward return): BUY and ADD count as matched when the return is positive,
TRIM and SELL when negative; HOLD and WATCH are not scored; dismissed calls are scored too. Always
labelled a small sample, not a forecast.

**Backtests**: run form (ticker, from, to), result against buy-and-hold with a two-line chart, and a
per-signal table (times seen, average move after, share that rose). States the 10,000 starting value and
that past performance is not a forecast.

**Preferences**: risk tolerance (three-way), sectors to avoid (chips), notes (2000 characters),
Appearance (System / Light / Dark). Text says preferences shape explanations and the web second opinion
and never change the score or the call.

**Account**: signed-in email, change password, the user's own usage with the reset date, links to the
secondary sections, Export my data, Delete my account and data, Sign out.

**Admin** (admin only; every admin screen carries "You manage access here, not data.")
- Users: filter by All / Active / Invited / Disabled with counts; table of email, role, status, last
  active, this-month usage bars; inline Resend and Revoke on invited rows; an amber "expires tomorrow"
  cue. Invite user drawer: email, role fixed to User (only one admin exists), monthly limits prefilled
  from defaults, 7-day link validity.
- User detail: usage this month, limits editor, Disable access (reversible, keeps data), Remove user
  (permanent; confirmation requires typing the user's email).
- Usage & limits: default limits for new invitations; per-user usage with OK / Near limit / At limit;
  counts only, never content.

## Copy and behaviour rules

These carry the product principles into the interface and are part of the design, not polish.

1. No screen offers Buy, Sell, Deposit, or Withdraw. Decision verbs are Approve and Dismiss. Trade
   logging is past tense (Bought, Sold, "log the trade I placed").
2. Any screen that records a decision or a trade says nothing is sent to a broker.
3. Advisory footer ("Advisory information only, not investment advice") on authentication screens,
   chat, and anywhere a recommendation is shown.
4. Quantitative evidence and the web second opinion are never styled alike, and conflicts are stated.
5. Limits are explained, never silent: what the limit is, when it resets, who to ask. Usage over 90% of
   a limit uses the warn colour; at the limit the message is a banner, not an error.
6. Errors are calm and generic where identity is involved (login) and specific elsewhere. No
   exclamation marks, no urgency language.
7. Destructive admin actions state what is deleted and what is not; permanent removal needs the email
   typed.
8. Colour is never the only carrier of meaning: up/down and status always come with a sign, a word, or a
   shape.

## Accessibility baseline

Body text must meet 4.5:1 in both themes. The token pairs were chosen for that but not measured
during design; measure them with the real components in the foundation sub-project. All controls are keyboard reachable with a visible focus
ring in the accent colour. Touch targets are at least 44px on phones. Charts have text alternatives
(the numbers appear beside them). Reduced motion is honoured.

## Explicit non-goals

No notification channel, no live price streaming, no currency conversion, no trade execution. Admin
never sees holdings, recommendations, or chats. Forgot-password is designed by reuse, not separately
mocked.

## Dependencies and open items

- Login and admin screens require the auth and multi-user backend (next sub-project); the backend today
  is single-user (`default_user_id`, no RLS). The frontend cannot ship those screens before it.
- Rate limiting is per IP today; per-user limits are part of the auth sub-project.
- `ARCHITECTURE.md` still describes a single-user system; it is corrected in the auth sub-project,
  together with the GDPR note (`§14`, `§16`).
- The Track record scoring rule above is a UI derivation; if the backend later stores a matched flag,
  use it instead.
- `DESIGN.md` (impeccable's implementation-facing design record) is written after the foundation
  sub-project, from the built components, not from mockups.

## Roadmap (approved)

1. Design direction (this spec).
2. Auth and multi-user backend: Supabase Auth JWT, roles admin/user, invitations API, replace
   `default_user_id`, real RLS, per-user limits and usage, per-user memory isolation.
3. Frontend foundation: scaffold, shell, tokens and theme toggle with no-flash script, API client and
   types, `frontend-ci.yml`, `frontend/CLAUDE.md`.
4. Login and admin screens.
5. Recommendations workflow (Today, detail, approve/dismiss, confirmation).
6. Portfolio (holdings, watchlist, log a trade, snapshots chart).
7. Chat.
8. Secondary: preferences, backtests, track record, account.

Each of 2 to 8 gets its own spec, plan, and implementation cycle.
