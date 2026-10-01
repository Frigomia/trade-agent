# Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app deployable: a backend container and Fly app, a production TLS guard, automatic deploys, a daily scheduled-job workflow, an automated encrypted database backup, and a runbook for the steps only the owner can do.

**Architecture:** Backend runs as a Docker image on one always-on Fly machine; migrations run as a Fly release command; GitHub Actions deploys on merge, runs the daily job in a one-off Fly machine, and takes a daily encrypted `pg_dump`. The frontend deploys through Vercel's own GitHub integration. A new `APP_ENV` setting makes the backend refuse to start in production without TLS to Postgres and Redis.

**Tech Stack:** Docker, Fly.io (`flyctl`), GitHub Actions, `uv`, FastAPI/Alembic, pydantic-settings, pytest.

**Spec:** `docs/superpowers/specs/2026-10-02-deployment-design.md`

## Global Constraints

- This system never places a trade. Nothing here changes behaviour, only how it is run.
- Never commit secrets, `.env` values, tokens, connection strings or the backup passphrase. Workflows read them only from GitHub secrets. Names used: `FLY_API_TOKEN`, `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`.
- Production secrets set on Fly: `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `INVITE_REDIRECT_URL`, `CORS_ALLOWED_ORIGINS`. `APP_ENV=production` is a non-secret `[env]` value in `fly.toml`.
- One production environment on default hostnames; no staging, no custom domain, no Sentry.
- The Fly machine is always on (`min_machines_running = 1`, no auto-stop) with 512 MB, region `fra`, because analysis and backtest runs are background tasks inside the API process.
- The backup connection must be a role that bypasses row-level security (`BYPASSRLS` or a superuser; Supabase's `postgres` role has `BYPASSRLS`; owning the tables is not enough because FORCE RLS applies to the owner too), never the `trading_agent_app` role: RLS is forced on the user tables, so a non-bypassing role makes `pg_dump` (which runs with row_security=off) fail loudly.
- Backend: `cd backend && uv run ruff check . && uv run ruff format . && uv run mypy app && uv run python -m pytest tests -q` must pass. Never edit existing files in `backend/migrations/versions/`.
- Workflow files must parse as YAML (`python -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" FILE`) and use `actions/checkout@v7`, matching the existing workflows.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never skip hooks or signing.
- Files in this repo use CRLF in the working tree; use the Edit/Write tools and do not run whole-file formatters on files you did not change.
- Nothing in this plan can be run against real Fly, Supabase or Upstash accounts. Where a step depends on one, the plan says so and the runbook (Task 5) lists it as a manual check.

## Review Focus

- The production guard never prints a connection string (they contain passwords), including through pydantic's own error text.
- `fly.toml` and the workflows contain no secret values and no real account names beyond the placeholder app name.
- The backup cannot silently produce an empty dump (RLS) and never logs the dump or the passphrase.
- A repeated or overlapping scheduled job is harmless (lock + idempotency, already in `app/scheduled.py`); the workflow does not retry on its own.
- The deploy workflow cannot run for a pull request or a branch other than master.
- The Docker image runs as a non-root user and contains no `.env`, tests or local database file.

---

### Task 1: Production TLS guard

**Files:**
- Modify: `backend/app/config.py`, `backend/.env.example`
- Create: `backend/tests/test_config.py`

**Interfaces:**
- Produces: `Settings.app_env: str = "development"`. When `app_env == "production"`, constructing `Settings` raises `InsecureConfigError` (a `RuntimeError` subclass defined in `config.py`) unless `database_url` (and `migration_database_url` when set) have `sslmode=require|verify-ca|verify-full` in the query string and `redis_url` starts with `rediss://`. The message names the offending settings only.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_config.py`:

```python
import pytest

from app.config import InsecureConfigError, Settings

SECURE_DB = "postgresql+psycopg://u:secretpw@db.example.com:5432/app?sslmode=require"
SECURE_REDIS = "rediss://default:redispw@redis.example.com:6379"


def _settings(**overrides):
    # _env_file=None keeps a developer's local .env out of the test.
    return Settings(_env_file=None, **overrides)


def test_development_accepts_plain_local_urls():
    settings = _settings(
        app_env="development",
        database_url="postgresql+psycopg://u:p@localhost:5432/app",
        redis_url="redis://localhost:6379/0",
    )
    assert settings.app_env == "development"


def test_production_accepts_tls_urls():
    settings = _settings(
        app_env="production",
        database_url=SECURE_DB,
        migration_database_url=SECURE_DB.replace("secretpw", "ownerpw"),
        redis_url=SECURE_REDIS,
    )
    assert settings.app_env == "production"


@pytest.mark.parametrize("mode", ["require", "verify-ca", "verify-full"])
def test_production_accepts_every_strict_sslmode(mode):
    _settings(
        app_env="production",
        database_url=f"postgresql+psycopg://u:p@h/app?sslmode={mode}",
        redis_url=SECURE_REDIS,
    )


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql+psycopg://u:secretpw@h/app",
        "postgresql+psycopg://u:secretpw@h/app?sslmode=disable",
        "postgresql+psycopg://u:secretpw@h/app?sslmode=prefer",
    ],
)
def test_production_rejects_a_database_url_without_tls(database_url):
    with pytest.raises(InsecureConfigError, match="DATABASE_URL"):
        _settings(app_env="production", database_url=database_url, redis_url=SECURE_REDIS)


def test_production_rejects_an_insecure_migration_url():
    with pytest.raises(InsecureConfigError, match="MIGRATION_DATABASE_URL"):
        _settings(
            app_env="production",
            database_url=SECURE_DB,
            migration_database_url="postgresql+psycopg://owner:ownerpw@h/app",
            redis_url=SECURE_REDIS,
        )


def test_production_rejects_a_plain_redis_url():
    with pytest.raises(InsecureConfigError, match="REDIS_URL"):
        _settings(app_env="production", database_url=SECURE_DB, redis_url="redis://r:redispw@h:6379")


def test_the_error_never_contains_a_url_or_password():
    with pytest.raises(InsecureConfigError) as caught:
        _settings(
            app_env="production",
            database_url="postgresql+psycopg://u:secretpw@h/app",
            redis_url="redis://default:redispw@h:6379",
        )

    text = str(caught.value)
    assert "secretpw" not in text and "redispw" not in text
    assert "postgresql" not in text and "redis://" not in text
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run python -m pytest tests/test_config.py -q`
Expected: FAIL (`ImportError: cannot import name 'InsecureConfigError'`).

- [ ] **Step 3: Implement the guard**

In `backend/app/config.py`, add at the top:

```python
from urllib.parse import parse_qs, urlparse

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_STRICT_SSLMODES = {"require", "verify-ca", "verify-full"}


class InsecureConfigError(RuntimeError):
    """Production settings that would send data over an unencrypted connection. Deliberately not a
    ValueError: pydantic would wrap that in a ValidationError whose text echoes the input values,
    and these values are connection strings with passwords in them."""
```

(keep the existing `BaseSettings` import line merged, not duplicated). Add the field and validator inside `Settings`:

```python
    app_env: str = "development"  # "production" turns on the TLS requirements below
```

and at the end of the class (before `settings = Settings()`):

```python
    @model_validator(mode="after")
    def _require_tls_in_production(self) -> "Settings":
        if self.app_env != "production":
            return self
        problems: list[str] = []
        for name, url in (
            ("DATABASE_URL", self.database_url),
            ("MIGRATION_DATABASE_URL", self.migration_database_url),
        ):
            if url is None:
                continue  # migration_database_url is optional
            sslmode = parse_qs(urlparse(url).query).get("sslmode", [""])[0]
            if sslmode not in _STRICT_SSLMODES:
                problems.append(f"{name} must set sslmode=require (or verify-ca / verify-full)")
        if not self.redis_url.startswith("rediss://"):
            problems.append("REDIS_URL must use rediss:// (TLS)")
        if problems:
            raise InsecureConfigError("APP_ENV=production but: " + "; ".join(problems))
        return self
```

Add to `backend/.env.example` (one line, near the top): `APP_ENV=development`.

- [ ] **Step 4: Run to verify it passes and nothing else broke**

Run: `cd backend && uv run ruff check --fix . && uv run ruff format . && uv run mypy app && uv run python -m pytest tests -q`
Expected: all pass (the module-level `settings = Settings()` still loads in development).

- [ ] **Step 5: Commit**

```bash
git add backend && git commit -m "feat: refuse to start in production without TLS to Postgres and Redis

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Backend container, Fly app config and CI image check

**Files:**
- Create: `backend/Dockerfile`, `backend/.dockerignore`, `backend/fly.toml`
- Modify: `.github/workflows/backend-ci.yml` (add a `docker` job)

**Interfaces:**
- Produces: an image serving the API on port 8080 as a non-root user, with `alembic` on `PATH` and `/app` as working directory; `fly.toml` whose first `app = "..."` line is the single source of the Fly app name (Task 4 reads it).

- [ ] **Step 1: `.dockerignore`**

Create `backend/.dockerignore`:

```
.venv
__pycache__
*.pyc
.env
.env.*
*.db
.pytest_cache
.mypy_cache
.ruff_cache
tests
docker-compose.yml
Dockerfile
.dockerignore
```

- [ ] **Step 2: `Dockerfile`**

Create `backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY --from=ghcr.io/astral-sh/uv:0.12.16 /uv /usr/local/bin/uv

WORKDIR /app

# Dependencies first so the layer is reused when only application code changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY alembic.ini ./
COPY app ./app
COPY migrations ./migrations

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] **Step 3: `fly.toml`**

Create `backend/fly.toml`:

```toml
# The app name is a placeholder: use the name you pass to `fly apps create` (see docs/RUNBOOK.md).
app = "trade-agent-api"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[env]
  APP_ENV = "production"

[deploy]
  # Runs on a temporary machine before the new version starts; a failed migration fails the
  # release and the old version keeps serving. Uses MIGRATION_DATABASE_URL (the table owner).
  release_command = "alembic upgrade head"

[http_service]
  internal_port = 8080
  force_https = true
  # Always on: analysis and backtest runs are background tasks inside this process.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "20s"
    interval = "30s"
    method = "GET"
    path = "/health"
    timeout = "5s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

- [ ] **Step 4: CI job that builds and smoke-tests the image**

In `.github/workflows/backend-ci.yml`, add a job after `quality` (same indentation as the other jobs). The workflow's `defaults.run.working-directory: backend` applies, so paths are relative to `backend/`:

```yaml
  docker:
    name: Docker build and health check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Build image
        run: docker build -t trade-agent-api .

      - name: Start it and check /health
        run: |
          docker run -d --name api -p 8080:8080 trade-agent-api
          for i in $(seq 1 30); do
            if curl -fsS http://localhost:8080/health; then exit 0; fi
            sleep 2
          done
          docker logs api
          exit 1
```

- [ ] **Step 5: Verify what can be verified here**

Run: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/backend-ci.yml'))"` (expected: no output) and `python -c "import tomllib; tomllib.load(open('backend/fly.toml','rb'))"` (expected: no output). If Docker is installed locally, also run `docker build -t trade-agent-api backend` and `docker run --rm -d -p 8080:8080 trade-agent-api`, `curl localhost:8080/health`, then `docker stop` it; report the output. If Docker is not installed, say so; the CI job is then the first real build.

- [ ] **Step 6: Commit**

```bash
git add backend .github && git commit -m "feat: backend Dockerfile, Fly app config and a CI image health check

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Deploy workflow and workflow linting

**Files:**
- Create: `.github/workflows/deploy-backend.yml`, `.github/workflows/workflows-ci.yml`

**Interfaces:**
- Consumes: `backend/fly.toml` (Task 2), the existing workflow named `Backend CI`.
- Produces: automatic backend deploys after Backend CI succeeds on master; an `actionlint` check for every workflow file.

- [ ] **Step 1: Deploy workflow**

Create `.github/workflows/deploy-backend.yml`:

```yaml
name: Deploy backend

# Runs after Backend CI succeeds on a push to master (that workflow is path-filtered to backend/**,
# so frontend-only changes do not redeploy the backend). It can also be run by hand.
on:
  workflow_run:
    workflows: ["Backend CI"]
    branches: [master]
    types: [completed]
  workflow_dispatch:

concurrency:
  group: deploy-backend
  cancel-in-progress: false

defaults:
  run:
    working-directory: backend

jobs:
  deploy:
    name: fly deploy
    runs-on: ubuntu-latest
    if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
    steps:
      - uses: actions/checkout@v7
        with:
          # The commit Backend CI actually tested, not whatever master is by now.
          ref: ${{ github.event.workflow_run.head_sha || github.sha }}

      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy (migrations run as the release command)
        run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

- [ ] **Step 2: Workflow linting**

Create `.github/workflows/workflows-ci.yml`:

```yaml
name: Workflows CI

on:
  push:
    branches: [master, main]
    paths:
      - ".github/workflows/**"
  pull_request:
    paths:
      - ".github/workflows/**"

jobs:
  actionlint:
    name: actionlint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Install actionlint
        run: bash <(curl -sSfL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash) 1.7.7

      - name: Lint workflows
        run: ./actionlint -color
```

- [ ] **Step 3: Verify**

Run the YAML parse check from the Global Constraints on both new files and on every existing workflow (expected: no output). Confirm by reading that the deploy job cannot run for a pull request: `workflow_run` with `branches: [master]` only fires for runs on master, and `if:` requires `conclusion == 'success'`.

- [ ] **Step 4: Commit**

```bash
git add .github && git commit -m "ci: deploy the backend to Fly after Backend CI passes on master, lint workflows

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scheduled-job and backup workflows

**Files:**
- Create: `.github/workflows/scheduled-jobs.yml`, `.github/workflows/backup-db.yml`

**Interfaces:**
- Consumes: `backend/fly.toml` app name; secrets `FLY_API_TOKEN`, `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`.
- Produces: a daily run of `python -m app.scheduled daily` in a one-off Fly machine; a daily encrypted dump kept as a private artifact for 30 days.

- [ ] **Step 1: Scheduled-job workflow**

Create `.github/workflows/scheduled-jobs.yml`:

```yaml
name: Scheduled jobs

on:
  schedule:
    - cron: "30 5 * * *" # daily, UTC: portfolio snapshots, then outcome evaluation
  workflow_dispatch:

concurrency:
  group: scheduled-jobs
  cancel-in-progress: false

jobs:
  daily:
    name: python -m app.scheduled daily
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Run the daily job in a one-off Fly machine
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        run: |
          set -euo pipefail
          APP=$(grep -m1 '^app = ' backend/fly.toml | cut -d'"' -f2)
          # The image the running machine uses, so the job always runs the deployed code.
          IMAGE=$(flyctl machine list --app "$APP" --json \
            | jq -r '[.[] | select(.state == "started")][0].config.image')
          test -n "$IMAGE" && test "$IMAGE" != "null"
          # The machine gets the app's secrets and is removed when the command exits.
          flyctl machine run "$IMAGE" python -m app.scheduled daily \
            --app "$APP" --region fra --rm --restart no --vm-memory 512
```

The exact `flyctl machine run` flags and whether the workflow step fails when the job's own exit status is non-zero cannot be verified without a Fly account. Check `flyctl machine run --help` if `flyctl` is installed; otherwise keep the flags above, and say in the report that they are unverified. The runbook (Task 5) lists "run this workflow once by hand and read the machine's logs in Fly" as a required manual check, with the documented fallback `flyctl ssh console --app "$APP" --command "python -m app.scheduled daily"` (flyctl maps a failing remote command to a non-zero exit).

- [ ] **Step 2: Backup workflow**

Create `.github/workflows/backup-db.yml`:

```yaml
name: Backup database

on:
  schedule:
    - cron: "15 4 * * *" # daily, UTC
  workflow_dispatch:

jobs:
  backup:
    name: pg_dump, encrypt, keep 30 days
    runs-on: ubuntu-latest
    steps:
      - name: Install the PostgreSQL 17 client
        run: |
          sudo install -d /usr/share/postgresql-common/pgdg
          sudo curl -sSfL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
          . /etc/os-release
          echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
          sudo apt-get update
          sudo apt-get install -y postgresql-client-17

      - name: Dump and encrypt
        env:
          BACKUP_DATABASE_URL: ${{ secrets.BACKUP_DATABASE_URL }}
          BACKUP_PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
        run: |
          set -euo pipefail
          umask 077
          printf '%s' "$BACKUP_PASSPHRASE" > "$RUNNER_TEMP/passphrase"
          # The connection must be a role that bypasses row-level security
          # (BYPASSRLS or superuser; Supabase's postgres has BYPASSRLS); pg_dump runs with
          # row_security=off and fails loudly on a role that does not.
          pg_dump --format=custom --no-owner --no-privileges "$BACKUP_DATABASE_URL" \
            | gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 \
                --passphrase-file "$RUNNER_TEMP/passphrase" \
                -o "trade-agent-$(date -u +%Y%m%d).dump.gpg"
          rm -f "$RUNNER_TEMP/passphrase"
          ls -l trade-agent-*.dump.gpg

      - name: Keep the encrypted file for 30 days
        uses: actions/upload-artifact@v4
        with:
          name: db-backup
          path: trade-agent-*.dump.gpg
          retention-days: 30
          if-no-files-found: error
```

- [ ] **Step 3: Verify**

YAML parse both files. Read both once for secrets: no secret value is echoed, the dump is piped straight into `gpg` (never written unencrypted, never logged), the passphrase file is removed, and `set -euo pipefail` makes a failed `pg_dump` fail the step (so no truncated file is uploaded as success).

- [ ] **Step 4: Commit**

```bash
git add .github && git commit -m "ci: daily scheduled job in a one-off Fly machine and daily encrypted database backup

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Runbook and documentation

**Files:**
- Create: `docs/RUNBOOK.md`
- Modify: `docs/ARCHITECTURE.md` (§13 and the checklist), `README.md`

**Interfaces:**
- Consumes: everything above (names of secrets, workflows, the app name placeholder).

- [ ] **Step 1: Write `docs/RUNBOOK.md`**

Sections, in this order, each with concrete commands or dashboard paths (no invented values; use `<placeholders>`):

1. **What runs where** (a four-line table: Vercel frontend, Fly backend, Supabase DB and Auth, Upstash Redis; GitHub Actions for deploys, the daily job and backups).
2. **First deploy, in order** (the numbered list from the spec):
   - Supabase: create project; disable public sign-ups; Authentication, URL Configuration: add the Vercel URL to Redirect URLs and apply the invite email template described in ARCHITECTURE §13; set a password for the runtime role (`ALTER ROLE trading_agent_app WITH LOGIN PASSWORD ...`, see ARCHITECTURE §13); run migrations once from your machine against `MIGRATION_DATABASE_URL`; create the first admin with `python -m app.auth.bootstrap_admin <email> <supabase-uid>`.
   - Upstash: create the Redis database (TLS on) and copy the `rediss://` URL.
   - Fly: `fly apps create <name>`; put the same name in the first line of `backend/fly.toml`; `fly secrets set ...` for the nine secrets (list them with where each value comes from); `fly deploy` once from `backend/`; confirm `https://<name>.fly.dev/health`; `fly tokens create deploy -a <name>`.
   - Vercel: import the repo, root directory `frontend/`; set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`; deploy; then on Fly set `CORS_ALLOWED_ORIGINS` and `INVITE_REDIRECT_URL` to the Vercel origin (and the accept-invitation path) and redeploy.
   - GitHub: add secrets `FLY_API_TOKEN`, `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`.
3. **Manual checks to do once** (checklist with checkboxes): run "Scheduled jobs" by hand and read the one-off machine's logs in Fly (and, if the workflow shows green while the job failed, switch to the `flyctl ssh console --command` fallback in the workflow comments); run "Backup database" by hand, download the artifact, decrypt it, restore it into a scratch database and check that a user table has rows (this proves the backup role bypasses RLS); send a chat message and run one analysis in production.
4. **Spend and abuse limits**: set a monthly spend limit and an email alert in the Anthropic console; the in-app monthly limits already cap each user.
5. **Rolling back a bad deploy**: `fly releases -a <name>`, `fly deploy -a <name> --image <previous image>`; a migration is not rolled back automatically (say how to restore from a backup if one is destructive).
6. **Restoring a backup**: download the artifact, `gpg --decrypt`, `pg_restore --no-owner -d <new database> file.dump`, re-run the RLS setup grants if the target is a fresh Supabase project, point `DATABASE_URL` at it.
7. **Where each secret lives** (table: secret, where set, who can read it) and a reminder never to commit them.
8. **Known limits**: no point-in-time recovery on Supabase's free tier (the daily backup is the only recovery path, up to 24 hours of data can be lost); CORS allows all methods and headers for the one configured origin; the scheduled job's failure is visible in the GitHub run and Fly logs only.

- [ ] **Step 2: Update ARCHITECTURE.md**

In §13's table: change the Backend row to say a `Dockerfile` and `fly.toml` exist in `backend/` (always-on machine, 512 MB, `release_command = "alembic upgrade head"`, health check on `/health`), the CI/CD row to the three workflows (`deploy-backend.yml`, `scheduled-jobs.yml`, `backup-db.yml`) plus Vercel's integration, and add a short paragraph: `APP_ENV=production` makes the backend refuse to start without TLS to Postgres (`sslmode=require`) and Redis (`rediss://`). Tick the checklist items this closes (scheduled jobs trigger if listed, TLS to Postgres and Redis, pooler, backup plan) and reword the CORS item to say the deployed origin is set through `CORS_ALLOWED_ORIGINS` (see the runbook). Mention `APP_ENV` in the environment-variable list.

- [ ] **Step 3: Update README.md**

Change the Status line "What remains is deployment…" to say the deployment files exist and point at `docs/RUNBOOK.md` for the first deploy; add the runbook to the Documentation section.

- [ ] **Step 4: Verify and commit**

Run: `grep -rn "password\|secret" docs/RUNBOOK.md` and confirm every hit is a placeholder or a secret *name*, never a value. Then:

```bash
git add docs README.md && git commit -m "docs: deployment runbook and updated deployment notes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** container and Fly app, always-on machine, release command, health check (Task 2); secrets list (Global Constraints, Task 5); TLS guard (Task 1); deploy on merge after CI (Task 3); Docker build and health smoke test (Task 2); actionlint (Task 3); scheduled job (Task 4); backup, encryption, 30-day artifact (Task 4); runbook with first-deploy order, rollback, restore, budget alert, manual checks (Task 5); ARCHITECTURE and README updates (Task 5). Frontend deploy is Vercel's integration (documented in Task 5).
- **Spec correction recorded:** the spec said a "read-only" backup connection; because RLS is forced on the user tables, the plan requires a role with BYPASSRLS (or a superuser; the table owner alone is not enough because FORCE RLS applies to it too; without it pg_dump fails loudly) and makes the restore check part of the runbook.
- **Placeholders:** none in code steps; the Fly app name `trade-agent-api` is a deliberate placeholder the owner replaces.
- **Type consistency:** `InsecureConfigError`, `app_env`, the secret names, the app-name source (`backend/fly.toml` first `app = ` line) are used identically across tasks.
