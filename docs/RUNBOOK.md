# Deployment runbook

Everything the owner does by hand to put the app into production and keep it healthy. The
automated parts are three GitHub workflows and Vercel's own integration; this file covers the
rest. It uses placeholders such as `<app-name>`; never write real secret values into this file or
commit them anywhere.

## 1. What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| Frontend | Vercel | Git integration, root directory `frontend/`. |
| Backend API | Fly.io, region `fra` | One always-on machine, 512 MB. Config in `backend/fly.toml`. |
| Database and Auth | Supabase | Postgres (with RLS) and Supabase Auth. |
| Cache and locks | Upstash Redis | TLS only (`rediss://`). |
| Deploys, daily job, backups | GitHub Actions | `deploy-backend.yml`, `scheduled-jobs.yml`, `backup-db.yml`. |

All three workflows are meant to run only from `master`. What enforces this is the GitHub
Environment `production` (master only, holding the secrets; see section 2, GitHub). The `if:`
lines in the workflows are defence in depth. The deploy workflow needs a push run on this
repository (it deploys the commit Backend CI just tested) or a manual dispatch from `master`, and
skips itself if a newer commit is already on master. The repository must
be private: the backup is stored as a workflow artifact. The dump is encrypted with a passphrase
either way, but a private repository means the encrypted file is not downloadable by strangers.

## 2. First deploy, in order

### Supabase

1. Create the project.
2. Authentication, Sign In / Providers: disable public email sign-ups.
3. Authentication, URL Configuration: add the Vercel origin's `<origin>/auth/confirm` and
   `<origin>/reset-password` to Redirect URLs, set the Site URL to the Vercel origin (the invite
   template builds its link from `{{ .SiteURL }}`; with the default Site URL, invitation emails
   point to the wrong host), and set the Invite email template as described in
   ARCHITECTURE section 13 ("Owner setup: invite email template and redirect allow-list"). The
   Vercel URL does not exist yet on a first deploy: after the Vercel deploy, come back and set
   the Site URL and the Redirect URLs. Also configure custom SMTP
   (Authentication, Emails, SMTP Settings); the built-in mailer allows 2 emails per hour
   (UNVERIFIED: from Supabase's docs, not checked here).
4. Run the migrations once from your machine, with `MIGRATION_DATABASE_URL` (the owner role) in
   your environment, from `backend/`: `alembic upgrade head`.
5. In the SQL editor, give the runtime role a password (the migration creates it with no login):
   `ALTER ROLE trading_agent_app WITH LOGIN PASSWORD '<new-password>';`. See ARCHITECTURE
   section 13.
6. Verify the runtime role does not bypass RLS (the "Deploy check" in ARCHITECTURE section 13):
   connect with the `DATABASE_URL` you are about to use and confirm `rolsuper` and
   `rolbypassrls` are both `false`.
7. Create your user in the Supabase dashboard (Authentication, Users), note its uid, then create
   the first admin from `backend/`:
   `python -m app.auth.bootstrap_admin <email> <supabase-uid>`.
8. Note the connection strings: the session-pooler URL for the runtime role (`DATABASE_URL`) and
   for the owner role (`MIGRATION_DATABASE_URL`). UNVERIFIED: Supabase's session pooler
   connection string usually uses the username form `<role>.<project-ref>`; copy the string from
   the Supabase dashboard (Connect) rather than composing it.
9. After every deploy that ships a migration, verify Supabase's public API roles have no access
   to the app's tables. In the SQL editor this must return **zero rows**:

   ```sql
   SELECT grantee, privilege_type FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated');
   ```

   Supabase serves public tables to `anon`/`authenticated` through PostgREST (`/rest/v1`) with
   the public anon key, and `app_users` has no RLS, so any row here is a hole. Migrations run on
   deploy through the Fly release command, so the revoke migration is applied automatically; this
   query only confirms it. You can also turn the Supabase Data API off for the project (Project
   Settings, Data API), because the app only uses the database directly and the Auth API
   (UNVERIFIED: menu names, not checked here).
10. After the same migration, confirm the runtime role can still call pgvector's functions (the
    revoke also touches functions in `public`). This must return `true`:

    ```sql
    SELECT has_function_privilege('trading_agent_app', 'vector_in(cstring,oid,integer)', 'EXECUTE');
    ```

    Then ask a question in Chat or run an analysis, which exercises a memory/embedding query. If
    the check returns `false` or those fail with "permission denied for function", run
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO trading_agent_app;` (UNVERIFIED that this
    is ever needed: Supabase usually installs pgvector in the `extensions` schema, and `PUBLIC`
    keeps execute on functions by default).

### Email (Resend) and the invite templates

Supabase's built-in mailer is limited to about 2 emails per hour, so invitations need custom SMTP
(Authentication, Emails, SMTP Settings). Invitation emails land in spam unless the sender is
authenticated, so:

1. In Resend, add your own domain (Domains) and create the DNS records it shows at your registrar
   (SPF and DKIM). Wait until the domain shows as verified. Do not send from a `@gmail.com`
   address: it fails DMARC alignment and goes to spam.
2. Add a DMARC record at the registrar, for example a TXT record on `_dmarc.<your-domain>` with
   `v=DMARC1; p=none; rua=mailto:<your-address>`. Move to `p=quarantine` once reports look clean.
3. In Supabase SMTP Settings use a from address on that domain (for example
   `invites@<your-domain>`), sender name `trade-agent`, host `smtp.resend.com`, username `resend`,
   and a Resend API key as the password (UNVERIFIED: check Resend's SMTP page for the current host,
   port and username).
4. Paste the HTML in [email-templates/invite.html](email-templates/invite.html) into
   Authentication, Emails, Templates, Invite user, with the subject "You're invited to
   trade-agent". Paste [email-templates/reset-password.html](email-templates/reset-password.html)
   into Reset password with the subject "Reset your trade-agent password". Both build their link
   from `{{ .SiteURL }}`, so the Site URL must be the Vercel origin (see Supabase step 3).
5. Send a test invitation to the address shown on mail-tester.com and fix what it flags. Open the
   test invite in Gmail and check "Show original": SPF, DKIM and DMARC should all say PASS.

### Upstash

Create the Redis database with TLS on and copy the `rediss://` URL (this is `REDIS_URL`).

### Per-user Claude keys

#### Create the secret (once, before the first deploy of this feature)

Generate it with `openssl rand -base64 32` and set it as a Fly secret in the dashboard (or
`fly secrets import` from a file kept outside the repo). Keep a copy in your password manager.
With `APP_ENV=production` the web process refuses to start without a valid secret.

#### If the secret is lost or changed

Saved keys can no longer be decrypted. Nothing breaks loudly: the first use of a saved key flags it, and each
user sees "Your Claude key needs attention" with a Reconnect button, then saves their key again. Restoring the old value brings the saved keys back.

#### Rotation

`user_api_keys.key_version` records which secret encrypted a row. Rotation (re-encrypting every row with a
new secret) is not built yet; if needed, it is a small one-off script.

#### Checks after the first deploy

1. As an invited test user: Chat and Run analysis answer with "Connect Claude to use this."; save a key
   (Account); both work.
2. In the Supabase SQL editor: `SELECT user_id, last4, status FROM user_api_keys;` shows rows, and
   `SELECT convert_from(ciphertext, 'LATIN1') FROM user_api_keys LIMIT 1;` shows unreadable bytes, never
   `sk-ant-`.
3. Remove the key in Account: the row disappears and Chat is locked again.

### Fly

1. `fly apps create <app-name>`.
2. Put the same name in the `app = ` line near the top of `backend/fly.toml`
   (`app = "<app-name>"`). The workflows read the app name from that line.
3. Set the ten secrets (see the table in section 7 for where each value comes from). Avoid typing
   values on the command line, where they land in shell history. Write them as `NAME=value` lines
   in a file kept outside the repository (for example `secrets.env`), from `backend/` run
   `fly secrets import < secrets.env` (UNVERIFIED: check `fly secrets import --help`), then delete
   the file. If you typed any secret inline, clear your shell history. The ten names are
   `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`,
   `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `INVITE_REDIRECT_URL`, `CORS_ALLOWED_ORIGINS` and `KEY_ENCRYPTION_SECRET`.
   The app accepts Supabase's `postgresql://` string for `DATABASE_URL` and
   `MIGRATION_DATABASE_URL` (it rewrites it to `postgresql+psycopg://`); add `?sslmode=require`.
   `INVITE_REDIRECT_URL` and `CORS_ALLOWED_ORIGINS` are not known yet; put a temporary value now
   and correct them in the Vercel step.
4. **Production TLS guard.** `fly.toml` sets `APP_ENV=production`. In that mode the app, the
   release command (`alembic upgrade head`) and the scheduled job all refuse to start unless
   `DATABASE_URL` and `MIGRATION_DATABASE_URL` both carry `sslmode=require` (or `verify-ca` or
   `verify-full`) and `REDIS_URL` starts with `rediss://`. Any other `APP_ENV` value is also
   rejected. So end both Postgres URLs with `?sslmode=require` (or add `&sslmode=require` if the
   URL already has a query string). The error names the setting that is wrong but never prints
   the URL.
5. First deploy, from `backend/`: `fly deploy --ha=false`. Use `--ha=false` exactly as the deploy
   workflow does; without it Fly creates two machines, which would run background tasks twice
   and cost more. Then confirm there is exactly one machine: `fly status -a <app-name>` (and
   `fly scale count 1 -a <app-name>` if it shows more).
6. Confirm `https://<app-name>.fly.dev/health` answers.
7. Create the deploy token: `fly tokens create deploy -a <app-name>`. Keep it for the GitHub step.

### Vercel

1. Import the repository; root directory `frontend/`.
2. Set `NEXT_PUBLIC_API_URL` (`https://<app-name>.fly.dev`), `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Deploy.
3. On Fly, set `CORS_ALLOWED_ORIGINS` to the Vercel origin only and `INVITE_REDIRECT_URL` to the
   frontend's accept-invitation page on that origin:
   `fly secrets set CORS_ALLOWED_ORIGINS='<vercel-origin>' INVITE_REDIRECT_URL='<vercel-origin>/accept-invitation' -a <app-name>`.
   Setting secrets redeploys the machine (UNVERIFIED: flyctl behaviour; confirm with
   `fly status -a <app-name>`).
4. Go back to Supabase URL Configuration and make sure the Vercel origin is allow-listed.

### GitHub

1. Repository Settings, Environments: create an Environment named `production`. Set
   "Deployment branches and tags" to "Selected branches and tags" and allow `master` only.
   Optionally add a required reviewer, which suits the backup and scheduled workflows.
2. In that Environment, add `FLY_API_TOKEN` (the deploy token), `BACKUP_DATABASE_URL` and
   `BACKUP_PASSPHRASE` as **Environment secrets**, not repository secrets. All three workflows
   declare `environment: production`, so GitHub enforces the branch rule and releases the secrets
   only to runs on `master`. The `if:` lines in the workflows are defence in depth.

`BACKUP_DATABASE_URL` must stay a plain `postgresql://` URL (for `pg_dump`/libpq), never
`postgresql+psycopg://`. Add `?sslmode=require`. `pg_dump` runs with row security off, so the role
must have `BYPASSRLS` (or be a superuser), because `FORCE ROW LEVEL SECURITY` applies to the table
owner too. Instead of the powerful `postgres` role, create a dedicated read-only role once, as
`postgres` in the Supabase SQL editor:

```sql
CREATE ROLE backup_reader LOGIN BYPASSRLS PASSWORD '<generate-a-long-password>';
ALTER ROLE backup_reader SET default_transaction_read_only = on;
GRANT USAGE ON SCHEMA public TO backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backup_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO backup_reader;
```

UNVERIFIED: whether Supabase lets `postgres` grant `BYPASSRLS` to a new role. If not, fall back to
the `postgres` role in `BACKUP_DATABASE_URL`; the secret is then very powerful, so protect it
accordingly. UNVERIFIED: if the dump fails with "permission denied for schema extensions"
(pgvector's type lives there), run `GRANT USAGE ON SCHEMA extensions TO backup_reader;`. A future
table without a grant makes the backup fail loudly, which is what you want. Also turn on
Supabase's "Enforce SSL on incoming connections".

Choose a long random `BACKUP_PASSPHRASE` and store it somewhere safe outside GitHub as well:
without it the backups cannot be opened.

## 3. Manual checks to do once

Do these after the first deploy. Items marked (required) cover behavior that could not be
verified without a real Fly app.

- [ ] (required) In the Actions tab, run "Scheduled jobs" by hand (the workflow passes
      `APP_ENV=production` to the one-off machine with `--env`, because `machine run` does not apply
      `fly.toml`). Then open the one-off
      machine's logs in the Fly dashboard (or `fly logs -a <app-name>`) and confirm the summary
      line `users=... failures=0`. The `flyctl machine run` flags in the workflow are unverified
      until this run. A failed job may still not turn the GitHub run red (UNVERIFIED), so keep
      checking the logs. If the GitHub run is green while the job itself failed, the workflow does
      not surface job failures: switch to the `flyctl ssh console` fallback written in the
      comments of `scheduled-jobs.yml`.
- [ ] (required) Confirm the deploy token is allowed to create the one-off machine. If the
      Scheduled jobs run fails with a permission error, a deploy token is not enough for
      `flyctl machine run`; use an org-scoped or app-scoped token with machine permissions for
      `FLY_API_TOKEN` instead.
- [ ] Run "Backup database" by hand. Download the `db-backup` artifact, decrypt it, restore it
      into a scratch database and check that a user table has rows (for example
      `SELECT count(*) FROM holdings;` after you have added data). This proves the backup role
      bypasses RLS: if it did not, the backup would have failed or the tables would be empty.
      Then connect to the restored database as `trading_agent_app` and read a row: run
      `SELECT set_config('app.current_user_id', '<an existing user uuid>', false);` and select from
      a user table, or read `app_users`. A missing grant shows up here. See section 6 for the
      commands.
- [ ] In the Actions tab, confirm the scheduled workflows are enabled (GitHub disables them after
      60 days of inactivity only in public repositories; a private repository should not be
      affected, but double-check this GitHub behaviour).
- [ ] Push a trivial change to `backend/` on `master` and confirm "Deploy backend" runs after
      Backend CI and that `fly status -a <app-name>` still shows one machine.
- [ ] In the app, send a chat message and run one analysis in production.

## 4. Spend and abuse limits

- In the Anthropic console, set a monthly spend limit and an email alert before inviting anyone.
  Analysis and chat cost money per call.
- The in-app per-user monthly limits (analysis and chat) already cap each invited user.

## 5. Rolling back a bad deploy

1. List releases: `fly releases -a <app-name>`. Find the previous good one and its image
   (`fly releases -a <app-name> --image` shows image references; UNVERIFIED: the `--image` flag
   on `fly releases`, check `fly releases --help`).
2. Redeploy it: `fly deploy -a <app-name> --image <previous-image> --ha=false`. This also runs the
   release command (`alembic upgrade head`). If the bad release included a migration, the OLD
   image's Alembic does not know the newer revision and the release fails ("Can't locate
   revision"). Such a rollback must instead update the machine image directly:
   `fly machine update <machine-id> --image <previous-image> -a <app-name>` (UNVERIFIED: check
   `fly machine update --help`), or restore from backup (section 6) and roll forward.
3. A migration is **not** rolled back automatically. The release command runs
   `alembic upgrade head` before a new version starts, and a failed migration fails the release
   so the old version keeps serving. But a migration that succeeded stays applied even if you
   redeploy older code. If a migration was destructive or wrong, restore the database from the
   most recent backup (section 6) into a new database and point `DATABASE_URL` at it; data
   written since that backup is lost. For a non-destructive migration, write a new migration
   that reverses it rather than editing the old one.

## 6. Restoring a backup

The backup workflow writes `trade-agent-<yyyymmdd>.dump.gpg` as an artifact named `db-backup`,
kept for 30 days.

The dump contains the `public` schema only (`--schema=public`), made with `--no-owner
--no-privileges`. It includes the tables, data, `ENABLE`/`FORCE ROW LEVEL SECURITY`, the policies and
the `alembic_version` row at head. It has no roles and no GRANTs.

1. Download the artifact from the workflow run (Actions tab) and unzip it.
2. Decrypt: `gpg --output backup.dump --decrypt trade-agent-<yyyymmdd>.dump.gpg` (enter the
   `BACKUP_PASSPHRASE` when asked).
3. Create the target: an empty database or a new Supabase project. Connect as its owner and run
   `CREATE EXTENSION IF NOT EXISTS vector;`.
4. Restore: `pg_restore --no-owner -d '<target-url>' backup.dump`. Do **not** re-run the Alembic
   migrations or the RLS policy SQL afterwards: the schema, policies and the `alembic_version`
   row are already restored, so they would fail or do nothing.
5. Create the runtime role and its grants (the dump has none). From `backend/`, this prints the
   SQL from `app/rls.py` without the policies:
   ```
   uv run python -c "from app import rls; print(rls.create_role_sql()); print(rls.grant_schema_sql() + ';'); [print(s + ';') for t in rls.RUNTIME_TABLES for s in rls.grant_table_sql(t)]"
   ```
   Run that output against the target as the owner. Then set the login:
   `ALTER ROLE trading_agent_app WITH LOGIN PASSWORD '<password>';`.
6. Point `DATABASE_URL` (the `trading_agent_app` role) and `MIGRATION_DATABASE_URL` (the owner) at
   the new database with `fly secrets set`, keeping `?sslmode=require`.
7. The `pg_dump` client in the workflow is PostgreSQL 17, which works against Supabase servers of
   version 17 or older. If Supabase moves beyond 17 the backup fails loudly, and the client
   version in `backup-db.yml` must be raised. Use a matching `pg_restore` locally.
8. The workflow fails if the encrypted file is under 1 KB. That only catches a truly empty or
   broken file; a real backup is much larger. The restore drill in section 3 is the real check.

## 7. Where each secret lives

Never commit any of these. `.env` is git-ignored; keep it that way.

| Secret | Set in | Where the value comes from | Readable by |
| --- | --- | --- | --- |
| `DATABASE_URL` | Fly secrets | Supabase session-pooler URL (`postgresql://` is fine, the app rewrites it), `trading_agent_app` role, plus `?sslmode=require` | Fly app, owner |
| `MIGRATION_DATABASE_URL` | Fly secrets | Supabase owner-role URL, plus `?sslmode=require` | Fly app (release command, job), owner |
| `REDIS_URL` | Fly secrets | Upstash `rediss://` URL | Fly app, owner |
| `ANTHROPIC_API_KEY` | Fly secrets | Anthropic console | Fly app, owner |
| `VOYAGE_API_KEY` | Fly secrets | Voyage AI dashboard | Fly app, owner |
| `SUPABASE_URL` | Fly secrets | Supabase project settings | Fly app, owner |
| `SUPABASE_SECRET_KEY` | Fly secrets | Supabase API keys (bypasses RLS on Supabase's own tables) | Fly app, owner |
| `INVITE_REDIRECT_URL` | Fly secrets | Vercel origin plus the accept-invitation path | Fly app, owner |
| `CORS_ALLOWED_ORIGINS` | Fly secrets | The Vercel origin only | Fly app, owner |
| `KEY_ENCRYPTION_SECRET` | Fly secrets | Base64 of 32 random bytes; keep a copy in your password manager | Fly app, owner |
| `APP_ENV` | `backend/fly.toml` (`production`, not secret) | Committed config | Anyone with repo access |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env vars | Fly URL, Supabase project settings (public by design) | Vercel project members, and browsers |
| `FLY_API_TOKEN` | GitHub Environment secret (`production`) | `fly tokens create deploy -a <app-name>` | Workflows running on `master` (Environment rule), repository admins |
| `BACKUP_DATABASE_URL` | GitHub Environment secret (`production`) | Plain `postgresql://` URL for the `backup_reader` role (see section 2) | Workflows running on `master` (Environment rule), repository admins |
| `BACKUP_PASSPHRASE` | GitHub Environment secret (`production`), plus your own safe copy | You choose it | Workflows running on `master` (Environment rule), repository admins, you |

## 8. Known limits

- No point-in-time recovery on Supabase's free tier (UNVERIFIED: check your plan in the Supabase
  dashboard). The daily backup is the only recovery path,
  so up to 24 hours of data can be lost.
- CORS allows all methods and headers for the one configured origin. With a single trusted origin
  this does not widen access.
- The scheduled job's failure is visible only in the GitHub run and Fly logs, and whether the
  GitHub run turns red when the job fails is unverified (see the required check in section 3).
- 512 MB may be tight. Watch for out-of-memory restarts in `fly logs -a <app-name>` and raise
  `memory` in `backend/fly.toml` if they appear.
- A deploy token can deploy, but whether it can create one-off machines is unverified (section 3).
- GitHub Actions scheduled workflows can run late. GitHub disables them after 60 days of
  repository inactivity only in public repositories; this repository must be private, so it
  should not be affected (GitHub behaviour: double-check in the Actions tab). Check the Actions
  tab now and then to confirm the daily jobs and backups are still running.
- Single machine: a deploy or a crash means a short outage, and a background analysis running at
  that moment is lost.
- `sslmode=require` and `rediss://` encrypt the connection but do not verify the server
  certificate. `sslmode=verify-full` with the provider's CA certificate would also check it
  (optional hardening).
- GnuPG versions differ. Decrypt the first backup with the same `gpg` you would use in an
  emergency. If an older `gpg` cannot decrypt it, add `--rfc4880` to the `gpg` command in
  `backup-db.yml` (UNVERIFIED).
