# Scheduled analysis — design

## Goal

Someone who opts in opens the Today screen in the morning and finds their recommendations already
there, without pressing Run analysis. The first of the "less effort, no price-watching" features:
alerts and a digest (a later sub-project) need analysis that runs by itself. Nothing here changes
what the system does: it still never places a trade.

## Decisions (agreed in brainstorming)

| Question | Decision |
| --- | --- |
| Cadence | Once each weekday morning, opt-in per user, off by default. |
| Cost | One automatic run counts as one run against the person's monthly limit (about 22 a month), so the admin's per-user limits still cap it. |
| Whose key | The user's own Claude key (see the per-user Claude keys design). An admin without a personal key uses the server key. A user with no key is skipped. |
| A ticker that already has a pending call | Skipped, unless that call is 3 or more days old; then it is analyzed again and the new call replaces the old one. |

Out of scope: notifications (the next sub-project, so for now the person still opens the app), a
time of day per user, more than one run a day, running only when a price moves.

## Depends on

The per-user Claude keys design (`2026-10-06-user-claude-keys-design.md`): the client for each user's
run comes from the same function. Build that first.

## What exists today

- `python -m app.scheduled daily` runs from `.github/workflows/scheduled-jobs.yml` at 05:30 UTC in a
  one-off Fly machine. It loops over active users, each inside their own database scope, doing portfolio
  snapshots and recommendation outcome evaluation, under a Redis lock, and returns non-zero when any user
  failed.
- The manual analysis path is `app/agents/jobs.py` (`create_job`, `run_job`, `_process_ticker`), started
  from `POST /analysis/run`; one run counts once against the monthly run limit
  (`app/usage.py`, `check_monthly_usage("analysis_run")`).
- `investment_preferences` (one row per user) holds the preferences; Preferences screen edits it.
- A recommendation has `status` PENDING, APPROVED or REJECTED and a `created_at`.

## Data change

- `investment_preferences.auto_analysis`: boolean, default false, through a new hand-written migration.
- `recommendations` gets a `source` column (`manual` or `scheduled`), so the screen can label automatic calls. The `SUPERSEDED` status already exists: `app/agents/jobs.py` already marks an older PENDING call of the same ticker `SUPERSEDED` when a new one is created, so the scheduled step reuses that and only adds the rule that a pending call younger than 3 days is skipped. The migration for the new column is hand-written.
- The preferences API gains the optional `auto_analysis` field, and returns whether automatic analysis is
  currently paused and why (`limit reached` or `no Claude key`).

## The scheduled step

A third step in the daily command, after snapshots and outcomes. It does nothing on Saturday and Sunday (UTC).
For each active user with `auto_analysis` on, inside their scoped session and under the existing lock:

1. Resolve their Claude client; no key means the user is skipped and counted as skipped, not as a failure.
2. If their monthly run limit is used up, skip them (counted as skipped).
3. Build the ticker list: open holdings and the watchlist.
4. Remove every ticker that has a PENDING call younger than 3 days. If nothing is left, stop without counting
   a run.
5. Otherwise record one run against their monthly counter and run the same analysis pipeline as the manual
   path for the remaining tickers.
6. Each new call is stored with `source = scheduled`. If it is for a ticker that had a PENDING call of 3 or
   more days, that old call becomes `SUPERSEDED` in the same transaction.
7. A failure for one user (a bad ticker, a Claude error, a rejected key) is caught, logged by user id and error
   class, and counted; the other users still run. The command's summary line gains the new counters
   (`analysis_runs`, `analysis_skipped`, `analysis_failures`), and the exit code stays non-zero when any user
   failed so the workflow turns red.

The step reuses the existing pipeline and the existing counter. It adds no new Claude code path.

## Frontend

- **Preferences:** a switch "Analyze my portfolio automatically each weekday", off by default, with one line
  under it: "Runs once each weekday morning and counts as one run of your monthly limit." When paused it shows
  why: "Paused: you have used all N runs this month. It resumes on <date>." or "Paused: connect your Claude key
  to turn this on."
- **Today:** pending calls are there when the person opens it. An "Automatic" tag marks calls created by the
  scheduled step, and the existing "Last analysis" line shows its time. Superseded calls are not listed.
- Track record counts a superseded call like any other that was never decided (it is not scored as a decision).

## Cost control

Opt-in, at most one run a day, capped by the monthly limit, and tickers with a recent pending call are skipped, so
a person who ignores Today does not generate a new call per ticker every day. The cost lands on the person's own
Claude key.

## Testing

- The step, with fake data and a fake Claude client: only opted-in users run; weekends do nothing; a user with no
  key is skipped; a user at the monthly limit is skipped; a ticker with a fresh pending call is skipped and one
  with a call of 3 or more days is analyzed and the old call becomes `SUPERSEDED`; nothing left to analyze does not
  count a run; one failing user does not stop the others and the exit code is non-zero; each call is tagged
  `scheduled`; the Redis lock still prevents two runs.
- Isolation: a user's scoped session never sees another user's holdings or calls (row-level security).
- Preferences: the switch round trip, the paused reasons, the default off.
- Frontend: the switch and its messages, the Automatic tag, superseded calls hidden.

## Documentation

ARCHITECTURE §12 (scheduled jobs) and the preferences table row are updated; the RUNBOOK's scheduled-job section
mentions the new step and its counters.

## Open points to confirm during implementation

- How the manual path is best called for a user from the scheduled command (the same function, or a thin shared
  helper), and where the "one run per day" count is recorded.
