# Secondary screens: Preferences, Account, Track record (sub-project 8a)

Sub-project 8a of the frontend roadmap in
`docs/superpowers/specs/2026-09-28-frontend-design-direction-design.md`. Sub-projects 2 to 6 are merged;
Chat (7) is deferred by the owner. Sub-project 8 is split: this spec covers Preferences, Account and
Track record, which are frontend plus one small backend schema addition (below). Backtests (8b) is its own cycle because it needs a backend
change (a stored equity curve for the two-line chart).

## Constraints

- The system never places a trade. Nothing here offers Buy, Sell, Deposit or Withdraw; screens that
  record something say nothing is sent to a broker.
- No model or migration change. The only backend change is exposing two existing Recommendation
  columns (`outcome_forward_return_pct`, `outcome_evaluated_at`) on `RecommendationOut`; every other
  endpoint used already exists.
- Stack and patterns as in `frontend/CLAUDE.md`: named exports, all calls through `lib/api/client`,
  SWR for reads, `useAction` for submits, no effects for anything derivable in render, MUI 9
  `slotProps` (no `SelectProps` / `InputLabelProps`).
- No currency symbol; colour is never the only carrier of meaning (sign or word always shown).

## Scope

### More menu (`/more`)

Replaces the "Coming in sub-project 8" placeholder with a list: Track record, Backtests, Preferences,
Account. Backtests keeps its current placeholder page until 8b. New route `/more/track-record`.

### Preferences (`/more/preferences`)

- Reads `GET /preferences`; saves with `POST /preferences` sending the full object
  (`risk_tolerance`, `sector_avoid_list`, `notes`), then revalidates.
- Risk tolerance: three-way toggle (conservative / moderate / aggressive), can be left unset.
- Sectors to avoid: chips with an add input; entries are trimmed, blank and duplicate entries ignored.
- Notes: multiline, 2000 characters, with a counter; input is capped at the limit.
- Appearance: System / Light / Dark, wired to the existing theme provider and its persisted choice.
  This is client-side only and is not sent to the backend.
- Copy: preferences shape explanations and the web second opinion and never change the score or the
  call.
- One Save button, disabled while saving; a failed load or save shows an inline error.

### Track record (`/more/track-record`)

- Backend: add `outcome_forward_return_pct: float | None` and `outcome_evaluated_at: datetime | None` to
  `RecommendationOut` (columns already exist; no migration). The stored value is a fraction (0.05 means
  +5%) despite the `_pct` name, so the UI multiplies by 100 for display. `outcome_evaluated_at` set with a
  null return means "resolved, no valid outcome" and is not scored.
- Nothing computes outcomes on a schedule, so opening Track record calls
  `POST /memory/evaluate-outcomes` once (best effort, silent on failure, like the daily snapshot; it only
  touches rows due after 20 days, batch of 50), then revalidates the list.
- Reads `GET /analysis/recommendations`. Only rows with a non-null `outcome_forward_return_pct` are
  scored.
- Scoring rule (UI side, from the stored 20-day return): BUY and ADD match when the return is above
  zero; TRIM and SELL match when it is below zero; HOLD and WATCH are not scored; dismissed
  (REJECTED) calls are scored too; SUPERSEDED rows are excluded (they were replaced by a newer run,
  not decided). A return of exactly zero does not match.
- The rule is a pure function in `lib/trackRecord.ts`, unit tested. If the backend later stores a
  matched flag, use it instead.
- Summary line: "N of M calls moved the way the action implied", with a "small sample, not a
  forecast" label. With no scored rows, an empty-state message instead.
- Each row: action, ticker, date, decision (approved / dismissed / pending), and the signed 20-day
  move; a matched or missed word accompanies the sign. Unscored rows read "not scored".
- No pagination for now.

### Account (`/more/account`)

- Signed-in email, from `GET /me`.
- Change password through the Supabase client `updateUser`, with a confirm field, a minimum length,
  and Supabase's own error message shown (the user is already signed in, so specific errors are fine).
- Own usage from `GET /me/usage`: analysis runs and chat messages, used / limit bars, warn colour above
  90% and a banner-style message at the limit. Reset date is the first of next month, UTC, derived
  client-side (the backend keys counters by calendar month).
- Links to Track record, Backtests and Preferences.
- Export my data: fetches `GET /me/export` on click and downloads it as
  `trade-agent-export-YYYY-MM-DD.json` (Blob download).
- Delete my data: `DELETE /me/data` with `{confirm: true}`. The backend deletes the user's rows in every
  user-data table but keeps the sign-in and the `app_users` row, so the label and copy say **data**, not
  account: it lists what is deleted (holdings, watchlist, trades, recommendations, chats, backtests,
  preferences, snapshots) and what is not (sign-in and access; removing access is an admin action). The
  button stays disabled until the user types their own email. On success the SWR cache is cleared and the
  user is signed out.
- Sign out.

This deliberately differs from the design-direction spec line "Delete my account and data"; that spec
predates the backend behaviour.

## Data flow and errors

- Reads through SWR, submits through `useAction` (one request at a time, `ApiError.detail` shown).
- Load failures show an inline Alert per screen, as on Portfolio. Save, export and delete failures show
  the API detail. Nothing uses exclamation marks or urgency wording.

## Testing

Vitest and React Testing Library with a mocked `apiFetch`, as in earlier sub-projects.

- Backend: `RecommendationOut` includes the two outcome fields (evaluated and unevaluated rows), and
  `docs/ARCHITECTURE.md` §5 notes it.
- `trackRecord.ts`: each action's rule, fraction-to-percent conversion, HOLD/WATCH unscored, null outcome skipped, REJECTED scored,
  SUPERSEDED excluded, zero return, empty list.
- Preferences: values load, chip add and remove (blank and duplicate ignored), 2000-character cap, saves
  the full body, error path, theme choice applied.
- Track record page: evaluate-outcomes fires once on open and a failure is silent, summary wording, small-sample label, unscored rows, empty state, load error.
- Account: usage bars and the 90% warn state, reset date across a December to January boundary, export
  triggers a download, delete gated on the typed email and sends `{confirm: true}`, password mismatch and
  short password blocked, sign out.
- More page links.

## Non-goals

Deleting the login itself, storing appearance server-side, Backtests (8b), Chat (7), pagination or
filtering on Track record.

## Follow-on

8b: Backtests. Adds a stored daily strategy and buy-and-hold curve to the backtest result (engine,
model column, Alembic migration, schema), then the run form, polling, two-line chart and per-signal
table. `docs/ARCHITECTURE.md` is updated in that cycle.
