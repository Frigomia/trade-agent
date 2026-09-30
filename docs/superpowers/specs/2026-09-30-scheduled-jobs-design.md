# Scheduled jobs: daily snapshots and outcome evaluation

A backend-only follow-up to the frontend roadmap. Today two things happen only when someone opens a
page: the portfolio snapshot (`useDailySnapshot` calls `POST /portfolio/snapshot` once per UTC day)
and the 20-day recommendation outcomes (Track record calls `POST /memory/evaluate-outcomes` when it is
opened). This spec makes them happen on their own, for every active user, by adding a one-shot command
that an external scheduler runs.

## Constraints

- The system never places a trade. Nothing here calls a broker.
- Backend rules from `backend/CLAUDE.md`: thin routers and fat services, services raise domain
  exceptions (the API maps them to HTTP), Pydantic v2, typed functions, no `print`, RLS-scoped sessions
  for user data (`scoped_session(user_id)`), never log or persist raw exception text, never use the owner
  database role at runtime, tests against real Postgres, no real yfinance or Anthropic calls in tests
  (patch by the consuming module's own name).
- Only cheap jobs are scheduled: both use yfinance only and spend no Anthropic budget. Scheduling
  `/analysis/run` (which does) stays out of scope; the ARCHITECTURE.md item about a cost alert before
  anything unattended runs on a schedule still applies to that.
- No new always-on process, container or dependency. Nothing is deployed yet, so no Dockerfile or
  compose service is added.

## Behaviour

`uv run python -m app.scheduled <command>` with the commands `daily` (snapshots then outcomes),
`snapshots` and `outcomes`. An unknown command exits 2.

- **Lock.** Each run first takes a Redis lock (`scheduled:<command>`, set only if absent, one-hour
  expiry). If it is already held the run logs that and exits 0 without doing any work, so overlapping
  cron runs or two machines cannot double up. The lock is released when the run ends; a crash leaves it
  to expire. If Redis is unreachable the run logs the error and exits 1; it never runs unlocked.
- **Users.** `app_users` rows with status `active`, processed sequentially, each inside its own
  `scoped_session(user_id)`. Invited and disabled users are skipped. One user's failure is caught,
  logged (exception class only) and counted, and never stops the next user.
- **Snapshots** (per user):
  - skipped when the user has no open holding (`shares > 0`);
  - skipped when the user already has a snapshot dated today (UTC), including one the page-open hook
    made, so the job is idempotent;
  - otherwise `record_snapshot` prices every open holding and stores the totals; if any holding cannot be
    priced the user is counted as failed and nothing is written (a partial total is never recorded, the
    same rule as the endpoint).
- **Outcomes** (per user): drains due recommendations in batches of 50 until none remain or 20 batches
  have run. It does not depend on quotes for holdings, so it still runs for a user whose snapshot failed.
- **Result.** One log line per user and a final summary (users seen, snapshots recorded, snapshots
  skipped, outcomes evaluated, failures). Exit 0 when every user succeeded, or there was nothing to do;
  exit 1 when any user failed, so whatever runs the job can alert on the exit code.
- **Timing.** The job knows nothing about trading days; the trigger decides. Recommended: weekdays around
  23:00 UTC, after both the EU and US closes. Running it more often is harmless because of the
  idempotency above.

## Refactor (routers become thin)

- `backend/app/snapshots.py::record_snapshot(db, user_id) -> PortfolioSnapshot`: the pricing loop that
  lives in `routers/portfolio.py` today. Raises a domain error `PriceUnavailable(ticker)` when a price is
  missing or not finite. `POST /portfolio/snapshot` calls it and maps `PriceUnavailable` to the same 500
  and message it returns now ("No current price available for X").
- `backend/app/memory/outcomes.py::evaluate_due_outcomes(db, user_id) -> tuple[int, int]`: the batch loop
  that lives in `routers/memory.py` today; returns `(evaluated, remaining)`. `POST
  /memory/evaluate-outcomes` calls it and returns the same JSON as now.
- Existing router tests patch `fetch_quote_and_history` and `compute_outcome` by the router's module
  name; their patch targets move to the new services. Their assertions do not change.
- The frontend is unchanged: the page-open snapshot and Track record's evaluate call stay as fallbacks,
  so an environment without a trigger configured still works.

## Tests

Real Postgres, no real yfinance, patch by module-local name.

- `record_snapshot`: totals for priced holdings; zero-share holdings skipped; `PriceUnavailable` carries
  the ticker and nothing is written. The existing `/portfolio/snapshot` endpoint tests stay green.
- `evaluate_due_outcomes`: due rows evaluated, not-yet-due rows left, a permanent failure is stamped so
  it stops blocking the batch. The existing memory router tests stay green.
- The job: only active users are processed (invited and disabled skipped); a user with a snapshot today
  is skipped and no duplicate is created; a user with no open holdings is skipped; one user's
  `PriceUnavailable` does not stop the next user and yields exit 1; exit 0 when all succeed and when
  there is nothing to do; a second concurrent run exits 0 without doing work and the lock is released
  afterwards; a Redis failure exits 1; the outcomes drain stops at the 20-batch cap; each user only sees
  their own rows.
- CLI: `daily`, `snapshots`, `outcomes` dispatch correctly; an unknown command exits 2.

## Docs

`docs/ARCHITECTURE.md`: a "Scheduled jobs" section (what runs, idempotency, lock, exit codes) with
copy-paste triggers: cron and Windows Task Scheduler for local use, and a Fly scheduled machine for
production (§13). The Operational checklist entry "Scheduling for /analysis/run" is updated: snapshots
and outcomes are scheduled; `/analysis/run`, `/backtest/run` and `/memory/embed` stay manual by design.
`backend/CLAUDE.md` gets the command in its command table.

## Non-goals

A scheduler process or service, a Dockerfile or compose service, scheduling `/analysis/run`,
`/backtest/run` or `/memory/embed`, notifications, an admin page for job status, per-user schedules,
running jobs in parallel, retries beyond the existing yfinance backoff.
