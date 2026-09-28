# Auth core (sub-project 2a)

Status: design approved in the brainstorming session on 2026-09-28. First of three backend cycles
that make the system multi-user and invitation-only (roadmap step 2 in
`2026-09-28-frontend-design-direction-design.md`).

- **2a Auth core (this spec):** JWT verification, `app_users` with roles, replace `default_user_id`,
  real RLS, job ownership.
- **2b Admin and invitations:** invite by email, users API, disable and remove.
- **2c Limits and usage:** monthly caps, usage counts, per-user rate limiting, data export and deletion.

## Understanding

Every request to the backend is made by a verified, known user, and the database itself refuses to
show one user another user's rows. Nothing in the code path uses `default_user_id` any more. Success
means: an unauthenticated call is rejected, a valid token for an unknown or disabled user is rejected,
and one user cannot read, change, or delete another user's rows even if application code forgets a
`user_id` filter.

Constraints carried from `PRODUCT.md` and `CLAUDE.md`: the system never places a trade; the admin
never sees financial data; the backend stays advisory only.

## Scope

In scope:

- Verify Supabase-issued JWTs against the project's JWKS (asymmetric signing keys).
- `app_users` table holding role and status, read on every request.
- Authentication and authorization dependencies applied to every router except `/health`.
- Row Level Security on every user-data table, enforced for the runtime database role.
- First-admin bootstrap command.
- Remove every use of `default_user_id` (config, routers, agents, jobs, memory, tests).
- Owner check on Redis job status.
- `ARCHITECTURE.md` corrections (see "Documentation").

Out of scope (later cycles or never): invitation and admin endpoints (2b); limits, usage, per-user
rate limiting, data export and deletion (2c); any frontend work; the MCP server described in
`ARCHITECTURE.md` §9 (`backend/app/mcp_server.py` does not exist yet, and it will need per-user
authentication designed when it is built).

## Design

### Identity and request path

New package `backend/app/auth/`.

- `jwks.py`: a cached `PyJWKClient` (PyJWT, new dependency) for
  `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`. Verifies signature, expiry, `aud == "authenticated"`,
  and `iss == <SUPABASE_URL>/auth/v1`. Legacy shared-secret (HS256) verification is deliberately not
  supported: Supabase is migrating projects to asymmetric signing keys, and the JWKS endpoint returns
  no keys for projects still on the legacy secret (see Supabase setup below).
- `deps.py`:
  - `get_current_user` reads the bearer token, verifies it, loads `app_users` by the token's `sub`, and
    returns `CurrentUser(id, email, role)`.
  - `require_admin` depends on `get_current_user` and requires `role == "admin"`.
  - A user-scoped database dependency replaces `get_db` for user data. It resolves the current user,
    opens a transaction, runs `select set_config('app.current_user_id', :uid, true)` (transaction
    local), and yields the session. A route cannot obtain a user-data session without an
    authenticated user.
- `models.AppUser`: `id` (UUID, primary key, equal to the Supabase auth uid), `email` (unique),
  `role` ("admin" or "user"), `status` ("active" or "disabled"), `created_at`,
  `accepted_terms_at` (nullable, populated in 2b), `last_seen_at`. It has no `user_id` column and no RLS
  policy; only the auth path and the admin API (2b) touch it, and neither joins it to user-data tables.

Role and status are read from `app_users` on each request, not from JWT claims. `user_metadata` is
user-editable and therefore untrusted, and reading our own table means disabling a user takes effect
immediately rather than at token expiry. Requiring an `app_users` row also enforces invitation-only
access even if Supabase email sign-up is ever left enabled: a self-registered Supabase user gets a valid
token and a 403.

Handlers use `user.id` where they used `settings.default_user_id`. `default_user_id` is removed from
`Settings`.

### Background work and Redis

`run_analysis`, the backtest job, and the chat and context agents receive `user_id` explicitly. Code
that opens its own session (jobs) uses one helper, `scoped_session(user_id)`, which sets the same
transaction-local variable. Redis job hashes gain an `owner` field. Job status for another user's job
returns 404 (not 403), so job ids cannot be probed. Redis rate-limit keys are unchanged in this cycle.

### Bootstrap

`python -m app.auth.bootstrap_admin <email> <supabase-uid>` inserts the first admin using the
migration (owner) connection. It is a CLI command, not an endpoint, so it cannot be reached remotely.
It refuses to run if an admin already exists.

### Row Level Security

One source of truth, `backend/app/rls.py`: `USER_TABLES` and a function returning the SQL for a table.

```sql
ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings FORCE ROW LEVEL SECURITY;
CREATE POLICY holdings_owner ON holdings
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);
```

- Covered tables: `holdings`, `watchlist_items`, `trades`, `recommendations`, `chat_messages`,
  `backtest_results`, `investment_preferences`, `portfolio_snapshots`.
- With the variable unset, `current_setting(..., true)` is NULL, the comparison is false, and the query
  sees zero rows: the default is deny.
- A single Alembic migration applies `rls.py` (policies are manual `op.execute()`; autogenerate cannot
  produce them, as `ARCHITECTURE.md` §4 already notes). Migrations are still only created through the
  alembic CLI.
- The `app.current_user_id` approach is used instead of Supabase's `auth.uid()`: this backend connects
  to Postgres directly rather than through Supabase's API layer, so `auth.uid()` would need a shim
  locally and would couple the code and tests to Supabase internals for no benefit. The variable
  behaves identically on Docker Postgres and Supabase.
- pgvector similarity search works unchanged under RLS.

### Database roles and connection URLs

| Setting | Role | Used by |
|---|---|---|
| `MIGRATION_DATABASE_URL` | table owner (Docker `trading_agent`; Supabase `postgres`) | Alembic, bootstrap |
| `DATABASE_URL` | `trading_agent_app`: `LOGIN`, no `BYPASSRLS`, not the owner, DML grants only | the running API and jobs |

- The migration creates `trading_agent_app` as `NOLOGIN` if it does not exist and grants
  `SELECT, INSERT, UPDATE, DELETE` on the tables plus sequence usage. Login and the password are enabled
  once by hand (below), so no password lands in a migration or in git.
- Supabase: use the session pooler (port 5432) for `DATABASE_URL`. The transaction pooler (port 6543)
  does not support prepared statements, which the ORM relies on, and Supabase advises against it for a
  main data source. The direct connection is IPv6-only unless the IPv4 add-on is bought; Fly.io needs
  IPv4, so the session pooler is the safe default. `set_config(..., true)` is transaction-scoped, so
  it would also work in transaction mode, but that mode is not used.
- A role created with `create role ... login password ...` does not bypass RLS (only roles granted
  `bypassrls` do), which is what makes the dedicated role a real boundary.

### Errors

- `401 Not authenticated`: missing, malformed, expired, or wrong-audience or issuer token. The reason
  is logged, never returned.
- `403 No access to this service`: valid token, but no `app_users` row or a disabled user.
- `404`: another user's job id.
- JWKS fetch failure: `503`, logged. Fetched keys are cached, so a short Supabase outage does not lock
  out users whose signing key is already cached.

Messages are calm and generic, matching the copy rules in the design direction spec.

### Testing

The Docker `trading_agent` user is a superuser, which bypasses RLS even with `FORCE`. So the test setup
must not simply run as it:

- The `engine` fixture creates the schema as the owner (as today), then applies `rls.py`, and creates
  and grants `trading_agent_app`.
- The `client` fixture serves the API on sessions connected as `trading_agent_app`, so every existing API
  test exercises RLS. The `db_session` fixture keeps the owner connection for direct arrange/assert.
- Tests mint real JWTs with a generated keypair and a fixture replaces the JWKS source. This tests the
  actual verification path. There is no auth-bypass flag in production code.
- **Guard test:** introspect `Base.metadata` and fail if any table with a `user_id` column is missing
  from `USER_TABLES`, so a future table cannot ship unprotected.
- **Isolation tests:** for every table, user A cannot select, update, or delete user B's rows; an unset
  variable returns zero rows; inserting a row with another user's `user_id` is rejected by `WITH CHECK`.
- **Auth tests:** no token, malformed, expired, wrong audience, wrong issuer, unknown `sub`, disabled
  user, non-admin on a `require_admin` route, and job ownership.
- The roughly 64 `default_user_id` references in existing tests become a fixture-provided user.

## Supabase setup (done by the project owner, not by code)

1. Disable email sign-ups (Authentication, Sign In / Providers). It is currently enabled.
2. Confirm the project uses asymmetric JWT signing keys and note the project URL. If it still uses the
   legacy secret, migrate through JWT Signing Keys first.
3. After the migration runs, enable login and set a password for `trading_agent_app` in the SQL editor.
4. In `backend/.env`: session-pooler URL as `DATABASE_URL`, owner URL as `MIGRATION_DATABASE_URL`,
   `SUPABASE_URL`. Never commit `.env`.
5. Create your own user (Authentication, Users), copy its uid, and run the bootstrap command.

## Documentation

`ARCHITECTURE.md`, in the same PR as the implementation:

- §4: replace the `auth.uid()` RLS example with the session-variable pattern.
- §5: mark routes as authenticated.
- §11: new env vars (`SUPABASE_URL`, `MIGRATION_DATABASE_URL`); drop `SUPABASE_JWT_SECRET`.
- §13: rewrite from one manually created account to the invitation-only model and JWKS verification.
- §14: remove "No authentication" and the single-user statements; add the GDPR note (with other
  people's data the household exemption no longer applies; privacy notice, export and deletion are
  needed, delivered in 2c).
- §15 item 4 and §16: update status.

## Definition of done

- Ruff, mypy strict, bandit, and pytest pass in `backend/`.
- The guard test and isolation tests pass.
- Manual end-to-end against the Supabase project: a real login yields a token, `GET /portfolio` works
  as the bootstrapped admin, and the same call with a token for a Supabase user that has no
  `app_users` row returns 403.
- No `default_user_id` remains anywhere in `backend/`.
- No secrets, `.env` values, or debug prints committed; Conventional Commits.

## Notes for the next cycles

- **2b, invitation validity:** Supabase's `inviteUserByEmail` links expire after the project's email
  OTP expiry (default 1 hour), not the 7 days shown in the admin mockup. 2b must either accept that
  (and the admin "Resend" flow becomes routine, and the mockup copy changes) or own the invitation
  token itself. Decide in 2b's brainstorm. Supabase's built-in mailer is intended for testing, so a
  custom SMTP provider is needed either way to invite arbitrary addresses.
- **2b, disabled users:** disabling should also ban the Supabase user, so sign-in stops, not only
  API access.
- **2c:** per-user rate limiting replaces the per-IP counters; deletion runs under the user's own
  scoped session, so RLS lets them delete only their own rows (no bypass role needed).

## Risks

One migration turns on RLS for eight tables at once. Mitigation: every API test runs under RLS via the
restricted role, so a wrong policy fails the suite immediately. A second risk is tests passing while
RLS is silently bypassed (superuser); the restricted-role `client` fixture and the isolation tests
exist for exactly that reason.
