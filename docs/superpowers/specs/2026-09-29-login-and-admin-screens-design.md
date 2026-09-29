# Login and admin screens (sub-project 4)

Status: design approved in the brainstorming session on 2026-09-29. Fourth sub-project of the
frontend roadmap in `2026-09-28-frontend-design-direction-design.md` (sub-project 1: design
direction, approved; sub-project 2: auth/multi-user backend, done — PRs #21-#23; sub-project 3:
frontend foundation, done — PR #24).

- **1 Design direction:** done.
- **2 Auth and multi-user backend:** done.
- **3 Frontend foundation:** done — scaffold, theming, shell navigation (role-gated but with a
  temporary role stub), typed API client.
- **4 Login and admin screens (this spec):** the first real screens — login, accept invitation,
  password reset, and the full admin user-management surface.
- **5-8:** recommendations workflow, portfolio, chat, secondary screens — each its own cycle.

## Understanding

Sub-project 3 built the shell and theming but no real screens, and its `getCurrentRole()` is a
documented, temporary stub that always returns `"user"` — meaning `/admin` is reachable by URL
today with no guard at all, just a hidden nav link. This cycle replaces that stub with real
Supabase-session-backed authentication, builds the login/accept-invitation/password-reset flows,
and builds the admin screens (invite, list, disable, enable, remove, per-user limits, usage) against
the backend's `/admin/*` API. Success: a real login works end-to-end against the deployed Supabase
project; an unauthenticated visitor is redirected to `/login` from any protected route; a
non-admin cannot reach `/admin` even by typing the URL; the admin can complete the full user
lifecycle (invite → the invitee accepts → admin disables → re-enables → removes) without leaving
the app.

Constraints carried from `PRODUCT.md`, root `CLAUDE.md`, and prior specs: the system never places a
trade — nothing here is execution UI; the admin never sees financial data, only access-management
data and usage counts (already true of the backend API this consumes); the approved "Emerald Glass"
visual direction (mockups: `docs/design/mockups/auth-and-admin.html`) is the target look; calm,
generic error copy, matching the backend's own error message style.

## Scope

In scope:

- `frontend/proxy.ts` (Next 16's replacement for the deprecated `middleware.ts`): refreshes the
  Supabase session cookie on every request via `@supabase/ssr`'s documented pattern.
- `app/login/page.tsx` (replaces the placeholder): email/password sign-in, inline error state,
  "Forgot password?" link.
- `app/accept-invitation/page.tsx` (new): reads the Supabase session established by the invite's
  magic link, sets a password, ticks the terms checkbox, calls `POST /me/accept`.
- `app/reset-password/page.tsx` (new) + the login page's forgot-password trigger:
  `resetPasswordForEmail` / `updateUser({ password })`.
- `app/(shell)/layout.tsx` rewritten as an async Server Component: redirects unauthenticated
  visitors to `/login`, fetches the real role from `GET /me` server-side, replaces
  `getCurrentRole()`.
- `app/(shell)/admin/layout.tsx` (new): redirects non-admins away from `/admin`.
- Admin screens: users list (`app/(shell)/admin/page.tsx`, rewritten), an invite drawer, a
  user-detail drawer (limits, usage, disable/enable, remove-with-typed-confirmation), and a
  usage-and-limits overview page (`app/(shell)/admin/usage/page.tsx`, new).
- `lib/api/client.ts` gains a server-side counterpart for the layout's server-side `GET /me` call.
- SWR adopted for the admin screens' data fetching (first real use of the dependency
  `frontend/CLAUDE.md` already names as the stack's choice).

Out of scope: any non-admin, non-auth screen (Today, Portfolio, Chat, Preferences, Backtests,
Account, Track record — sub-projects 5-8); changing who can become an admin (still the bootstrap
command only); anything about the recommendation/portfolio/chat data itself.

## Design

### Session and route protection

`frontend/proxy.ts` is a thin wrapper: it calls a helper (`lib/supabase/proxy.ts`'s
`updateSession(request)`) that creates a Supabase server client bound to the request/response
cookies and calls `getUser()`, which refreshes the auth cookie if the access token has expired.
This alone does not redirect anything — it only keeps the session valid so server components can
trust it.

`app/(shell)/layout.tsx` becomes `async`: it creates the server Supabase client
(`lib/supabase/server.ts`, already built in #24), calls `getUser()`, and `redirect("/login")` if
there's no session. It then calls the backend's `GET /me` using that session's access token (via
the new server-side `apiFetch` counterpart) to get the caller's real `role` and `status`. A
`status !== "active"` response also redirects (an `invited` user who somehow reaches here without
finishing `/accept-invitation` goes back there; a `disabled` user's token is rejected by the
backend with 403 on this very call, which the layout treats as "no session" and redirects to
`/login`). The resolved `role` is passed down to `Sidebar`/`TabBar` exactly as `getCurrentRole()`
used to, so those two components need no changes.

`app/(shell)/admin/layout.tsx` is new and small: it receives no props from the parent beyond
`children`, re-derives nothing (the parent layout already proved the user is authenticated), and
only needs to know the role — resolved once more via the same `GET /me` server call (cheap; server
components in the same request tree share Next's request-level fetch cache) — `redirect("/today")`
if not `"admin"`. This is the concrete gap #24's final review flagged: today `/admin` is reachable
by URL with no guard at all.

`lib/api/client.ts` gains a server-side variant (exact shape decided at plan time — either a
second exported function `apiFetchServer<T>(path, accessToken, init?)` taking an explicit token, or
an overload — the existing browser-only `apiFetch` is unchanged and remains what every client
component uses). Both share the same `ApiError` class and error-parsing logic; only the token
source differs.

`lib/auth/role-stub.ts` is deleted. Its `Role` type moves to wherever the new role-resolution code
lives (`lib/auth/role-stub.ts`'s own comment already promised this: "Sub-project 4 replaces this
... keeping the same function name and return type" — the type is kept, the stub function is not).

### Login, accept invitation, and password reset

`app/login/page.tsx`: a Client Component (form state) with email/password fields (MUI `TextField`),
calling `createClient().auth.signInWithPassword({ email, password })`. On success, a client-side
`router.push("/today")` — the already-refreshed session cookie plus the shell layout's server-side
check take it from there; no manual role handling on this page. On failure, an inline error message
below the password field ("Email or password is incorrect. Try again or reset your password."),
matching the mockup's error-state screen exactly — not a toast. A "Forgot password?" link navigates
to a small email-only sub-state (or `/reset-password` with a `?request=1` mode) that calls
`resetPasswordForEmail(email, { redirectTo: <deployed-url>/reset-password })`.

`app/accept-invitation/page.tsx`: the invite email's link (Supabase's own magic-link mechanism)
lands here already carrying a session for the invited address. The page reads that session's email
(read-only field, greyed out, matching the mockup) and presents "Create password" / "Confirm
password" fields plus the terms checkbox from the mockup (submit disabled until checked). Submit:
`updateUser({ password })`, then `apiFetch("/me/accept", { method: "POST", body: { accept_terms:
true } })`, then redirect to `/today`. If the session is missing entirely (an expired or reused
single-use link — the exact failure mode documented from PR #22's owner verification), show a calm
message directing the person to ask the admin to resend the invite, not a raw error.

`app/reset-password/page.tsx`: reached via the password-reset email's own magic link (another
Supabase session, established the same way as the invite link). One "New password" field,
`updateUser({ password })`, redirect to `/today`.

All three routes render outside `(shell)` — no sidebar/tab bar/theme-toggle chrome — matching
`/login`'s existing placement from #24.

### Owner setup note

`INVITE_REDIRECT_URL` (backend env, currently unset, falling back to the Supabase project's Site
URL per PR #22's documented behavior) needs to be set to this frontend's real
`/accept-invitation` URL once deployed, so invite links land on the real page instead of falling
back to the Site URL. Same for password-reset's `redirectTo`. This is an owner deployment step, not
code — flagged here so it isn't missed the way `INVITE_REDIRECT_URL` was left unset through the
whole 2b/2c owner-verification cycle.

### Admin screens

`app/(shell)/admin/page.tsx` (rewritten): the users list. `useSWR("/admin/users", apiFetch)`
(SWR's key is also the path `apiFetch` takes, since `apiFetch` is generic over `T` and SWR just
needs a stable key plus a fetcher — `apiFetch` itself is the fetcher). A status segmented control
(All / Active / Invited / Disabled with live counts, matching the mockup) filters the same SWR data
client-side — no extra network call per tab. Header: an "Invite user" button opening
`InviteDrawer`. Each row: avatar-initials circle, email, role pill, status pill, and
status-conditional actions (`invited`: Resend / Revoke; `active`: row click opens
`UserDetailDrawer`; `disabled`: Enable). A persistent banner reading the mockup's own stated
principle ("You manage access, not data") sits at the top of every admin screen.

`components/admin/InviteDrawer.tsx`: an MUI `Drawer` (right-side on desktop, bottom-sheet on
phone — the same breakpoint pattern the shell already establishes for detail panels per the design
spec). One email field, `POST /admin/users/invite`, `mutate()` the list on success, close the
drawer. Inline error display for a 409 (already-registered address) using the backend's own
`detail` message.

`components/admin/UserDetailDrawer.tsx`: opened from an active or disabled row. Shows email,
status, `created_at`/`last_seen_at`, the two monthly limits (`monthly_analysis_limit`,
`monthly_chat_limit` from `GET /admin/users`, each editable — a number field plus a "use default"
control that sends an explicit `null` via `PATCH /admin/users/{id}/limits`, matching the API's
omitted-vs-null distinction from PR #23), this month's usage counts shown under each limit, and
Disable/Enable plus a Remove section. Remove matches the mockup's confirm-by-typing-the-email
pattern exactly: a text field, the Remove button stays disabled until its value equals the user's
email, then `DELETE /admin/users/{id}` with `{ confirm_email }`.

`app/(shell)/admin/usage/page.tsx` (new): two panels. Left: the system default limits — read-only,
since the backend has no endpoint to change `Settings.default_monthly_*_limit` (only per-user
overrides exist), matching the mockup's "defaults on the left" framing as informational. Right: a
table of every user's current-month usage, reusing the same `/admin/users` SWR data (no second
fetch) rather than treating this as a separate data source.

The mockup's phone admin screen ("quick invites and resends") is the same components at narrower
width via MUI's responsive `sx` breakpoints — no separate phone-only component, consistent with how
`Sidebar`/`TabBar` already split by breakpoint rather than by route.

### Errors

Backend errors surface through `ApiError.detail` (already built in #24, including the FastAPI
422-validation-array join fix) — shown as an inline, form-level alert in whichever drawer/form
triggered the call, never a toast, matching the mockups' calm tone throughout. Supabase auth
errors (`signInWithPassword` rejecting, `updateUser` rejecting a weak password) don't go through
`apiFetch` at all — they get their own inline messages, mapped from Supabase's own error codes to
the calm phrasing the mockups use.

### Testing

`proxy.ts`'s session-refresh logic (isolated, matching Supabase's own documented test approach);
the shell layout's redirect-when-unauthenticated and the admin layout's redirect-when-non-admin —
this is the concrete gap this cycle closes, so it gets a real, currently-passing test, not just
manual verification; login form validation and the inline-error-on-failure display;
accept-invitation's terms-gate (submit disabled until checked, matching `/me/accept`'s own 422
behavior); each admin action (invite/resend/revoke/disable/enable/remove/set-limits) tested against
a mocked `apiFetch`, including the omitted-vs-explicit-null limits distinction from the backend
spec; the users-list status-filter tabs.

## Definition of done

- `npm run lint`, `typecheck`, `test`, `build` all pass.
- `/admin` redirects a non-admin, even with a valid session and a typed-in URL.
- An unauthenticated visit to any `(shell)` route redirects to `/login`.
- Full manual walkthrough against the real Supabase project and backend: invite → email → accept
  invitation → login → admin sees the user active → disable (login refused) → enable → remove
  (gone from both the list and the Supabase dashboard) — the same checklist PR #22's owner
  verification already proved on the backend side, now proved through the actual UI.
- `INVITE_REDIRECT_URL` and password-reset's `redirectTo` documented as owner deployment steps.

## Risks

- `proxy.ts` is a very new Next.js convention (16.3.x; `middleware.ts` was only just deprecated) —
  less community precedent to lean on than `middleware.ts` if something's undocumented. Mitigated:
  the actual complexity is Supabase's own SSR session-refresh call, which is unchanged regardless
  of what the file is named.
- Testing the invite/accept-invitation/reset-password flows end-to-end requires either a real
  Supabase project (as PR #22's owner verification used) or mocking Supabase's client deeply enough
  to simulate a magic-link session — the plan should budget real owner-verification time for this,
  not assume unit tests alone prove it works, the same lesson PR #22 already taught.
- Two server-side `GET /me` calls per admin-route request (once in the shell layout, once in the
  admin layout) rely on Next's request-level fetch deduplication to avoid a real double network
  call — if that dedup doesn't apply here (it's most reliable for `fetch()` calls with identical
  arguments), it's a minor doubled request, not a correctness bug; worth a note in the plan to
  verify or simplify to one shared call if it doesn't dedupe.
