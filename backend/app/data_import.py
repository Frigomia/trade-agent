"""Restoring an exported data file into an empty account.

Every user table is classified here as data (its rows make the account non-empty) or settings
(they never do); a test fails when a new table ships unclassified. Restore itself lives below.
"""

import logging
from uuid import UUID

from sqlalchemy import exists, select
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from app import models  # noqa: F401  (registers every table on Base.metadata)
from app.db import Base, lock_and_check_active
from app.models import (
    ContributionPlan,
    ContributionPlanLine,
    Holding,
    InvestmentPreferences,
    PortfolioSnapshot,
    RecurringInvestment,
    RecurringOccurrence,
    Trade,
    WatchlistItem,
)
from app.schemas_import import (
    ImportFile,
    ImportHolding,
    ImportOccurrence,
    ImportPlan,
    ImportPreferences,
    ImportRecurring,
    ImportResultOut,
    ImportSnapshot,
    ImportTrade,
    ImportWatchlistItem,
)

logger = logging.getLogger(__name__)

# Rows in any of these make the account non-empty: they are what the import writes, so restoring
# into them would mix two histories.
DATA_TABLES: tuple[str, ...] = (
    "holdings",
    "watchlist_items",
    "trades",
    "portfolio_snapshots",
    "contribution_plans",
    "contribution_plan_lines",
    "recurring_investments",
    "recurring_occurrences",
)

# What the app produced by running (never in the import, never blocks it).
AI_OUTPUT_TABLES: tuple[str, ...] = (
    "recommendations",
    "scan_runs",
    "company_analyses",
    "chat_messages",
    "backtest_results",
)

# Per-account settings; a fresh account may already have them (a Claude key, a Telegram link).
SETTINGS_TABLES: tuple[str, ...] = (
    "investment_preferences",
    "user_api_keys",
    "telegram_links",
)

# The tables the import writes.
RESTORED_TABLES: tuple[str, ...] = (
    "holdings",
    "watchlist_items",
    "trades",
    "portfolio_snapshots",
    "contribution_plans",
    "contribution_plan_lines",
    "recurring_investments",
    "recurring_occurrences",
    "investment_preferences",
)

# The words the Account screen uses for each kind of data, for the refusal message.
DATA_LABELS = {
    "holdings": "holdings",
    "watchlist_items": "watchlist companies",
    "trades": "trades",
    "portfolio_snapshots": "saved daily values",
    "contribution_plans": "saved plans",
    "contribution_plan_lines": "saved plans",
    "recurring_investments": "recurring plans",
    "recurring_occurrences": "recurring entries",
}


def has_data_message(tables: list[str]) -> str:
    kinds = list(dict.fromkeys(DATA_LABELS[name] for name in tables))
    return (
        f"This account already has data ({', '.join(kinds)}), so it cannot be restored into. "
        "Import works only into an account without them; chats, other AI results and settings "
        'do not count. "Delete my data" clears the account first.'
    )


BROKEN_RULE_MESSAGE = (
    "This file could not be restored because a row breaks a rule the app keeps. "
    "Nothing was changed."
)


class ImportRefused(Exception):  # noqa: N818 - named for the domain, not an *Error
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def require_empty_account(db: Session, user_id: UUID) -> None:
    found = [
        name
        for name in DATA_TABLES
        if db.scalar(select(exists().where(Base.metadata.tables[name].c.user_id == user_id)))
    ]
    if found:
        raise ImportRefused(has_data_message(found), 409)


PREFERENCES_KEPT = "Your current preferences were kept."
AUTOMATIC_LEFT_OFF = (
    "Automatic analysis and automatic discovery were left off. "
    "Turn them on again in Preferences if you want them."
)
NEXT_STEPS = ["Connect Claude again.", "Connect Telegram again."]


def _restore_holdings(db: Session, user_id: UUID, holdings: list[ImportHolding]) -> int:
    # Copied as they are; the file's id, user_id and the fields read from the market are dropped.
    db.add_all(
        Holding(
            user_id=user_id,
            **h.model_dump(
                include={
                    "ticker",
                    "name",
                    "asset_type",
                    "shares",
                    "cost_basis",
                    "first_purchase_date",
                    "target_weight",
                    "sector",
                    "isin",
                }
            ),
        )
        for h in holdings
    )
    return len(holdings)


def _restore_watchlist(db: Session, user_id: UUID, items: list[ImportWatchlistItem]) -> int:
    db.add_all(
        WatchlistItem(user_id=user_id, **i.model_dump(exclude={"id", "user_id"})) for i in items
    )
    return len(items)


def _restore_trades(db: Session, user_id: UUID, trades: list[ImportTrade]) -> dict[int, int]:
    """Returns the file's trade id -> the new id, for the rows that point at a trade."""
    rows = [Trade(user_id=user_id, **t.model_dump(exclude={"id", "user_id"})) for t in trades]
    db.add_all(rows)
    db.flush()  # the new ids are assigned here
    return {t.id: row.id for t, row in zip(trades, rows, strict=True)}


def _restore_plans(
    db: Session, user_id: UUID, plans: list[ImportPlan], trade_ids: dict[int, int]
) -> int:
    """Each saved plan gets a new id and its nested lines are written under it. Oldest first, so
    the new ids keep the order the export lists them in (newest first by id)."""
    for plan in sorted(plans, key=lambda p: p.id):
        row = ContributionPlan(
            user_id=user_id,
            **plan.model_dump(
                include={"amount_eur", "whole_shares", "total_before_eur", "leftover_eur"}
            ),
            notes=plan.notes,
            left_out=[e.model_dump() for e in plan.left_out],
        )
        if plan.created_at is not None:  # else the column default stamps it
            row.created_at = plan.created_at
        db.add(row)
        db.flush()  # the new plan id is assigned here
        db.add_all(
            ContributionPlanLine(
                user_id=user_id,
                plan_id=row.id,
                placed_trade_id=trade_ids[line.placed_trade_id]  # KeyError rolls everything back
                if line.placed_trade_id is not None
                else None,
                **line.model_dump(
                    include={
                        "ticker",
                        "name",
                        "amount_eur",
                        "shares",
                        "price_eur",
                        "currency",
                        "rate",
                        "weight_before",
                        "weight_after",
                        "target_weight",
                        "reason",
                        "placed_at",
                    }
                ),
            )
            for line in plan.lines
        )
    return len(plans)


def _restore_recurring(
    db: Session,
    user_id: UUID,
    plans: list[ImportRecurring],
    occurrences: list[ImportOccurrence],
    trade_ids: dict[int, int],
) -> tuple[int, int]:
    """Plans keep their status and (when active) next date; occurrences keep their statuses and
    nothing is generated. Returns (plans, occurrences) written."""
    plan_ids: dict[int, int] = {}
    for plan in sorted(plans, key=lambda p: p.id):
        row = RecurringInvestment(
            user_id=user_id,
            # The export blanks next_date for a plan that is not active; the column is NOT NULL.
            # The resume flow recomputes it and the daily job only advances active plans.
            next_date=plan.next_date if plan.status == "active" else plan.start_date,
            **plan.model_dump(
                include={
                    "name",
                    "ticker",
                    "asset_type",
                    "source",
                    "amount",
                    "currency",
                    "start_date",
                    "status",
                }
            ),
        )
        db.add(row)
        db.flush()
        plan_ids[plan.id] = row.id
    # Oldest first, as with the plans: the export lists newest first.
    db.add_all(
        RecurringOccurrence(
            user_id=user_id,
            plan_id=plan_ids[o.plan_id],  # KeyError rolls everything back
            trade_id=trade_ids[o.trade_id] if o.trade_id is not None else None,
            **o.model_dump(
                include={"scheduled_date", "ticker", "asset_type", "amount", "currency", "status"}
            ),
        )
        for o in sorted(occurrences, key=lambda o: (o.scheduled_date, o.id or 0))
    )
    return len(plans), len(occurrences)


def _restore_snapshots(db: Session, user_id: UUID, snapshots: list[ImportSnapshot]) -> int:
    db.add_all(
        PortfolioSnapshot(user_id=user_id, **s.model_dump(exclude={"id"})) for s in snapshots
    )
    return len(snapshots)


def _restore_preferences(
    db: Session, user_id: UUID, prefs: ImportPreferences | None, skipped: list[str]
) -> int:
    if prefs is None:
        return 0
    if db.scalar(select(exists().where(InvestmentPreferences.user_id == user_id))):
        skipped.append(PREFERENCES_KEPT)
        return 0
    values = prefs.model_dump(
        include={
            "risk_tolerance",
            "sector_avoid_list",
            "notes",
            "monthly_contribution",
            "drift_threshold_pct",
        },
        exclude_none=True,  # a missing threshold takes the column default
    )
    # They spend model calls on a schedule, so a restored account never starts them by itself.
    db.add(
        InvestmentPreferences(user_id=user_id, auto_analysis=False, auto_discovery=False, **values)
    )
    if prefs.auto_analysis or prefs.auto_discovery:
        skipped.append(AUTOMATIC_LEFT_OFF)
    return 1


def restore_data(db: Session, user_id: UUID, file: ImportFile, *, dry_run: bool) -> ImportResultOut:
    """Write the file into the empty account in one transaction: all of it, or none of it.
    A dry run does everything except the commit."""
    try:
        # First: a parallel import or delete waits here, and a disabled or removed account
        # writes nothing.
        if not lock_and_check_active(db, user_id):
            raise ImportRefused("This account is not active.", 403)
        require_empty_account(db, user_id)
        skipped: list[str] = []
        restored = {
            "holdings": _restore_holdings(db, user_id, file.holdings),
            "watchlist_items": _restore_watchlist(db, user_id, file.watchlist_items),
        }
        trade_ids = _restore_trades(db, user_id, file.trades)
        restored["trades"] = len(trade_ids)
        restored["contribution_plans"] = _restore_plans(
            db, user_id, file.contribution_plans, trade_ids
        )
        restored["recurring_investments"], restored["recurring_occurrences"] = _restore_recurring(
            db, user_id, file.recurring_investments, file.recurring_occurrences, trade_ids
        )
        restored["portfolio_snapshots"] = _restore_snapshots(db, user_id, file.portfolio_snapshots)
        restored["investment_preferences"] = _restore_preferences(
            db, user_id, file.investment_preferences, skipped
        )
        db.flush()  # a constraint the file breaks fails here, in a dry run too
        if dry_run:
            db.rollback()
        else:
            db.commit()
    except (IntegrityError, DataError):
        db.rollback()
        # A rule or column limit the schema missed. Nothing from the exception goes out: it
        # carries row values.
        logger.warning("import refused")
        raise ImportRefused(BROKEN_RULE_MESSAGE, 422) from None
    except BaseException:
        db.rollback()
        raise
    logger.info(
        "data import %s: %s",
        "checked" if dry_run else "restored",
        " ".join(f"{name}={count}" for name, count in restored.items()),
    )
    return ImportResultOut(
        dry_run=dry_run, restored=restored, skipped=skipped, next_steps=list(NEXT_STEPS)
    )
