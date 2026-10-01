# Deployment — design

## Goal

Run the app for its owner and a few invited people, cheaply and safely, with deploys that need no
manual steps after the first setup, a trigger for the daily scheduled job, encrypted connections,
and a database backup. Nothing here changes what the system does: it still never places a trade.

## Decisions (agreed in brainstorming)

| Question | Decision |
| --- | --- |
| Hosting | Keep the plan in ARCHITECTURE §13: Vercel (frontend), Fly.io `fra` (backend), Supabase (Postgres and Auth), Upstash (Redis). |
| Scheduler | A GitHub Actions cron runs the daily job in a one-off Fly machine. |
| Deploys | Automatic on every merge to master; migrations run as a Fly release command. |
| Hardening in scope | Fly health checks and secure (TLS) connections; automated database backups. Others are documented manual steps in a runbook. |
| Environments | One production environment on the default `*.vercel.app` and `*.fly.dev` hostnames. No staging, no custom domain yet. |

Out of scope: Sentry or other error reporting, a staging environment, a custom domain, autoscaling.

## What exists today

- A local `backend/docker-compose.yml` (Postgres with pgvector, Redis). No `Dockerfile`, no
  `fly.toml`, no deploy workflow. `backend-ci.yml` and `frontend-ci.yml` only run checks.
- Settings come from environment variables (`backend/app/config.py`): `DATABASE_URL`,
  `MIGRATION_DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `SUPABASE_URL`,
  `SUPABASE_SECRET_KEY`, `INVITE_REDIRECT_URL`, `CORS_ALLOWED_ORIGINS`, plus limits.
- `python -m app.scheduled daily|snapshots|outcomes` is a one-shot command with a Redis lock.
- `GET /health` exists.
- The frontend needs `NEXT_PUBLIC_API_URL` and the two public Supabase variables.

## Backend container and Fly app

- `backend/Dockerfile`: Python 3.12 slim, dependencies installed with `uv sync --locked --no-dev`,
  a non-root user, `uvicorn app.main:app --host 0.0.0.0 --port 8080`. A `.dockerignore` excludes
  tests, `.env`, the local SQLite file and caches.
- `backend/fly.toml`: app name, region `fra`, internal port 8080, HTTPS forced.
  - One machine, always on (`min_machines_running = 1`, no auto-stop), 512 MB. Always on matters
    because analysis and backtest runs are background tasks inside the API process; auto-stop could
    stop an idle-looking machine mid-run.
  - `[deploy] release_command = "alembic upgrade head"` using `MIGRATION_DATABASE_URL`: a failed
    migration fails the release, and the previous version keeps serving.
  - An HTTP health check on `/health`; Fly restarts a machine that stops answering.
- Secrets are set once with `fly secrets set` (never committed): `DATABASE_URL` (Supabase pooler,
  `trading_agent_app` role), `MIGRATION_DATABASE_URL` (owner role), `REDIS_URL` (Upstash, `rediss://`),
  `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
  `INVITE_REDIRECT_URL`, `CORS_ALLOWED_ORIGINS` (the Vercel origin only), `APP_ENV=production`.

## Secure connections

- New setting `app_env` (`APP_ENV`, default `development`). A startup check in `app/config.py` (or a
  small function called from `app/main.py`): when `app_env == "production"`, refuse to start unless
  `DATABASE_URL` requires TLS (`sslmode=require`, `verify-ca` or `verify-full`) and `REDIS_URL` uses
  `rediss://`. The error names which setting is wrong and never prints a URL (they hold passwords).
  The scheduled job and Alembic use the same settings, so they are covered too.
- CORS stays as is in code; production sets `CORS_ALLOWED_ORIGINS` to the Vercel origin only.
  (Allowing all methods and headers is left as is: with a single trusted origin it does not widen
  access; noted in the runbook.)

## Deploys

- `.github/workflows/deploy-backend.yml`: runs on push to master when `backend/**` or the workflow
  changes, and on manual dispatch. It runs only after the backend checks succeeded for that commit
  (the existing Backend CI workflow, via `workflow_run`, or the same checks as a `needs` job), then
  `flyctl deploy --remote-only` in `backend/`. Secret: `FLY_API_TOKEN` (a deploy token).
- Frontend: Vercel's GitHub integration (root directory `frontend/`), with `NEXT_PUBLIC_API_URL`
  (the Fly URL), `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. No workflow.
- CI also builds the Docker image on pull requests that touch `backend/`, starts it with test
  settings, and checks that `/health` answers, so a broken Dockerfile is caught before master.

## Scheduled job

- `.github/workflows/scheduled-jobs.yml`: a daily UTC cron (early morning, after US close data is
  settled) plus a manual "run now". It runs `python -m app.scheduled daily` in a one-off Fly machine
  that uses the app's current image, region and secrets, and is removed when the command finishes.
  The existing Redis lock and per-user idempotency make a repeated or overlapping run harmless.
- The workflow fails (and GitHub emails the owner) when the command exits non-zero.
- Implementation must confirm the exact `flyctl machine run` flags and that the deploy token is
  enough to create a one-off machine; if it is not, the token scope is documented in the runbook.

## Database backup

- `.github/workflows/backup-db.yml`: a daily cron plus manual run. It runs `pg_dump` (custom format,
  a client version matching the Supabase server) against a read-only connection string in the
  secret `BACKUP_DATABASE_URL`, encrypts the file with a symmetric passphrase from the secret
  `BACKUP_PASSPHRASE` (for example `gpg --symmetric --cipher-algo AES256`), and uploads it as a
  private workflow artifact kept 30 days. The dump is never written to the log.
- Restore steps (decrypt, `pg_restore` into a new database, point the app at it) are in the runbook,
  and the restore is tried once by hand before relying on it.
- Supabase's free tier has no point-in-time recovery, so this is the only recovery path; the
  runbook says so.

## Runbook (`docs/RUNBOOK.md`)

Things only the owner can do in dashboards, with the order for a first deploy:

1. Supabase: create the project, disable public sign-ups, add the Vercel URL to the redirect
   allow-list, set the invite email template (already in ARCHITECTURE §13), run the RLS and runtime
   role setup, create the first admin with `bootstrap_admin`.
2. Upstash: create the Redis database, copy the `rediss://` URL.
3. Fly: `fly apps create`, set secrets, first `fly deploy`; create the deploy token for GitHub.
4. Vercel: import the repo with root `frontend/`, set the three variables, deploy; then set
   `CORS_ALLOWED_ORIGINS` and `INVITE_REDIRECT_URL` on Fly to the Vercel origin.
5. GitHub: add `FLY_API_TOKEN`, `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`; run the backup and
   scheduled-job workflows once by hand.
6. Anthropic console: set a monthly spend limit and an alert (the admin pays per use).
7. Rolling back a bad deploy (`fly releases`, redeploy a previous image), restoring a backup, and
   where each secret lives.

## Documentation

ARCHITECTURE §13 is updated to match (always-on machine, release command, deploy and job workflows,
the production TLS guard, backups), and the production checklist items this closes are ticked:
scheduled-jobs trigger, TLS to Postgres and Redis, pooler, CORS origin, backup plan. README's status
line points at the runbook.

## Testing

- Unit tests for the production guard: development accepts anything; production rejects a non-TLS
  Postgres URL, a `redis://` URL and an unset value, accepts the secure forms, and the error text
  contains no URL.
- CI: Docker build and a `/health` smoke test on pull requests touching `backend/`.
- Workflows are checked with `actionlint` (added as a CI step) so a YAML mistake fails before merge.
- Manual, recorded in the runbook: first deploy, one scheduled-job run, one backup and restore.

## Open points to confirm during implementation

- The exact `flyctl` invocation for a one-off machine and the minimum token scope.
- The Postgres client version to install in the backup job (match Supabase's server version).
- Whether Supabase's pooler connection works with `sslmode=require` and the app's `psycopg`
  settings (prepared statements are off in transaction pooling; the session pooler is expected).
