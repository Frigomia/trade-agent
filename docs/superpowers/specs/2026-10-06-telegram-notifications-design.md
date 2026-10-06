# Telegram notifications — design

## Goal

Someone who connects Telegram gets one short message on weekday mornings telling them what is waiting:
the new recommendations from the automatic analysis and any of their tickers that moved a lot. They no
longer have to open the app to find out. It is the "tell me when to look" half of the plan to grow
investments with little effort. Nothing here changes what the system does: it still never places a trade,
and a message only points back to the app.

## Decisions (agreed in brainstorming)

| Question | Decision |
| --- | --- |
| What the first version sends | A morning digest and price-move alerts, in one message. Not in version one: target prices, approving or dismissing from Telegram, outcome results, a per-person level of detail, a time-of-day setting. |
| How price alerts work | A daily move check in the morning job: a holding or watchlist ticker whose last close moved more than the person's threshold (default 5 %) versus the close before. No new scheduler. |
| How much a message says | Tickers and actions, for example "3 new: AAPL ADD, MSFT HOLD, NVDA TRIM". No amounts, no reasoning text, no portfolio value. A link to Today and the line "Advisory only. Nothing is sent to a broker." |
| Whose bot | One shared bot owned by the admin. People connect by tapping a link. |
| Opting in | Linking a chat is the opt-in. Two switches (digest, price moves) and the threshold can then be changed. Unlinking, or `/stop` to the bot, ends it. |

Out of scope: any broker or order action, group chats, messages that carry portfolio amounts or the
text of a recommendation's reasoning, push notifications by other channels, showing an admin whether
someone linked Telegram (the admin screens stay unchanged).

## What exists today

- The daily job (`python -m app.scheduled daily`, started by `.github/workflows/scheduled-jobs.yml` in a
  one-off Fly machine) runs snapshots, outcomes and, on weekdays, the automatic analysis
  (`app/scheduled.py`). It holds a Redis lock, works per user inside `scoped_session(user_id)`, prints a
  summary line with counters and returns non-zero when a user failed. The one-off machine receives the
  app's Fly secrets.
- Recommendations carry `source` (`manual` or `scheduled`), `status` (`PENDING`, ...) and `created_at`.
- `app/agents/market_data.fetch_quote_and_history(ticker)` returns the price and the daily closes
  (cached in Redis for a few minutes); the analysis router already derives a day change from the last two
  closes.
- The web app is one always-on Fly machine behind HTTPS (`fly.toml`), so it can receive a webhook.
- Every user table has a `user_id`, forced owner-only row-level security, and an entry in
  `app/rls.py` `USER_TABLES` (a test fails if one is missing). Deleting someone's data clears every user
  table. `tests/test_routes_require_auth.py` asserts that every route except `/health` answers 401 without
  a token.
- ARCHITECTURE and PRODUCT list notifications as not built.

## How it works

- **Linking.** On Account, "Connect Telegram" asks the backend for a one-time code and opens
  `https://t.me/<bot username>?start=<code>`. The person taps Start; Telegram sends `/start <code>` to the
  webhook; the code resolves to the user and the chat id is stored. Codes are 22-character URL-safe
  random strings, kept in Redis for 10 minutes, used once, and never written to a log.
- **The webhook.** `POST /telegram/webhook` is called by Telegram, not by a signed-in user. It accepts
  only requests whose `X-Telegram-Bot-Api-Secret-Token` header equals `TELEGRAM_WEBHOOK_SECRET`
  (compared in constant time) and answers 401 otherwise, which keeps
  `test_every_route_except_health_requires_authentication` valid without an exception. It handles private
  chats only, and only two commands: `/start <code>` (link) and `/stop` (unlink). Anything else gets a
  fixed one-line reply or none. A chat already linked to another user is refused ("this chat is already
  connected to another account"); one chat belongs to at most one user and one user has at most one chat.
- **Sending.** A small `app/telegram.py` posts to the Bot API with the shared token. Messages are plain
  text (no formatting mode, so nothing in them can be interpreted as markup). The token is never logged;
  errors log the exception class name only. A 403 ("blocked by the user") or "chat not found" marks the
  link `blocked` and stops sending to it until the person reconnects; a 429 or a network error skips that
  message (next morning's message is a fresh one).
- **The morning step.** `daily` gets a fourth step, `notify`, after the analysis (also runnable alone as
  `python -m app.scheduled notify`). Weekdays only (UTC), like the analysis. For each active user with a
  link whose status is `ok`, inside their own scoped session:
  1. new recommendations: this user's `source = scheduled`, `PENDING` recommendations created today (UTC)
     (when `digest_enabled`);
  2. price moves: for each open holding and each watchlist ticker (capped at the same 50 as an analysis
     run), the change between the last two closes; those whose absolute change is at least
     `move_threshold_pct` (when `moves_enabled`);
  3. if both lists are empty, nothing is sent; otherwise one message: the digest line, the moves line
     ("moved: AAPL -6.2 %, NVDA +5.4 %"), the link to Today, and the advisory footer.
  A per-user per-day Redis marker (`SET ... NX EX`) is set just before sending, so a re-run of the job on
  the same day never sends a second message; a failed send removes it only when nothing was delivered.
- **Failure handling.** A Telegram outage or a bad token never turns the job red: the summary line gains
  `notify_sent`, `notify_skipped` and `notify_failures`, and failures are logged by user id and class
  name. A user whose quotes cannot be fetched still gets the digest part.
- **Settings.** `GET /me/telegram` returns `{linked, status, digest_enabled, moves_enabled,
  move_threshold_pct, bot_username}`; `POST /me/telegram/link` returns `{url, expires_in}` (rate limited,
  10 a minute); `PATCH /me/telegram` updates the two switches and the threshold (1 to 50 percent);
  `DELETE /me/telegram` unlinks. All require an active user and run through `get_user_db`.

## Data change

New table `telegram_links` (hand-written migration, added to `USER_TABLES` and so to the runtime grants
with its id sequence): `id`, `user_id` (unique), `chat_id` (bigint, unique), `status` (`ok` or `blocked`),
`digest_enabled` (default true), `moves_enabled` (default true), `move_threshold_pct` (numeric(4,1),
default 5.0, check 1 to 50), `linked_at`, `updated_at`. The data export lists whether a chat is linked and
the three settings but not the chat id; deleting someone's data or removing the user deletes the row.

## Configuration

Fly secrets and settings: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (a long random string),
`TELEGRAM_BOT_USERNAME`, and `APP_URL` (the frontend origin, for the link to Today). Without the token the
Telegram routes answer 503 with a plain message and the `notify` step does nothing, so the rest of the
system is unaffected. A one-off `python -m app.telegram set-webhook` registers the webhook
(`setWebhook` with the secret token and `allowed_updates = ["message"]`); the RUNBOOK describes it, the
BotFather steps, rotating the token and what to do if the bot is blocked at scale.

## Frontend

- An Account "Telegram" panel with three states: not connected (a "Connect Telegram" button that opens the
  bot link and then waits, polling the status every few seconds for up to the code's lifetime), connected
  (status, the two switches, the threshold field, "Disconnect"), and blocked ("Telegram stopped
  receiving messages; reconnect" with the Connect button). A short note says what is sent and what is not.
- The frontend design is done with the huashu-design and impeccable skills before any code, as for the
  Claude keys and the scheduled analysis (three directions, the user picks one).

## Privacy and security review points

The bot token and webhook secret never reach a log or a response; the webhook rejects anything without
the secret header and handles private chats only; a link code cannot be guessed (128 bits), is used once
and expires; a chat cannot be linked to two users and one user's message never contains another's data
(each message is built inside that user's scoped session); the message text is plain and contains only
tickers, actions and percentages; the `notify` step cannot send twice a day to the same person; blocked
chats are not retried; the admin API and screens learn nothing about Telegram; deleting data or the account
removes the chat link. The security reviewer runs on the full diff before the pull request.

## Testing

- Telegram client: sends the expected request, never logs the token, maps 403 and "chat not found" to
  `blocked`, 429 and network errors to a skipped message.
- Webhook: wrong or missing secret gives 401; `/start <code>` links; an expired or reused or unknown code
  does not; a chat already linked elsewhere is refused; `/stop` unlinks; group chats and other commands
  are ignored.
- Settings routes: round trip, bounds on the threshold, 503 without a token, rate limit on link creation,
  another user's link is invisible (row-level security with the restricted runtime role).
- The step: only linked, enabled, active users; weekdays only; the message lists exactly today's
  scheduled pending calls and the moved tickers; nothing to say sends nothing; a re-run the same day sends
  nothing; a blocked chat is skipped; one user's failure does not stop the others and does not change the
  exit code; counters in the summary line.
- Migration and data deletion/export.
- Frontend: the three panel states, the polling after Connect, the switches and threshold, the note.

## Documentation

ARCHITECTURE (data model, API, the `notify` step, configuration) and the RUNBOOK (BotFather, secrets,
setWebhook, rotation, the new counters, what "blocked" means). PRODUCT: notifications are now built.

## Open points to confirm during implementation

- Whether the Fly proxy needs anything for Telegram's webhook calls beyond the public HTTPS URL
  (it should not); the first real `/start` is part of the post-deploy checklist.
- Wording of the bot's few fixed replies and the exact message layout (checked against what reads well in
  Telegram on a phone).
- Whether `fetch_quote_and_history`'s Redis cache and the morning timing (05:30 UTC, before the European
  open) give a sensible "last close versus the close before" on Mondays and after holidays; if not, the
  move check compares against the last two sessions that have data.
