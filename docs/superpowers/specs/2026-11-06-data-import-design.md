# Import your data: design

Status: for the owner's approval, 2026-11-06. Nothing is built.

## Intent

"Export my data" gives a person one JSON file with everything the app holds about them. There is no way back in. This feature adds one: **restore the data you entered from that file**, for two situations the owner named:

1. **Recovering after "Delete my data".** Deletion is permanent, so a way back makes it much less final.
2. **Moving to a fresh account** (a new email, a new invitation) without retyping holdings, trades and plans.

It also closes the loop on the promise that your data is yours to take: a file you cannot use again is a weaker promise.

## Goals

- A signed-in person restores their holdings, watchlist, trades, preferences, saved contribution plans, recurring plans (with their entries) and daily value snapshots from their own export file.
- It is safe by construction: the file can never change who someone is, what they may do, or what the app claims about past calls.
- It is predictable: a preview before anything is written, all-or-nothing when it is, and a clear result.

## Non-goals

- **Merging into an account that already has data.** Out by decision (see below). No duplicate handling, no conflict screens.
- **Restoring AI output:** recommendations, scan runs, company analyses, chat messages, backtest results. These are produced by running the app. The owner decided they are never restored, not even as an opt-in "history" (2026-11-06).
- **Importing from a broker or any other format** (for example a Trade Republic statement). A different, larger feature.
- **A CSV or spreadsheet** format. JSON only, the same file the export produces.

## Anti-goals (a failure even if it "works")

- A hand-edited file that makes someone an admin, changes their email or status, or raises their monthly limits.
- A file that plants recommendations or outcomes, so the track record ("remembers how past calls turned out") stops being true.
- A file that writes into another person's rows, or that smuggles instructions into text the model later reads.
- Importing consuming or resetting the monthly scan, analysis or chat allowances.
- A half-restored account after an error.

## Decisions by the owner

- **Only into an empty account.** No merge.
- **"Empty" means** a brand-new account with no data, or an account where only settings (preferences, Telegram) were changed. Settings are not data.
- **Settings stay.** If the account already has preferences, the file's are ignored; the current ones stay.
- **What comes back:** holdings, watchlist, trades, preferences, saved plans, recurring plans and their entries, daily snapshots. AI output does not.
- **How it is made:** build on the existing stack: a backend route next to the export, a file chooser, a preview and a result summary on the Account page, and a format version added to the export.

## How it works

### The flow (Account page, next to "Export my data")

1. The person chooses a file ("Import my data").
2. The file is sent for a **check** (dry run). The server answers with the counts it would restore ("7 holdings, 42 trades, 3 saved plans, ...") or the reason it cannot (not an export file, an unsupported version, the account already has data, a row that does not validate).
3. The person confirms. The same file is sent again and the server **re-checks everything** (nothing is trusted from the first call), then writes it in **one transaction**.
4. A result summary: what was restored, what was skipped and why (for example "your preferences were kept"), and what to do next ("Connect Claude again", "Connect Telegram again").

### The empty-account rule

The import is refused unless every table it restores into has no rows for this person: holdings, watchlist items, trades, portfolio snapshots, contribution plans (and their lines), recurring plans (and their occurrences). AI output (recommendations, scan runs, company analyses, chat messages, backtest results) is never imported and does not block an import (owner, 2026-11-07). Preferences and the Claude key are not data for this rule. (A Telegram link is a setting, not data.) The refusal says so in plain words.

To keep the rule from rotting, a test requires every table in `app/rls.py` `USER_TABLES` to be classified as restored, checked-for-empty, or exempt, so a new table cannot be forgotten.

### Settings

- **Preferences:** restored only if the account has no preferences row yet; otherwise the current ones stay and the summary says so.
- **Telegram settings are not restored.** A Telegram link row exists only with a chat id (`chat_id` is required and unique), and the chat id is never exported, so there is nothing to attach the settings to. The summary says "connect Telegram again". (This corrects the earlier conversation, which listed Telegram settings among the restored data.)
- **The Claude key** is not in the file. The summary tells the person to connect it again.
- **Never restored from the file:** the profile (id, email, role, status, dates), usage counters and limits.

### The file and its version

- The export gains a top-level `format_version` (an integer, `1` today). The import accepts version 1, and a file with no version only if it otherwise validates as the current shape (older exports exist). Any other version is refused with a clear message.
- The file is parsed with a strict model: unknown top-level keys are ignored only for the data we do not restore; unknown fields inside the lists we restore are rejected.

### Ids and links

Rows are copied, not replayed. The database has no foreign keys; links are plain integers, so the import creates **new ids** for every row and rewrites these links:

- recurring occurrence `plan_id` to the new recurring plan id, and `trade_id` to the new trade id;
- contribution plan line `plan_id` to the new plan id, and `placed_trade_id` to the new trade id.

The file's `user_id` and every `id` are ignored; every row gets the signed-in person's id. A link that points at nothing in the file (a confirmed occurrence whose trade is missing, a line whose plan is missing) makes the whole file invalid. The database already requires "confirmed if and only if a trade is attached" and one occurrence per plan and date, and the import must satisfy both.

Holdings and trades are independent rows (a holding stores its own shares and cost basis; a trade is a log entry), so they are copied as they are. **The import never runs trade logic** (no recomputing holdings from trades, no side effects), which is what would double count.

### Recurring plans

Plans are restored with their stored `next_date` and status, and the saved occurrences with their statuses. Nothing is regenerated at import time. The daily job carries on from `next_date` as it does after any downtime (it is idempotent per plan and date).

### Validation

- Reuse the existing input rules where they exist (`Ticker`, `HoldingIn`, `TradeIn`, `RecurringIn`, `PreferencesIn`, the watchlist, plan and note limits) so an imported row is held to the same rules as a typed one; add a strict import model for stored-only fields (name, asset type, currency, ISIN, industry, country, source, created dates).
- Limits: a maximum file size, and a maximum number of rows per list. The existing caps (for example the saved-plan and recurring-plan caps) are reused; the rest are set in the plan (see "My calls").
- Text fields keep their existing patterns (no control characters, no NUL).
- The route is rate limited, like the other write routes.

### Safety and concurrency

- Active users only, through the per-person database session, so row-level security applies to every write. The runtime role already cannot change `role` or `email`, and the import does not touch `app_users` at all.
- One transaction, rolled back on any error. The route first takes the per-person insert lock that background jobs and "Delete my data" use (`lock_user_for_insert`), so a scheduled job cannot write while the empty check and the import run.
- No raw exception text is logged or returned. The audit trail is a log line with the counts only, never the content.
- No model calls and no change to the monthly allowances.
- Responses carry `Cache-Control: no-store`, like the export.

### API

- `POST /me/import?dry_run=true|false` (default false), body: the export JSON. Returns `{ restored: {holdings: n, ...}, skipped: [reason, ...], next_steps: [...] }`, or a 4xx with a plain reason. The dry run returns the same shape with nothing written.
- The export response model gains `format_version`.

### Frontend

In `DataActions` (More, then Account): "Import my data" with a file chooser; the preview and result as small panels in the existing Soft style; errors in the shared error box. The file is read in the browser and sent through `apiFetch`. A signed-in person with data sees why the import is unavailable instead of a dead button.

## Tests

- **Round trip:** export, delete, import, export again: the two files match for everything restored (ids and dates aside).
- **Refusals:** an account with data; a wrong file; a wrong version; a file with a broken link; a confirmed occurrence without a trade; a duplicate occurrence date.
- **Hostile files:** a profile with `role: admin`; someone else's `user_id`; oversized lists; control characters; huge numbers. None may change identity, limits or another person's rows.
- **Atomicity:** a failure on the last row leaves the account empty.
- **Rules:** preferences kept when present; Telegram never restored; allowances untouched; the table-classification test above.
- Frontend: the preview, the refusal message, the result summary and the file chooser.

## My calls (mark these when reviewing)

- The dry-run is one route with a query flag, and the real call re-validates (no stored state between the two).
- A file with no `format_version` is accepted if it validates as the current shape.
- The size and per-list limits (the file size limit and the numbers for lists without an existing cap) are chosen in the plan, from the largest realistic export plus headroom.
- The result summary and the refusal wording are plain sentences in the app's own tone; exact copy is written in the build.
## Decided: not doing (owner, 2026-11-06)

- **No opt-in restore of AI output.** Recommendations, scans, analyses, chats and backtests are not imported in any version of this feature. The export keeps them (it is the person's copy of their data); the import ignores them.
- **No remembering of Telegram settings across a delete.** Telegram settings are not restored, and the link is not changed to keep them; after a restore the person connects Telegram again and gets the defaults. This also settles the Telegram correction above.

Nothing is left open in this document apart from the builder's own choices listed under "My calls".

## Docs to update with the build

`docs/ARCHITECTURE.md` (the API list and the export section), DESIGN.md (the Account screen's new actions), and the privacy notice if it describes export.
