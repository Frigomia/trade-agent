# Per-user Claude API keys — design

## Goal

Invited people pay for their own Claude usage. Today every user shares the server's
`ANTHROPIC_API_KEY`, so the owner pays for everyone. After this change an invited user adds their
own Anthropic key (stored encrypted, never shown again), every Claude call made for them uses it,
and the owner's account keeps using the server key. Nothing here changes what the system does: it
still never places a trade.

## Decisions (agreed in brainstorming)

| Question | Decision |
| --- | --- |
| Who keeps using the server key | Only the admin. Invited users must bring their own. The admin can also add a personal key, which then takes precedence over the server key. |
| Voyage embeddings (long-term memory) | The server `VOYAGE_API_KEY` stays for everyone: the cost is tiny and a second vendor account would double the setup. |
| A user with no key yet | The full app works. The AI features (Run analysis, Chat) are locked with a clear "Connect Claude" card that opens a short guide; a reminder card on Today. |
| Where the key is kept | In the database, encrypted by the application (AES-256-GCM) with a master secret held in Fly secrets. |
| Per-user monthly limits | Stay as they are. They now protect each person's own bill. |

Out of scope: a Voyage key per user, a "use the server key" switch per user, paying or billing
features, showing a user's real Anthropic spend (their own console does that).

## What exists today

- `settings.anthropic_api_key` (env) is read by two modules that each cache one shared
  `Anthropic` client: `app/agents/news.py` (`_get_client`, returns `None` when unset) and
  `app/agents/chat.py` (`_get_client`, raises). `app/routers/chat.py` answers 503 when the server key
  is missing.
- `settings.voyage_api_key` is read by `app/memory/embeddings.py` (and checked in
  `app/routers/memory.py`).
- Analysis runs are background tasks inside the API process (`app/agents/jobs.py`); job state is in
  Redis. The monthly run and chat counters (`app/usage.py`) already exist per user.
- Every user table has a `user_id` column, an owner-only row-level-security policy and an entry in
  `app/rls.py` `USER_TABLES`; a test fails if a table with a `user_id` column is missing there.
- `cryptography` is already installed (a dependency of `pyjwt[crypto]`).

## Storage and encryption

- New table `user_api_keys`: `user_id` (primary key), `ciphertext`, `key_version`, `last4`,
  `status` (`ok` or `needs_attention`), `created_at`, `updated_at`. One key per user. It is added to
  `USER_TABLES` and `RUNTIME_TABLES`, so it gets the same forced owner-only policy as the other
  user tables. The admin API never selects from it.
- The new migration is hand-written (a new file; generated migrations are never edited), creates the
  table and grants the runtime role access through `app/rls.py` like the others.
- Encryption: AES-256-GCM, a fresh random 12-byte nonce per save, and the user's id bound in as
  associated data, so a ciphertext copied to another user's row fails to decrypt. The stored value is
  `nonce || ciphertext+tag`. `key_version` names which master secret encrypted it, so the secret can be
  rotated by re-encrypting rows later.
- The master secret is a new setting, `KEY_ENCRYPTION_SECRET` (32 random bytes, base64), set as a Fly
  secret. With `APP_ENV=production` the app refuses to start without it, the same pattern as the TLS
  guard (the message names the setting and never prints a value). Development and tests use a fixed
  throwaway secret.
- If the master secret is lost, saved keys cannot be decrypted and each user re-enters theirs. The
  RUNBOOK says so and tells the owner to keep a copy of the secret in a password manager.

## API

All three routes are `/me/claude-key`, need an active user and run through `get_user_db`.

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/me/claude-key` | `{connected: bool, last4: str or null, needs_attention: bool}`. Never the key. |
| PUT | `/me/claude-key` | Body `{api_key}`. The format must start with `sk-ant-` and be a sane length. One call to Anthropic with it (listing models costs no tokens) must succeed; only then is it encrypted and stored (replacing any earlier key, status `ok`). Limited to 10 requests a minute per user, so it cannot be used to test stolen keys. |
| DELETE | `/me/claude-key` | Deletes the row. `204`. |

Failures are calm and specific, and never echo the key or Anthropic's raw response: an invalid key,
an account with no credit, Anthropic unreachable. The key is never logged, never in an exception message
and never in a response.

## Using the key

- A small function returns the `Anthropic` client for a user: the user's own decrypted key if they have
  one, otherwise the server key for an admin, otherwise "no key". The decrypted key lives only for the
  request or job and is never cached in a module global or in Redis. The two agents take a client (or a
  user) as a parameter instead of building a shared one.
- A user with no key gets a `409` with a stable code (`claude_key_required`) and a plain message on Run
  analysis and Chat, never a 500. The existing 503 for a missing server key remains only for an admin with
  neither key.
- Background analysis resolves the key when the job starts, from the user's own row inside their
  scoped session. The key is not passed through Redis or stored in job state.
- If Anthropic rejects a key mid-use (revoked) or the account is out of credit, the status becomes
  `needs_attention`, the user's feature call returns the reconnect message, and Account shows a
  "reconnect" prompt. The next successful save resets it.
- Spend remains bounded by each person's monthly limits and by the spend limit the guide tells them to
  set in their own Anthropic console.

## Frontend

- One reusable **Connect Claude** guide, five short steps with a link each:
  1. create an Anthropic account (console.anthropic.com);
  2. add a small amount of credit under Billing (link to Anthropic's pricing, no numbers that go stale);
  3. set a monthly spend limit;
  4. create a key on the API keys page, name it `trade-agent`, copy it at once (it is shown only once);
  5. paste it here and press "Check and save", then see "Connected" with the last four characters.
  Under it, a plain note: stored encrypted, used only for your own analyses and chat, removable at any
  time, and trade-agent never places trades. The exact menu names and links are checked against
  Anthropic's current pages when this is built.
- It appears in three places: a reminder card on Today when there is no key; the locked states of Chat and
  Run analysis ("Connect Claude to use this", opening the guide); and an Account panel showing the status,
  with Replace and Remove. The guide never shows a saved key, only the last four characters.
- The admin Users screen shows "Claude: connected" or "not connected" per person: a yes or no only.
- Everything else (Portfolio, Watchlist, Track record, Backtests, Preferences) works without a key.

## Other effects

- Deleting someone's data deletes their key row. The data export includes only "connected: yes or no".
- The audit and logs: connect and disconnect are logged by user id and the event name, with no key
  material.
- ARCHITECTURE gets the new table, the three routes and the new setting; the RUNBOOK gets the secret, its
  rotation and the loss scenario.

## Security review

This touches secrets, authentication-adjacent code and row-level security, so before the pull request
the security reviewer runs on the full diff. Points it must check: the key never in a response or log, no
code path that returns the ciphertext, the associated-data binding, the production start-up guard, the
rate limit on saving, and that no module keeps a decrypted key between requests.

## Testing

- Encryption: round trip, a different user's id fails, a tampered ciphertext fails, a new nonce each save.
- API: save stores only ciphertext (the plaintext is not in the table), the response has no key, an invalid
  format and an Anthropic rejection store nothing, rate limit, delete, another user cannot read or overwrite
  a row (row-level security, with the restricted runtime role).
- Use: a user's own key is the one passed to Anthropic; an admin without a personal key uses the server key;
  a user without a key gets `claude_key_required`; a revoked key flips the status; no key in logs (a test
  that captures log output across the save, use and failure paths).
- Frontend: the guide steps and the saved state, the locked Chat and Run analysis cards, the Today reminder,
  the Account panel, the admin yes or no.
- The `USER_TABLES` completeness test already forces the new table into the row-level-security list.

## Open points to confirm during implementation

- The current names and links in Anthropic's console, and whether listing models works with a key that has
  no credit (otherwise another zero-cost check is chosen).
- The exact Anthropic exception types for an invalid key, a billing problem and a network failure.
