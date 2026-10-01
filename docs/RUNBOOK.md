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

All three workflows run only from `master`. The deploy workflow needs a push run on this
repository (it deploys the commit Backend CI just tested) or a manual dispatch from `master`;
the scheduled-jobs and backup workflows refuse to run from any other branch. The repository must
be private: the backup is stored as a workflow artifact. The dump is encrypted with a passphrase
either way, but a private repository means the encrypted file is not downloadable by strangers.

## 2. First deploy, in order

### Supabase

1. Create the project.
2. Authentication, Sign In / Providers: disable public email sign-ups.
3. Authentication, URL Configuration: add the Vercel origin's `<origin>/auth/confirm` and
   `<origin>/reset-password` to Redirect URLs, and set the Invite email template as described in
   ARCHITECTURE section 13 ("Owner setup: invite email template and redirect allow-list"). You
   may need to come back to this step once you know the Vercel URL. Also configure custom SMTP
   (Authentication, Emails, SMTP Settings); the built-in mailer allows 2 emails per hour.
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
   for the owner role (`MIGRATION_DATABASE_URL`).

### Upstash

Create the Redis database with TLS on and copy the `rediss://` URL (this is `REDIS_URL`).

### Fly

1. `fly apps create <app-name>`.
2. Put the same name in the first line of `backend/fly.toml` (`app = "<app-name>"`). The
   workflows read the app name from that line.
3. Set the nine secrets (see the table in section 7 for where each value comes from), from
   `backend/`:
   ```
   fly secrets set DATABASE_URL='<...>' MIGRATION_DATABASE_URL='<...>' REDIS_URL='<...>' \
     ANTHROPIC_API_KEY='<...>' VOYAGE_API_KEY='<...>' SUPABASE_URL='<...>' \
     SUPABASE_SECRET_KEY='<...>' INVITE_REDIRECT_URL='<...>' CORS_ALLOWED_ORIGINS='<...>'
   ```
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
   Setting secrets redeploys the machine.
4. Go back to Supabase URL Configuration and make sure the Vercel origin is allow-listed.

### GitHub

Repository settings, Secrets and variables, Actions: add `FLY_API_TOKEN` (the deploy token),
`BACKUP_DATABASE_URL` and `BACKUP_PASSPHRASE`.

`BACKUP_DATABASE_URL` is a connection string to the Supabase database for a role that has
`BYPASSRLS` or is a superuser. `pg_dump` runs with row security off, so a role without
`BYPASSRLS` makes it fail loudly ("query would be affected by row-level security policy").
Owning the tables is not enough, because `FORCE ROW LEVEL SECURITY` applies to the table owner
too. Supabase's `postgres` role has `BYPASSRLS`. Add `?sslmode=require` to the URL. Choose a long
random `BACKUP_PASSPHRASE` and store it somewhere safe outside GitHub as well: without it the
backups cannot be opened.

## 3. Manual checks to do once

Do these after the first deploy. Items marked (required) cover behavior that could not be
verified without a real Fly app.

- [ ] (required) In the Actions tab, run "Scheduled jobs" by hand. Then open the one-off
      machine's logs in the Fly dashboard (or `fly logs -a <app-name>`) and confirm the summary
      line `users=... failures=0`. The `flyctl machine run` flags in the workflow are unverified
      until this run. If the GitHub run is green while the job itself failed, the workflow does
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
      See section 6 for the commands.
- [ ] Push a trivial change to `backend/` on `master` and confirm "Deploy backend" runs after
      Backend CI and that `fly status -a <app-name>` still shows one machine.
- [ ] In the app, send a chat message and run one analysis in production.

## 4. Spend and abuse limits

- In the Anthropic console, set a monthly spend limit and an email alert before inviting anyone.
  Analysis and chat cost money per call.
- The in-app per-user monthly limits (analysis and chat) already cap each invited user.

## 5. Rolling back a bad deploy

1. List releases: `fly releases -a <app-name>`. Find the previous good one and its image
   (`fly releases -a <app-name> --image` shows image references).
2. Redeploy it: `fly deploy -a <app-name> --image <previous-image> --ha=false`.
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

1. Download the artifact from the workflow run (Actions tab) and unzip it.
2. Decrypt: `gpg --output backup.dump --decrypt trade-agent-<yyyymmdd>.dump.gpg` (enter the
   `BACKUP_PASSPHRASE` when asked).
3. Create an empty target database, then restore:
   `pg_restore --no-owner --no-privileges -d '<new-database-url>' backup.dump`.
4. The dump is made with `--no-owner --no-privileges`, so ownership and grants are not in it. On
   a fresh database or Supabase project you must recreate the roles and the RLS grants before the
   app can use it: run the migrations as in ARCHITECTURE section 13 and `backend/app/rls.py` (the
   role, grants and policies setup), then set the runtime role's password again.
5. Point `DATABASE_URL` (and `MIGRATION_DATABASE_URL`) at the new database with
   `fly secrets set`, keeping `?sslmode=require`.
6. The `pg_dump` client in the workflow is PostgreSQL 17, which works against Supabase servers of
   version 17 or older. If Supabase moves beyond 17 the backup fails loudly, and the client
   version in `backup-db.yml` must be raised. Use a matching `pg_restore` locally.
7. The workflow also fails if the encrypted file is under 1 KB, to catch an empty dump.

## 7. Where each secret lives

Never commit any of these. `.env` is git-ignored; keep it that way.

| Secret | Set in | Where the value comes from | Readable by |
| --- | --- | --- | --- |
| `DATABASE_URL` | Fly secrets | Supabase session-pooler URL, `trading_agent_app` role, plus `?sslmode=require` | Fly app, owner |
| `MIGRATION_DATABASE_URL` | Fly secrets | Supabase owner-role URL, plus `?sslmode=require` | Fly app (release command, job), owner |
| `REDIS_URL` | Fly secrets | Upstash `rediss://` URL | Fly app, owner |
| `ANTHROPIC_API_KEY` | Fly secrets | Anthropic console | Fly app, owner |
| `VOYAGE_API_KEY` | Fly secrets | Voyage AI dashboard | Fly app, owner |
| `SUPABASE_URL` | Fly secrets | Supabase project settings | Fly app, owner |
| `SUPABASE_SECRET_KEY` | Fly secrets | Supabase API keys (bypasses RLS on Supabase's own tables) | Fly app, owner |
| `INVITE_REDIRECT_URL` | Fly secrets | Vercel origin plus the accept-invitation path | Fly app, owner |
| `CORS_ALLOWED_ORIGINS` | Fly secrets | The Vercel origin only | Fly app, owner |
| `APP_ENV` | `backend/fly.toml` (`production`, not secret) | Committed config | Anyone with repo access |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env vars | Fly URL, Supabase project settings (public by design) | Vercel project members, and browsers |
| `FLY_API_TOKEN` | GitHub Actions secret | `fly tokens create deploy -a <app-name>` | Workflows on `master`, repository admins |
| `BACKUP_DATABASE_URL` | GitHub Actions secret | Supabase URL for a `BYPASSRLS` role (see section 2) | Workflows on `master`, repository admins |
| `BACKUP_PASSPHRASE` | GitHub Actions secret, plus your own safe copy | You choose it | Workflows on `master`, repository admins, you |

## 8. Known limits

- No point-in-time recovery on Supabase's free tier. The daily backup is the only recovery path,
  so up to 24 hours of data can be lost.
- CORS allows all methods and headers for the one configured origin. With a single trusted origin
  this does not widen access.
- The scheduled job's failure is visible only in the GitHub run and Fly logs, and whether the
  GitHub run turns red when the job fails is unverified (see the required check in section 3).
- 512 MB may be tight. Watch for out-of-memory restarts in `fly logs -a <app-name>` and raise
  `memory` in `backend/fly.toml` if they appear.
- A deploy token can deploy, but whether it can create one-off machines is unverified (section 3).
- GitHub Actions scheduled workflows can run late, and GitHub disables them after 60 days of
  repository inactivity (it does this for public repositories). Check the Actions tab now and
  then to confirm the daily jobs and backups are still running.
- Single machine: a deploy or a crash means a short outage, and a background analysis running at
  that moment is lost.
