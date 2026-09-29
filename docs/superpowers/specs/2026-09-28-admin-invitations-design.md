# Admin and invitations (sub-project 2b)

Status: design approved in the brainstorming session on 2026-09-28. Second of three backend cycles that
make the system multi-user and invitation-only (roadmap step 2 in
`2026-09-28-frontend-design-direction-design.md`).

- **2a Auth core:** done (JWKS verification, `app_users`, RLS, restricted role).
- **2b Admin and invitations (this spec):** invite, list, resend, revoke, disable, enable, remove;
  invitee terms acceptance; narrowed `app_users` grants.
- **2c Limits and usage:** monthly caps, usage counts, per-user rate limiting, data export and deletion.

## Understanding

One admin (the owner) can invite people by email, see who has access, and control that access. The
admin never sees anyone's holdings, recommendations, or chats: every admin endpoint reads and writes
`app_users` only. Success means: the admin can take a person from "invited" to "active" to "disabled"
or "removed" through the API; a disabled user is locked out immediately; a removed user's data and
Supabase account are gone; and nothing in the application can promote a user to admin.

Constraints carried from `PRODUCT.md`, `CLAUDE.md`, and the 2a spec: the system never places a trade;
private by structure (admin never sees financial data); calm, generic error messages; no secrets in
git; RLS remains the database-level boundary.

## Scope

In scope:

- Admin API under `/admin/users`, all behind `require_admin`.
- The invitee's own endpoints `GET /me` and `POST /me/accept`.
- `app_users.status` gains the value `invited`; new `invited_at` column.
- A small Supabase Auth admin client (invite, ban, unban, delete) injected as a dependency.
- Narrowing the runtime role's write access to `app_users` (deferred security finding L1 from 2a).
- `ARCHITECTURE.md` updates, and the "valid 7 days" copy in the frontend design spec and admin mockup
  corrected to 24 hours.

Out of scope: per-user limits, usage counts, per-user rate limiting, and the user's own data export and
deletion (2c); every frontend screen (roadmap steps 3 to 8); changing a user's role (there is one admin,
created by the bootstrap command); the unauthenticated `/docs` question recorded in `ARCHITECTURE.md` §13.

## Decision: Supabase-native invitations

Invitations use Supabase Auth's invite API rather than our own token table. The link lifetime equals the
project's "Email OTP expiration", default 1 hour, shared with password-reset and other email links.
More than 24 hours is discouraged by Supabase and can only be set through the Management API, so the
project sets it to 24 hours (86400 seconds). The "valid for 7 days" wording in the design mockups was
never a requirement and is corrected. An expired link is handled by Resend, which is routine.

Why not our own tokens: they would allow a 7-day window and atomic consent, but we would own token
storage and hashing, email sending, and passwords passing through our backend, for a user base of a few
people. Supabase keeps the token and password handling. Supabase's built-in mailer is limited to 2
emails per hour and intended for testing, so custom SMTP is required either way (an owner setup step,
not code).

Verified against the Supabase Auth docs: `POST /invite` creates the user or reuses an unconfirmed one
and re-sends the email (so Resend is a second invite call); an already-confirmed address returns `422
email_exists`. `PUT /admin/users/{id}` accepts `ban_duration` (for example `"876000h"`, or `"none"` to
unban). `DELETE /admin/users/{id}` hard-deletes by default and cascades to sessions. A ban blocks
sign-in but does not revoke existing sessions; deleting the user does.

## Design

### Data and lifecycle

`app_users.status` takes `invited | active | disabled`. A new nullable `invited_at` column records when
the current invitation was sent; the admin table derives an "expires in" hint from it and the
configured link lifetime (display only; Supabase enforces the real expiry).

Flow:

1. `POST /admin/users/invite {email}`: the backend asks Supabase to invite the address (secret key,
   redirect to `INVITE_REDIRECT_URL`). Only after Supabase succeeds does it insert
   `app_users(id = the returned Supabase user id, email (trimmed, lowercased), role = "user", status =
   "invited", invited_at = now)`. If that insert fails, the backend deletes the just-created Supabase
   user, so nothing is left half-created.
2. The emailed link signs the invitee in at the frontend accept page, where the frontend has them set a
   password with Supabase's own client (frontend work, later).
3. The frontend calls `POST /me/accept {accept_terms: true}`. That moves `invited` to `active` and sets
   `accepted_terms_at`. It refuses (422) unless `accept_terms` is true.

Dependencies:

- `get_current_user` is unchanged: active users only, so every existing route stays closed to invited
  and disabled users.
- New `get_known_user` admits `invited` and `active`, and refuses `disabled` and unknown users (403). It
  is used by exactly `GET /me` and `POST /me/accept`.
- An invited user who never sets a password can call nothing else.

Disable, enable, and remove:

- **Disable:** ban the Supabase user, then set `status = "disabled"`. The per-request status check
  stops API access immediately, even for an unexpired token; the ban stops new sign-ins.
- **Enable:** unban, then set `status = "active"` (only from `disabled`).
- **Remove:** disable first (cutting access), then delete the user's rows from the eight user-data
  tables through a session scoped to that user (`scoped_session(user_id)`), then delete the Supabase
  user (a "not found" from Supabase counts as success), then delete the `app_users` row. If any step
  after the first fails, the user stays disabled and the whole operation can be retried.
- **Revoke** (invited users only): delete the Supabase user, then the `app_users` row.
- Guards: the admin cannot disable, remove, or revoke themselves, and the last active admin can never be
  disabled or removed.

Removing a user's data is the one admin flow that touches financial tables. It only deletes, through
that user's own RLS scope, and never reads them; no admin endpoint returns any of it.

### Admin API

All routes require an authenticated, active admin (`require_admin`); others get 403.

| Route | Behavior |
|---|---|
| `GET /admin/users?status=` | List users: id, email, role, status, `invited_at`, `accepted_terms_at`, `last_seen_at`, `created_at` |
| `POST /admin/users/invite {email}` | New invite. An already-`invited` address is treated as a resend. `active` or `disabled` returns 409 |
| `POST /admin/users/{id}/resend` | Re-invite (invited users only), refreshes `invited_at` |
| `POST /admin/users/{id}/revoke` | Delete an invited user |
| `POST /admin/users/{id}/disable`, `/enable` | Toggle `active` and `disabled` |
| `DELETE /admin/users/{id}` | Remove permanently; the body `{confirm_email}` must match the user's email (422 otherwise) |
| `GET /me` | The caller's id, email, role, status, `accepted_terms_at` (invited or active) |
| `POST /me/accept {accept_terms}` | Terms acceptance as above |

Errors, calm and generic: 404 for an unknown user id; 409 for an invalid state or a guard (for example
resending an active user, or disabling yourself); 422 for a bad request body; 502 `Could not reach the
authentication service` when Supabase fails (the log holds the exception class only, never a response
body or key); 503 `User management not configured` when `SUPABASE_SECRET_KEY` is unset.

### Supabase client

`backend/app/auth/supabase_admin.py`: a small synchronous `httpx` client (routes are sync `def`), 10
second timeout, methods `invite(email, redirect_to) -> UUID`, `ban(user_id)`, `unban(user_id)`,
`delete(user_id)`. It raises one `SupabaseAdminError` on any non-success or network failure. It is
provided through a FastAPI dependency `get_supabase_admin()` so tests substitute a fake. The exact
request headers for the project's secret key format and the `ban_duration` string are pinned by a
contract test built from the docs and confirmed once against the real project during owner
verification (unit tests cannot prove them).

Configuration (`backend/.env`, never committed): `SUPABASE_SECRET_KEY` (backend only; it is a powerful
key and is never logged or returned), `INVITE_REDIRECT_URL` (a placeholder until the frontend exists; an
unlisted redirect makes Supabase fall back to the Site URL, silently), `INVITE_LINK_HOURS` (default 24,
display only).

### Database permissions (security finding L1)

The runtime role's access to `app_users` narrows to `SELECT`, `INSERT`, `DELETE`, and `UPDATE` on only
`status`, `accepted_terms_at`, `last_seen_at`, and `invited_at`. It cannot change `id`, `email`, or
`role`, so no application bug can promote a user to admin; the role is set only by the bootstrap command
on the owner connection. `app/rls.py` gets a dedicated grant definition for `app_users`, and a new
migration (via the alembic CLI: autogenerate for the column, a manual step for the grants) applies it. A
test asserts the privileges with `has_column_privilege`.

### Testing

A fake Supabase client records calls and can be told to fail. Tests cover:

- Auth: 401 without a token and 403 for a non-admin on every admin route; the existing "every route
  requires authentication" test covers the new routes automatically.
- State transitions and guards: invite, resend, revoke, disable, enable, remove; no self-disable; last
  admin protected; 409 on invalid states; `confirm_email` mismatch.
- Failure ordering: Supabase failure leaves the database unchanged; a database insert failure after a
  successful invite triggers the compensating delete; a failed remove leaves the user disabled and a
  retry completes it.
- Remove deletes only the target user's rows in every user-data table and leaves another user's rows
  intact; it runs under the restricted role.
- `GET /me`: invited and active users get 200, disabled and unknown users 403; `POST /me/accept`
  requires the terms box and only moves `invited` to `active`.
- The privilege test, and the request-shape contract test for the Supabase client.

### Documentation

`docs/ARCHITECTURE.md`: §4 (`invited` status, `invited_at`, narrowed `app_users` grants), §5 (the new
routes), §13 (the invitation flow, the 24-hour link, custom SMTP, the secret key, the redirect URL),
§16. The frontend design spec and `docs/design/mockups/auth-and-admin.html` change "7 days" and "expires
in 5 days" to 24 hours.

## Owner setup (dashboard work, not code)

1. Configure custom SMTP in Supabase (Resend, SendGrid, or SES). The default is 30 new users per hour
   after switching; the built-in mailer is 2 per hour.
2. Set Email OTP expiration to 86400 under Authentication, Email.
3. Add `SUPABASE_SECRET_KEY`, `INVITE_REDIRECT_URL`, and (optionally) `INVITE_LINK_HOURS` to `.env`.
4. Run the new migration against Supabase.
5. End-to-end: invite a real address, click the link, check `GET /me` shows `invited`, accept with the
   invitee's token, list users as admin, disable (confirm login is refused), enable, and remove.

## Definition of done

- Ruff, ruff format, mypy strict, bandit, and pytest pass in `backend/`.
- The admin, `/me`, failure-ordering, isolation-on-remove, and privilege tests pass.
- Manual verification against the Supabase project per the owner checklist.
- No secrets committed; Conventional Commits; `ARCHITECTURE.md` updated.

## Risks

- The Supabase HTTP details (headers for the secret key, the ban string) come from the docs and are
  proven only by the owner's end-to-end run; the client is small and isolated so a fix is one file.
- An unlisted redirect URL or an unconfigured SMTP fails softly (link goes to the Site URL, or Supabase
  returns an error the API reports as 502); both are in the owner checklist.
- The admin can lock themselves out only through the database; the API refuses self-disable and
  last-admin removal.
