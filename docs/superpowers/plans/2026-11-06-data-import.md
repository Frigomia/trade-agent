# Import Your Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in person restores their own data from the file "Export my data" produces, into an empty account, with a preview first and all-or-nothing writes.

**Architecture:** The export gains `format_version`. A new `POST /me/import?dry_run=` route validates the file with a strict model (`app/schemas_import.py`), then a service (`app/data_import.py`) takes the per-person lock, checks the account is empty, creates new ids, rewrites the four id links and writes everything in one transaction (a dry run rolls back). The Account page gets a file chooser, a preview and a result panel (`ImportData`).

**Tech Stack:** FastAPI, SQLAlchemy 2 (sync), Pydantic v2, Postgres RLS, pytest; Next.js 16, MUI 9, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-06-data-import-design.md` (read it first; the owner approved it).

## Global Constraints

- Import works **only into an empty account**. Empty = no rows in holdings, watchlist_items, trades, recommendations, scan_runs, company_analyses, chat_messages, backtest_results, portfolio_snapshots, contribution_plans, contribution_plan_lines, recurring_investments, recurring_occurrences. Preferences, the Claude key (`user_api_keys`) and the Telegram link are not data for this rule.
- **Restored:** holdings, watchlist, trades, preferences, saved contribution plans (with lines), recurring plans and their occurrences, portfolio snapshots. **Never restored, in any version:** recommendations, scan runs, company analyses, chat messages, backtest results (AI output), Telegram settings, the Claude key, the profile (id, email, role, status, dates), usage and limits.
- Preferences are restored **only if the account has no preferences row**; otherwise the current ones stay and the result says so.
- The file's `user_id` and every `id` are never reused: every row gets the caller's id and a new id; links are rewritten (occurrence `plan_id` and `trade_id`, plan line `plan_id` and `placed_trade_id`). A link to something missing from the file makes the file invalid.
- Rows are copied, never replayed: no trade logic, no recomputing holdings from trades, no occurrence regeneration.
- One transaction; `lock_user_for_insert(db, user_id)` is the first statement. Any error rolls back everything.
- No model calls and no change to usage allowances. No raw exception text logged or returned; the only log line is the counts.
- Responses carry `Cache-Control: no-store` (`no_store`). The route is rate limited.
- Backend rules (`backend/AGENTS.md`): thin router, service raises a domain exception, Pydantic v2 only, type hints everywhere, `uv run ruff check --fix` on changed files, then `uv run mypy app` and `uv run python -m pytest tests/ -v`. Frontend rules (`frontend/AGENTS.md`): `apiFetch` only, `useAction`, named exports, rem font sizes, Soft tokens, tests next to the code; finish with lint, `npx tsc --noEmit`, tests and `npm run build`.
- Commit messages are Conventional Commits and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit only when the owner says so; never skip GPG signing.

## Calls made in this plan beyond the spec (the owner should check these)

- The import route's body limit is 5 MB, applied only to `/me/import` and only when a Bearer token is present (an anonymous caller keeps 64 KB). The 64 KB global cap would otherwise reject any real export. Residual exposure: any caller with some Bearer header can make the server buffer up to 5 MB on that one path before auth rejects them.
- Restored preferences come back with `auto_analysis` and `auto_discovery` **off** and the result says so, because those switches run paid model calls on a schedule.
- A file with nothing restorable is refused ("This file has nothing to restore.").
- The route is rate limited to 5 requests a minute; refusals map to 409 (account has data) and 422 (invalid file).
- The validation-error handler in `main.py` stops echoing the request body for `/me/import`.

## Review Focus

Inputs the spec implies but a straight reading misses, most likely first. Each has a test in the task named.

1. **Anything over 64 KB.** `app/body_limit.py` rejects every non-GET body over 64 KB before auth. A real export is bigger. (Task 2)
2. **The 422 echo.** `main.py` returns the request body as `input` in a validation error for every route except `/me/claude-key`; for an import that would echo the whole file back. (Task 7)
3. **Switches that spend money.** Restored preferences carry `auto_analysis` and `auto_discovery` (scheduled model runs). They must come back **off**. (Task 5)
4. **A file that is not an export:** invalid JSON, a JSON array, wrong types, numbers as strings, `NaN`/`Infinity`. A clear 422, never a 500. (Task 3)
5. **Duplicates inside the file:** two holdings or two watchlist items with the same ticker, two occurrences on one plan and date, one trade attached to two occurrences. A clear refusal, never a database error. (Task 3)
6. **Two imports at once, or an import twice.** The second sees a non-empty account and is refused. (Task 7)
7. **A file with nothing to restore** (every restorable list empty): refused with "This file has nothing to restore." (Task 3)

---

### Task 1: The export carries a format version

**Files:**
- Modify: `backend/app/schemas.py` (`ExportOut`, around line 559)
- Test: `backend/tests/test_me_router.py`

**Interfaces:**
- Produces: `ExportOut.format_version: int = 1` (inherited by `RecurringExportOut`), and `EXPORT_FORMAT_VERSION: int = 1` in `app/schemas.py` for the import to compare against.

- [ ] **Step 1: Write the failing test** `test_export_has_a_format_version` in `tests/test_me_router.py`: `client.get("/me/export").json()["format_version"] == 1`.
- [ ] **Step 2: Run it** (`uv run python -m pytest tests/test_me_router.py::test_export_has_a_format_version -v`). Expected: FAIL (KeyError).
- [ ] **Step 3: Add** `EXPORT_FORMAT_VERSION = 1` and the field `format_version: int = EXPORT_FORMAT_VERSION` to `ExportOut`.
- [ ] **Step 4: Run** the test and the whole `tests/test_me_router.py`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add a format version to the data export`.

### Task 2: A larger body limit for the import route only

**Files:**
- Modify: `backend/app/body_limit.py`
- Test: `backend/tests/test_body_limit.py`

**Interfaces:**
- Produces: `LARGE_BODY_LIMITS: dict[str, int] = {"/me/import": 5 * 1024 * 1024}`. `BodySizeLimitMiddleware` uses the path's limit instead of `max_bytes` **only when** the request carries an `Authorization` header starting with `Bearer ` (an unauthenticated caller keeps 64 KB; the header is checked for presence only, not validity, since auth runs later). The path match is `scope["path"].endswith(key)`, as `main.py` does for `/me/claude-key`.

- [ ] **Step 1: Write failing tests**, following the file's existing style: `test_import_path_accepts_a_body_over_64kb_with_a_bearer_token`, `test_import_path_still_rejects_over_5mb`, `test_import_path_without_a_bearer_token_keeps_the_64kb_limit`, `test_other_paths_keep_the_64kb_limit_even_with_a_token`.
- [ ] **Step 2: Run them.** Expected: the first fails with 413.
- [ ] **Step 3: Implement** the per-path limit in `__call__` (read the limit once, use it for the declared-length check and the counting receive).
- [ ] **Step 4: Run** `tests/test_body_limit.py`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: allow a larger request body on the import route`.

### Task 3: The import file model and its validation

**Files:**
- Create: `backend/app/schemas_import.py`
- Test: `backend/tests/test_schemas_import.py`

**Interfaces:**
- Consumes: `Ticker`, `AssetType`, `HoldingIn`, `TradeIn`, `RecurringIn`-style rules from `app/schemas.py` / `app/schemas_recurring.py`; `EXPORT_FORMAT_VERSION`.
- Produces:
  - `class ImportFile(BaseModel)` with `format_version: int = EXPORT_FORMAT_VERSION`, the restorable lists (`holdings`, `watchlist_items`, `trades`, `portfolio_snapshots`, `contribution_plans`, `recurring_investments`, `recurring_occurrences`, each default empty) and `investment_preferences: ImportPreferences | None = None`. Unknown top-level keys (the data we do not restore, `profile`, `telegram`, ...) are **ignored**. A `model_validator(mode="after")` raises `ValueError` (the message is shown to the person) for: a version other than 1, nothing to restore ("This file has nothing to restore."), a duplicate holding or watchlist ticker, a duplicate `(plan id, scheduled_date)` occurrence, an occurrence whose `plan_id` is not in `recurring_investments`, a `confirmed` occurrence with no `trade_id` or one whose trade is not in `trades`, a non-confirmed one with a `trade_id`, a plan line `placed_trade_id` not in `trades`, one trade used by two occurrences, and a list longer than its limit (`MAX_HOLDINGS` for holdings, `MAX_PLANS` for contribution plans; the rest from `IMPORT_LIST_LIMITS: dict[str, int]` defined in this file, sized from a realistic export plus headroom).
  - Item models for each restorable list. They **reject unknown fields** (`extra="forbid"`) and accept every field the export emits for that list, including the ones the importer ignores (`id` is kept as the link key; `user_id` and computed-only fields such as the holding's `industry`, `country`, `currency` and the plan line's `placed_shares`, `placed_price`, `reason_text`, `upcoming_dates`, `next_date` where not stored are accepted and dropped). Field rules reuse the existing input rules (ticker pattern, `ge`/`le`, text patterns with no control characters).
  - `ImportPreferences`: the `PreferencesIn` rules; `auto_analysis` and `auto_discovery` are accepted from the file but the service forces both to `False` (see Task 5).
  - `class ImportResultOut(BaseModel)`: `dry_run: bool`, `restored: dict[str, int]`, `skipped: list[str]`, `next_steps: list[str]`.

- [ ] **Step 1: Write the failing tests** in `tests/test_schemas_import.py`: `test_a_real_export_validates` (build the file from the `client`'s `/me/export` after seeding with `ROW_FACTORIES`, drop the AI output tables, and validate), `test_an_unknown_field_in_a_restored_list_is_rejected`, `test_ignored_top_level_keys_are_accepted` (a `profile` with `role: admin` validates and is not part of the model), `test_nothing_to_restore_is_refused` (message text above), `test_a_future_version_is_refused`, `test_duplicate_holding_tickers_are_refused`, `test_duplicate_occurrence_dates_are_refused`, `test_an_occurrence_pointing_at_a_missing_plan_is_refused`, `test_a_confirmed_occurrence_needs_its_trade_in_the_file`, `test_one_trade_cannot_confirm_two_occurrences`, `test_a_plan_line_pointing_at_a_missing_trade_is_refused`, `test_nan_and_infinity_are_refused`, `test_a_list_over_its_limit_is_refused`.
- [ ] **Step 2: Run them.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the models as specified; one validator per rule, each with a plain-language message.
- [ ] **Step 4: Run** `tests/test_schemas_import.py`. Expected: PASS. Run `uv run ruff check --fix app/schemas_import.py tests/test_schemas_import.py` and `uv run mypy app`.
- [ ] **Step 5: Commit** `feat: add the import file model and its checks`.

### Task 4: The empty-account check and the table classification

**Files:**
- Create: `backend/app/data_import.py`
- Test: `backend/tests/test_data_import.py`

**Interfaces:**
- Consumes: `app.rls.USER_TABLES`, `app.db.Base`, `app.models`.
- Produces in `app/data_import.py`:
  - `RESTORED_TABLES`, `EMPTY_CHECK_TABLES`, `EXEMPT_TABLES`: tuples of table names that together cover exactly `rls.USER_TABLES` (`EXEMPT_TABLES = ("investment_preferences", "user_api_keys", "telegram_links")`; `RESTORED_TABLES` lists the tables that are written; `EMPTY_CHECK_TABLES` lists the data tables checked, including the AI-output ones that are checked but never written).
  - `class ImportRefused(Exception)` with `message: str` and `status_code: int`; the account-has-data refusal is `status_code=409`, an invalid file is `422`.
  - `def require_empty_account(db: Session, user_id: UUID) -> None`: raises `ImportRefused` (409, "This account already has data, so it cannot be restored into. Import works only into an empty account.") when any `EMPTY_CHECK_TABLES` table has a row for the user.

- [ ] **Step 1: Write the failing tests**: `test_every_user_table_is_classified` (the union of the three tuples equals `set(rls.USER_TABLES)` with no overlap; this fails when a new table ships unclassified), `test_a_fresh_account_is_empty`, `test_settings_do_not_count_as_data` (a preferences row and a telegram link: still empty), and one parametrized `test_each_data_table_makes_the_account_non_empty` over `EMPTY_CHECK_TABLES` using `ROW_FACTORIES[table](USER_ID)`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the constants, the exception and `require_empty_account` (one `EXISTS` per table through `Base.metadata.tables[name]`).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the empty-account check for the import`.

### Task 5: Restore the rows that do not link to each other

**Files:**
- Modify: `backend/app/data_import.py`
- Test: `backend/tests/test_data_import.py`

**Interfaces:**
- Consumes: `ImportFile`, `ImportResultOut`, `require_empty_account`, `lock_user_for_insert`.
- Produces: `def restore_data(db: Session, user_id: UUID, file: ImportFile, *, dry_run: bool) -> ImportResultOut`. It takes the lock first, calls `require_empty_account`, writes, and either `commit()` or (dry run) `rollback()`; on any exception it rolls back and re-raises. This task writes holdings, watchlist items, trades, portfolio snapshots and preferences; Task 6 adds the linked tables to the same function. `restored` counts per list; `skipped` and `next_steps` as below.
- Rules: holdings and trades are copied as they are (no trade logic). Snapshots keep their `created_at`. Preferences are written only when the account has no `investment_preferences` row, with `auto_analysis=False` and `auto_discovery=False` (they spend model calls on a schedule); otherwise `skipped` gets "Your current preferences were kept." When the file's preferences had either switch on and were restored, `skipped` gets "Automatic analysis and automatic discovery were left off. Turn them on again in Preferences if you want them." `next_steps` always includes "Connect Claude again." and "Connect Telegram again."

- [ ] **Step 1: Write the failing tests**: `test_restores_holdings_watchlist_trades_and_snapshots` (counts and values, new ids, the caller's `user_id`), `test_the_file_user_id_and_ids_are_ignored`, `test_holdings_and_trades_are_copied_not_replayed` (a holding's shares and cost basis equal the file's even though the trades would imply otherwise), `test_preferences_restored_with_automatic_runs_off`, `test_existing_preferences_are_kept`, `test_a_dry_run_writes_nothing_and_returns_the_counts`, `test_a_failure_part_way_leaves_the_account_empty` (patch the snapshot insert to raise after holdings were added; assert every table is still empty), `test_a_non_empty_account_is_refused_before_any_write`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `restore_data` (bulk `session.add_all` per list, one flush, then commit). Log one line with the counts only.
- [ ] **Step 4: Run** `tests/test_data_import.py`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: restore holdings, watchlist, trades, snapshots and preferences`.

### Task 6: Restore plans, recurring plans and rewrite the links

**Files:**
- Modify: `backend/app/data_import.py`
- Test: `backend/tests/test_data_import.py`

**Interfaces:**
- Consumes: Task 5's `restore_data`; the `ImportFile` item models with their old `id`s.
- Produces: `restore_data` also writes `contribution_plans` and their `contribution_plan_lines` (old plan `id` to new, `placed_trade_id` mapped through the new trade ids), `recurring_investments` and `recurring_occurrences` (`plan_id` and `trade_id` mapped). Trades are inserted first and flushed so their new ids exist; the maps are `dict[int, int]` from old to new. `left_out` and `notes` JSON are copied. Occurrences are copied with their statuses; nothing is regenerated.

- [ ] **Step 1: Write the failing tests**: `test_plans_and_their_lines_are_restored_with_new_ids`, `test_a_placed_line_points_at_the_new_trade`, `test_recurring_plans_and_occurrences_are_restored_and_linked`, `test_a_confirmed_occurrence_points_at_the_new_trade`, `test_no_occurrences_are_generated` (counts equal the file's), `test_the_database_rules_hold_after_restore` (query: every confirmed occurrence has a trade, no duplicate plan-date pair), and the round-trip `test_export_import_export_matches` (seed through `ROW_FACTORIES`, export, delete through `delete_user_data`, import the export, export again; compare every restored list ignoring ids and `created_at`, and assert the AI-output lists are empty in the second export).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the id maps and the four rewrites; use the maps for both link kinds.
- [ ] **Step 4: Run** `tests/test_data_import.py`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: restore plans and recurring plans with their links`.

### Task 7: The route, the error mapping and the hostile files

**Files:**
- Modify: `backend/app/routers/me.py` (new route on `active_router`), `backend/app/main.py` (handler for `ImportRefused`; add `/me/import` to the path check that drops the echoed `input` in `_validation_error_without_input`)
- Test: `backend/tests/test_me_router.py`

**Interfaces:**
- Consumes: `ImportFile`, `ImportResultOut`, `restore_data`, `ImportRefused`, `rate_limiter`, `no_store`.
- Produces: `POST /me/import?dry_run=false` on `active_router` (active users only), `response_model=ImportResultOut`, `dependencies=[Depends(no_store), Depends(rate_limiter("import", limit=5))]`, a plain `def` route taking `file: ImportFile`, `dry_run: bool = False`, `user`, `db = Depends(get_user_db)`. `ImportRefused` maps to `JSONResponse(status_code=exc.status_code, content={"detail": exc.message})`, like `RecurringRefused`.

- [ ] **Step 1: Write the failing tests** in `tests/test_me_router.py`: `test_import_restores_into_an_empty_account` (HTTP, using a file built from the export), `test_import_dry_run_returns_counts_and_writes_nothing`, `test_import_is_refused_with_409_when_the_account_has_data`, `test_importing_twice_is_refused_the_second_time`, `test_import_is_403_for_an_invited_user`, `test_import_is_401_without_a_token`, `test_import_ignores_a_role_and_a_user_id_in_the_file` (a file with `profile.role = "admin"` and another person's `user_id` on rows: the caller's `app_users` row is unchanged and no rows exist for the other person), `test_a_file_that_is_not_json_or_is_an_array_is_422`, `test_a_validation_error_does_not_echo_the_file` (the 422 body contains no `input` key and none of the file's values), `test_import_is_rate_limited` (follow the existing rate-limit test style), `test_import_response_is_no_store`, `test_no_raw_error_text_in_the_response` (a forced failure returns a generic message).
- [ ] **Step 2: Run them.** Expected: FAIL (404 on the route).
- [ ] **Step 3: Implement** the route (about five lines, per the thin-router rule), the handler, and the path check in `main.py`.
- [ ] **Step 4: Run** `uv run python -m pytest tests/ -v`, then `uv run ruff check --fix` on every changed file and `uv run mypy app`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat: add the import route`.

### Task 8: The Account page: choose, preview, confirm, result

**Files:**
- Create: `frontend/lib/api/import-types.ts`, `frontend/lib/importFile.ts`, `frontend/lib/importFile.test.ts`, `frontend/components/account/ImportData.tsx`, `frontend/components/account/ImportData.test.tsx`
- Modify: `frontend/components/account/DataActions.tsx` (render `<ImportData />` under "Export my data"), `frontend/components/account/DataActions.test.tsx` only if its queries break

**Interfaces:**
- Produces:
  - `ImportResult` in `import-types.ts`: `{ dry_run: boolean; restored: Record<string, number>; skipped: string[]; next_steps: string[] }`.
  - `readImportFile(file: File): Promise<string>` in `lib/importFile.ts`: rejects a file over `MAX_IMPORT_BYTES = 5 * 1024 * 1024` and text that is not valid JSON or not a JSON object, with the messages "That file is too large to import." and "That is not a trade-agent export file."; resolves with the original text.
  - `ImportData` (named export, no props): a "Import my data" button opening a hidden `<input type="file" accept="application/json">`; states idle, checking, preview, importing, done. The preview lists the counts (human labels, zero counts hidden) with "Restore" and "Cancel"; a refusal (the server's `detail`) shows in an error `Alert` with no restore button; the result lists what was restored, `skipped` and `next_steps`. Calls `apiFetch("/me/import?dry_run=true", { method: "POST", body: text })` then, on confirm, `apiFetch("/me/import", ...)` with the same text; uses `useAction`. After a successful restore it runs `mutate(() => true, undefined, { revalidate: true })` so the screens reload. Sizes in rem, Soft tokens, 44px targets, no trade wording.

- [ ] **Step 1: Write the failing tests.** `importFile.test.ts`: `rejects_a_file_over_5mb`, `rejects_text_that_is_not_json`, `rejects_a_json_array`, `returns_the_text_of_a_valid_object`. `ImportData.test.tsx` (mock `@/lib/api/client` as in `DataActions.test.tsx`): `choosing_a_file_runs_a_dry_run_and_shows_the_counts`, `confirming_sends_the_same_file_without_dry_run`, `a_refusal_shows_the_server_message_and_no_restore_button`, `a_bad_file_never_calls_the_server`, `cancel_returns_to_idle`, `the_result_lists_skipped_and_next_steps`, `the_button_is_disabled_while_a_request_runs`.
- [ ] **Step 2: Run them** (`npx vitest run lib/importFile.test.ts components/account/ImportData.test.tsx`). Expected: FAIL.
- [ ] **Step 3: Implement** the files above; render `ImportData` in `DataActions` beside the export button.
- [ ] **Step 4: Run** the new tests and `components/account`, then `npx tsc --noEmit` and `npx eslint .`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the import flow to the Account page`.

### Task 9: Docs and the final check

**Files:**
- Modify: `docs/ARCHITECTURE.md` (the API list: `POST /me/import`; the export section: `format_version`; the body limit), `DESIGN.md` (the Account screen's import action), `docs/RUNBOOK.md` only if it describes the export in a way the import changes

- [ ] **Step 1: Update** the three documents so each states what the code now does (the route and its refusal rules, the version field, the larger body limit on that one route).
- [ ] **Step 2: Run the full checks.** Backend: `uv run ruff check . && uv run mypy app && uv run python -m pytest tests/ -v`. Frontend: `npm run lint && npx tsc --noEmit && npm test && npm run build`. Expected: all pass.
- [ ] **Step 3: Browser pass** against the dev server: export, delete my data, import the file, confirm holdings, trades and plans are back and the result panel lists "Connect Claude again" and "Connect Telegram again"; try the same file again (refused); try a non-JSON file; check 320px, 390px and 1280px, light and dark.
- [ ] **Step 4: Commit** `docs: describe the data import`.
