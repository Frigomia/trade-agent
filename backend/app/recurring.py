"""Monthly expected entries. Only explicit confirmation changes a holding."""

import calendar
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta

from sqlalchemy.exc import DataError
from sqlalchemy.orm import Session

from app.db import lock_and_check_active
from app.limits import MAX_HOLDINGS, cap_message
from app.models import Holding, RecurringInvestment, RecurringOccurrence, Trade
from app.schemas import PlaceIn, TradeIn
from app.schemas_recurring import (
    OccurrenceOut,
    RecurringIn,
    RecurringListOut,
    RecurringOut,
    RecurringPreviewOut,
)
from app.trades import TOO_LARGE, TradeRefused, apply_trade


class RecurringRefused(Exception):
    def __init__(self, message: str, status_code: int = 409) -> None:
        super().__init__(message)
        self.status_code = status_code


def today() -> date:
    return datetime.now(UTC).date()


def scheduled_on_or_after(start: date, lower: date) -> date:
    """Always use the original day: February must not move a 31st plan to the 28th forever."""
    lower = max(start, lower)
    year, month = lower.year, lower.month
    candidate = date(year, month, min(start.day, calendar.monthrange(year, month)[1]))
    if candidate < lower:
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        candidate = date(year, month, min(start.day, calendar.monthrange(year, month)[1]))
    return candidate


def upcoming(start: date, lower: date) -> list[date]:
    dates: list[date] = []
    for _ in range(3):
        day = scheduled_on_or_after(start, lower)
        dates.append(day)
        lower = day + timedelta(days=1)
    return dates


def preview(payload: RecurringIn, *, editing: bool = False) -> RecurringPreviewOut:
    now = today()
    if editing:
        return RecurringPreviewOut(
            upcoming_dates=upcoming(payload.start_date, now + timedelta(days=1)), catch_up_count=0
        )
    day = payload.start_date
    count = 0
    while day <= now:
        count += 1
        day = scheduled_on_or_after(payload.start_date, day + timedelta(days=1))
    return RecurringPreviewOut(
        upcoming_dates=upcoming(payload.start_date, day), catch_up_count=count
    )


@contextmanager
def transaction(db: Session, user_id: uuid.UUID) -> Generator[None, None, None]:
    try:
        # Shared with trade writes and data deletion; never write after account removal.
        if not lock_and_check_active(db, user_id):
            raise RecurringRefused("This account is not active.", 403)
        yield
        db.commit()
    except (TradeRefused, DataError) as exc:
        db.rollback()
        message = str(exc) if isinstance(exc, TradeRefused) else TOO_LARGE
        raise RecurringRefused(message, 422) from None
    except Exception:
        db.rollback()
        raise


def _plan(db: Session, user_id: uuid.UUID, plan_id: int) -> RecurringInvestment:
    row = db.query(RecurringInvestment).filter_by(user_id=user_id, id=plan_id).one_or_none()
    if row is None:
        raise RecurringRefused("Recurring investment not found.", 404)
    return row


def _occurrence(db: Session, user_id: uuid.UUID, occurrence_id: int) -> RecurringOccurrence:
    row = db.query(RecurringOccurrence).filter_by(user_id=user_id, id=occurrence_id).one_or_none()
    if row is None:
        raise RecurringRefused("Occurrence not found.", 404)
    return row


def _materialize(db: Session, plan: RecurringInvestment, through: date) -> None:
    if plan.status != "active":
        return
    while plan.next_date <= through:
        db.add(
            RecurringOccurrence(
                user_id=plan.user_id,
                plan_id=plan.id,
                scheduled_date=plan.next_date,
                ticker=plan.ticker,
                asset_type=plan.asset_type,
                amount=plan.amount,
                currency=plan.currency,
                status="scheduled",
            )
        )
        plan.next_date = scheduled_on_or_after(plan.start_date, plan.next_date + timedelta(days=1))


def process_due(db: Session, user_id: uuid.UUID) -> None:
    with transaction(db, user_id):
        for plan in db.query(RecurringInvestment).filter_by(user_id=user_id, status="active"):
            _materialize(db, plan, today())


def plan_out(row: RecurringInvestment) -> RecurringOut:
    result = RecurringOut.model_validate(row)
    if row.status == "active":
        result.upcoming_dates = upcoming(row.start_date, row.next_date)
    else:
        result.next_date = None
    return result


def load(db: Session, user_id: uuid.UUID, *, reconcile: bool = True) -> RecurringListOut:
    if reconcile:
        process_due(db, user_id)
    return RecurringListOut(
        plans=[
            plan_out(p)
            for p in db.query(RecurringInvestment)
            .filter_by(user_id=user_id)
            .order_by(RecurringInvestment.id.desc())
        ],
        occurrences=[
            OccurrenceOut.model_validate(o)
            for o in db.query(RecurringOccurrence)
            .filter_by(user_id=user_id)
            .order_by(RecurringOccurrence.scheduled_date.desc(), RecurringOccurrence.id.desc())
        ],
    )


def save(
    db: Session, user_id: uuid.UUID, payload: RecurringIn, plan_id: int | None = None
) -> RecurringOut:
    with transaction(db, user_id):
        now = today()
        if plan_id is None:
            if db.query(RecurringInvestment).filter_by(user_id=user_id).count() >= 100:
                raise RecurringRefused("You can save at most 100 recurring investments.")
            row = RecurringInvestment(
                user_id=user_id, status="active", next_date=payload.start_date
            )
            db.add(row)
        else:
            row = _plan(db, user_id, plan_id)
            if row.status == "ended":
                raise RecurringRefused("An ended plan cannot be edited.")
            _materialize(db, row, now)
            row.next_date = scheduled_on_or_after(payload.start_date, now + timedelta(days=1))
        for field, value in payload.model_dump(exclude={"frequency"}).items():
            setattr(row, field, value)
        db.flush()  # a new plan's id is needed for its occurrences
        _materialize(db, row, now)
    return plan_out(row)


def set_status(db: Session, user_id: uuid.UUID, plan_id: int, status: str) -> RecurringOut:
    with transaction(db, user_id):
        row = _plan(db, user_id, plan_id)
        if row.status == "ended" and status != "ended":
            raise RecurringRefused("An ended plan cannot be resumed.")
        now = today()
        _materialize(db, row, now)
        if status == "active" and row.status == "paused":
            row.next_date = scheduled_on_or_after(row.start_date, now + timedelta(days=1))
        row.status = status
    return plan_out(row)


def set_occurrence_status(
    db: Session, user_id: uuid.UUID, occurrence_id: int, status: str
) -> OccurrenceOut:
    with transaction(db, user_id):
        row = _occurrence(db, user_id, occurrence_id)
        if row.status == "confirmed":
            raise RecurringRefused("A confirmed purchase cannot be skipped or reopened.")
        row.status = status
    return OccurrenceOut.model_validate(row)


def confirm(db: Session, user_id: uuid.UUID, occurrence_id: int, payload: PlaceIn) -> Trade:
    with transaction(db, user_id):
        row = _occurrence(db, user_id, occurrence_id)
        if row.trade_id is not None:
            trade = db.query(Trade).filter_by(user_id=user_id, id=row.trade_id).one()
        else:
            if row.status == "skipped":
                raise RecurringRefused("Reopen this occurrence before confirming it.")
            if payload.date > today():
                raise RecurringRefused("Enter the date of a purchase that already happened.", 422)
            holding = db.query(Holding).filter_by(user_id=user_id, ticker=row.ticker).one_or_none()
            if holding is None:
                if db.query(Holding).filter_by(user_id=user_id).count() >= MAX_HOLDINGS:
                    raise RecurringRefused(cap_message("holdings", MAX_HOLDINGS))
                holding = Holding(
                    user_id=user_id,
                    ticker=row.ticker,
                    name=row.ticker,
                    asset_type=row.asset_type,
                    shares=0,
                )
                db.add(holding)
            elif holding.asset_type != row.asset_type:
                raise RecurringRefused("The holding's asset type differs from this occurrence.")
            trade = apply_trade(
                db,
                user_id,
                holding,
                TradeIn(
                    date=payload.date,
                    ticker=row.ticker,
                    action="BUY",
                    shares=payload.shares,
                    price=payload.price,
                ),
            )
            db.flush()
            row.status, row.trade_id = "confirmed", trade.id
    return trade
