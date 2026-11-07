# Recurring estimate implementation

Reuse the recurring tables, authenticated router, per-user write lock, trade service and daily
scheduler. Manage plans in Portfolio drawers and the existing Add Holding and Log Trade flows.
Redirect the old Recurring route to Portfolio and remove its navigation tab.

Extend `models.py` / `schemas_recurring.py` for cadence and provenance; `recurring.py` for bounded
catch-up, prospective edits, overlap checks and corrections; `recurring_market.py` for listing
validation, exchange sessions, daily close and historical FX; `scheduled.py` for posting. Reuse
`fx.py` quote units and `trades.py` accounting. One recurring form reuses TickerPicker and drawers.

Schedules use Europe/Berlin dates. Month intervals retain the original day, clamped to month end.
Use the listing's daily close after the session closes and historical FX from that session or the
last published close, at most seven days old. A calendar dependency supplies holidays missing
from the repository. Never use a live price as a historical fill.

Legacy plans retain all fields and history, with automatic tracking disabled until reviewed.
Saving reviewed settings enables future tracking; old unconfirmed entries remain as skipped.
Confirmed entries and manual trades are untouched. Backfill requires preview and explicit approval;
refuse overlap with existing holdings or manual history rather than doubling shares.

There is no corporate-action ledger. Split-affected estimates are held for review. Corrections
replay later trades from the position saved before the estimate, refusing if the holding was
overwritten outside the ledger or a sale would become impossible. No frontend timer posts trades.

## Verification

Frontend lint, TypeScript and production build passed. Backend Ruff lint/format, mypy and application
imports passed. The independent security review's findings were addressed. Live PostgreSQL/Redis
integration and migration execution remain for CI; no migration was applied to user data locally.
