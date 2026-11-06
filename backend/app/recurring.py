"""Recurring estimates: date-only schedules and an auditable trade ledger."""

import calendar
import logging
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

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
from app.trades import STORED_MAX, TOO_LARGE, TradeRefused, apply_trade


class RecurringRefused(Exception):
    def __init__(self, message: str, status_code: int = 409) -> None:
        super().__init__(message)
        self.status_code = status_code


def today() -> date:
    return datetime.now(ZoneInfo("Europe/Berlin")).date()


def scheduled_on_or_after(start: date, lower: date, count: int = 1, unit: str = "months") -> date:
    """Anchor intervals to the original start; clamp individual months, not the anchor."""
    lower = max(start, lower)
    if unit != "months":
        step = count * (7 if unit == "weeks" else 1)
        days = (lower - start).days
        return start + timedelta(days=((days + step - 1) // step) * step)
    months = (lower.year - start.year) * 12 + lower.month - start.month
    offset = (months // count) * count

    def at(n: int) -> date:
        year, month = divmod(start.year * 12 + start.month - 1 + n, 12)
        return date(year, month + 1, min(start.day, calendar.monthrange(year, month + 1)[1]))

    candidate = at(offset)
    return at(offset + count) if candidate < lower else candidate


def upcoming(
    start: date, lower: date, count: int = 1, unit: str = "months", end: date | None = None
) -> list[date]:
    dates: list[date] = []
    for _ in range(3):
        day = scheduled_on_or_after(start, lower, count, unit)
        if end is not None and day > end:
            break
        dates.append(day)
        lower = day + timedelta(days=1)
    return dates


def _next(plan: RecurringInvestment, lower: date) -> date:
    return scheduled_on_or_after(plan.start_date, lower, plan.interval_count, plan.interval_unit)


def _overlap(db: Session, user_id: uuid.UUID, ticker: str) -> bool:
    return (
        db.query(Holding.id).filter_by(user_id=user_id, ticker=ticker).first() is not None
        or db.query(Trade.id).filter_by(user_id=user_id, ticker=ticker).first() is not None
    )


def preview(
    payload: RecurringIn,
    *,
    editing: bool = False,
    db: Session | None = None,
    user_id: uuid.UUID | None = None,
) -> RecurringPreviewOut:
    now = today()
    day = payload.start_date
    past: list[date] = []
    if not editing:
        while day < now and (payload.end_date is None or day <= payload.end_date):
            past.append(day)
            if len(past) > 10000:
                raise RecurringRefused("Backfill is limited to 10,000 occurrences.", 422)
            day = scheduled_on_or_after(
                payload.start_date,
                day + timedelta(days=1),
                payload.interval_count,
                payload.interval_unit,
            )
    lower = max(day, now + timedelta(days=1)) if editing else max(day, now)
    conflict = None
    if past and db is not None and user_id is not None and _overlap(db, user_id, payload.ticker):
        conflict = "Existing holdings or trades overlap. Start after today to avoid duplicates."
    return RecurringPreviewOut(
        upcoming_dates=upcoming(
            payload.start_date,
            lower,
            payload.interval_count,
            payload.interval_unit,
            payload.end_date,
        ),
        catch_up_count=len(past),
        first_date=past[0] if past else None,
        last_date=past[-1] if past else None,
        conflict=conflict,
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
    for _ in range(100):
        if plan.next_date > through or (
            plan.end_date is not None and plan.next_date > plan.end_date
        ):
            break
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
        plan.next_date = _next(plan, plan.next_date + timedelta(days=1))


def process_due(db: Session, user_id: uuid.UUID) -> None:
    if (
        db.query(RecurringInvestment.id)
        .filter_by(user_id=user_id, status="active", tracking_enabled=True)
        .filter(RecurringInvestment.next_date <= today())
        .first()
        is None
    ):
        return
    with transaction(db, user_id):
        for plan in db.query(RecurringInvestment).filter_by(
            user_id=user_id, status="active", tracking_enabled=True
        ):
            _materialize(db, plan, today())


def plan_out(row: RecurringInvestment) -> RecurringOut:
    result = RecurringOut.model_validate(row)
    if row.status == "active":
        result.upcoming_dates = upcoming(
            row.start_date, row.next_date, row.interval_count, row.interval_unit, row.end_date
        )
    else:
        result.next_date = None
    if not result.upcoming_dates:
        result.next_date = None
    return result


def load(db: Session, user_id: uuid.UUID, *, reconcile: bool = True) -> RecurringListOut:
    # Reads never generate or post estimates; the server job owns catch-up.
    return RecurringListOut(
        plans=[
            plan_out(p)
            for p in db.query(RecurringInvestment)
            .filter_by(user_id=user_id)
            .order_by(RecurringInvestment.id.desc())
        ],
        occurrences=[
            occurrence_out(db, o)
            for o in db.query(RecurringOccurrence)
            .filter_by(user_id=user_id)
            .order_by(RecurringOccurrence.scheduled_date.desc(), RecurringOccurrence.id.desc())
        ],
    )


def save(
    db: Session,
    user_id: uuid.UUID,
    payload: RecurringIn,
    plan_id: int | None = None,
    *,
    exchange: str | None = None,
) -> RecurringOut:
    with transaction(db, user_id):
        now = today()
        if plan_id is None:
            if payload.start_date < now:
                result = preview(payload, db=db, user_id=user_id)
                if result.conflict:
                    raise RecurringRefused(result.conflict)
                if not payload.backfill:
                    raise RecurringRefused(
                        "Preview and approve the historical estimates first.", 422
                    )
            if db.query(RecurringInvestment).filter_by(user_id=user_id).count() >= 100:
                raise RecurringRefused("You can save at most 100 recurring investments.")
            row = RecurringInvestment(
                user_id=user_id,
                status="active",
                next_date=payload.start_date,
                tracking_enabled=True,
            )
            db.add(row)
        else:
            row = _plan(db, user_id, plan_id)
            if row.status == "ended":
                raise RecurringRefused("An ended plan cannot be edited.")
            if row.ticker != payload.ticker or row.asset_type != payload.asset_type:
                raise RecurringRefused("Create a separate plan to change the instrument.", 422)
            if row.tracking_enabled:
                _materialize(db, row, now)
                if (
                    row.status == "active"
                    and row.next_date <= now
                    and (row.end_date is None or row.next_date <= row.end_date)
                ):
                    raise RecurringRefused(
                        "Catch-up is outstanding. Pause to cancel it or wait before editing."
                    )
            else:
                for old in db.query(RecurringOccurrence).filter_by(
                    user_id=user_id, plan_id=row.id, status="scheduled"
                ):
                    old.status = "skipped"
            row.next_date = scheduled_on_or_after(
                payload.start_date,
                now + timedelta(days=1),
                payload.interval_count,
                payload.interval_unit,
            )
            row.tracking_enabled = True
        for field, value in payload.model_dump(exclude={"backfill", "source"}).items():
            setattr(row, field, value)
        row.exchange = exchange
        db.flush()  # a new plan's id is needed for its occurrences
        _materialize(db, row, now)
    return plan_out(row)


def set_status(db: Session, user_id: uuid.UUID, plan_id: int, status: str) -> RecurringOut:
    with transaction(db, user_id):
        row = _plan(db, user_id, plan_id)
        if row.status == "ended" and status != "ended":
            raise RecurringRefused("An ended plan cannot be resumed.")
        now = today()
        if row.tracking_enabled:
            _materialize(db, row, now)
        if status == "active" and row.status == "paused":
            row.next_date = _next(row, now + timedelta(days=1))
        if status != "active":
            for pending in db.query(RecurringOccurrence).filter_by(
                user_id=user_id, plan_id=row.id, status="scheduled"
            ):
                pending.status = "skipped"
        if status == "active" and not row.tracking_enabled:
            raise RecurringRefused("Review and save this legacy plan before enabling estimates.")
        row.status = status
    return plan_out(row)


def set_occurrence_status(
    db: Session, user_id: uuid.UUID, occurrence_id: int, status: str
) -> OccurrenceOut:
    with transaction(db, user_id):
        row = _occurrence(db, user_id, occurrence_id)
        if row.trade_id is not None:
            raise RecurringRefused("A confirmed purchase cannot be skipped or reopened.")
        if status == "scheduled" and _plan(db, user_id, row.plan_id).tracking_enabled:
            raise RecurringRefused("Skipped automatic estimates cannot be reopened.")
        row.status = status
    return OccurrenceOut.model_validate(row)


def confirm(db: Session, user_id: uuid.UUID, occurrence_id: int, payload: PlaceIn) -> Trade:
    with transaction(db, user_id):
        row = _occurrence(db, user_id, occurrence_id)
        if row.trade_id is not None:
            trade = db.query(Trade).filter_by(user_id=user_id, id=row.trade_id).one()
        else:
            if _plan(db, user_id, row.plan_id).tracking_enabled:
                raise RecurringRefused("Automatic estimates do not require purchase confirmation.")
            if row.status == "skipped":
                raise RecurringRefused("Reopen this occurrence before confirming it.")
            # A provider's local purchase date can be one day ahead of UTC.
            if payload.date > today() + timedelta(days=1):
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


def occurrence_out(db: Session, row: RecurringOccurrence) -> OccurrenceOut:
    result = OccurrenceOut.model_validate(row)
    if row.trade_id is not None:
        trade = db.query(Trade).filter_by(user_id=row.user_id, id=row.trade_id).one_or_none()
        if trade is not None:
            result.shares = Decimal(str(trade.shares))
            result.price = Decimal(str(trade.price))
            result.trade_date = trade.date
    return result


async def validated_save(
    db: Session,
    user_id: uuid.UUID,
    payload: RecurringIn,
    plan_id: int | None = None,
) -> RecurringOut:
    from app.recurring_market import MarketUnavailable, instrument

    try:
        listing = await instrument(payload.ticker, payload.asset_type)
    except MarketUnavailable as exc:
        raise RecurringRefused(str(exc), 422) from None
    # Listing identity and display name come from the provider, never a client-supplied index name.
    return save(
        db,
        user_id,
        payload.model_copy(update={"name": listing["name"] if plan_id is None else payload.name}),
        plan_id,
        exchange=listing["exchange"],
    )


def _position(holding: Holding) -> dict[str, object]:
    return {
        "shares": str(holding.shares),
        "basis": None if holding.cost_basis is None else str(holding.cost_basis),
        "first": holding.first_purchase_date.isoformat() if holding.first_purchase_date else None,
    }


async def post_due(db: Session, user_id: uuid.UUID) -> tuple[int, int]:
    """One bounded pass: the same user lock guards plans, occurrences, trade and holding writes."""
    from app.recurring_market import MarketUnavailable, estimate

    process_due(db, user_id)
    ids = [
        r[0]
        for r in db.query(RecurringOccurrence.id)
        .join(RecurringInvestment, RecurringInvestment.id == RecurringOccurrence.plan_id)
        .filter(
            RecurringOccurrence.user_id == user_id,
            RecurringOccurrence.status == "scheduled",
            RecurringInvestment.user_id == user_id,
            RecurringInvestment.status == "active",
            RecurringInvestment.tracking_enabled.is_(True),
        )
        .order_by(RecurringOccurrence.scheduled_date, RecurringOccurrence.id)
        .limit(100)
    ]
    posted = waiting = 0
    blocked: set[str] = set()
    for occurrence_id in ids:
        row = _occurrence(db, user_id, occurrence_id)
        ticker, asset_type, scheduled, currency = (
            row.ticker,
            row.asset_type,
            row.scheduled_date,
            row.currency,
        )
        if ticker in blocked:
            continue
        earliest = (
            db.query(RecurringOccurrence.scheduled_date)
            .filter(
                RecurringOccurrence.user_id == user_id,
                RecurringOccurrence.ticker == ticker,
                RecurringOccurrence.trade_id.is_not(None),
            )
            .order_by(RecurringOccurrence.scheduled_date)
            .first()
        )
        db.rollback()  # Release the read transaction for I/O; recheck under the write lock.
        try:
            quote = await estimate(
                ticker, asset_type, scheduled, currency, earliest[0] if earliest else None
            )
            error = None
        except MarketUnavailable as exc:
            error = str(exc)
            quote = None
        with transaction(db, user_id):
            db.expire_all()
            row = _occurrence(db, user_id, occurrence_id)
            plan = _plan(db, user_id, row.plan_id)
            if row.status != "scheduled" or plan.status != "active" or not plan.tracking_enabled:
                continue
            row.attempts += 1
            if quote is None:
                blocked.add(ticker)
                row.error = error
                waiting += 1
                logging.getLogger(__name__).warning(
                    "Recurring occurrence %s: waiting (%s)", row.id, error
                )
                continue
            shares = (Decimal(str(row.amount)) * quote.fx_rate / quote.price).quantize(
                Decimal("0.000001")
            )
            if not Decimal("0.000001") <= shares <= STORED_MAX:
                row.error = "Estimated units are outside the supported precision or range."
                waiting += 1
                continue
            holding = db.query(Holding).filter_by(user_id=user_id, ticker=row.ticker).one_or_none()
            if holding is None:
                if db.query(Holding).filter_by(user_id=user_id).count() >= MAX_HOLDINGS:
                    row.error = cap_message("holdings", MAX_HOLDINGS)
                    waiting += 1
                    continue
                holding = Holding(
                    user_id=user_id,
                    ticker=row.ticker,
                    name=plan.name,
                    asset_type=row.asset_type,
                    shares=0,
                )
                db.add(holding)
            if Decimal(str(holding.shares)) + shares > STORED_MAX:
                row.error = "The resulting position would exceed the supported share count."
                waiting += 1
                continue
            if holding.asset_type != row.asset_type:
                row.error = "Holding type differs from this plan; review the instrument."
                waiting += 1
                continue
            row.position_before = _position(holding)
            trade = apply_trade(
                db,
                user_id,
                holding,
                TradeIn(
                    date=quote.effective_date,
                    ticker=row.ticker,
                    action="BUY",
                    shares=float(shares),
                    price=float(quote.price),
                ),
            )
            trade.provenance, trade.recurring_occurrence_id = "recurring_estimated", row.id
            db.flush()
            row.status, row.trade_id, row.error = "posted", trade.id, None
            row.effective_date, row.quote_currency = quote.effective_date, quote.currency
            row.reference_price, row.fx_rate = float(quote.price), float(quote.fx_rate)
            row.fx_date, row.pricing_source = (
                quote.fx_date,
                "Yahoo daily close; fractional units; fees excluded",
            )
            posted += 1
    return posted, waiting


def correct_estimate(
    db: Session, user_id: uuid.UUID, occurrence_id: int, payload: PlaceIn | None
) -> OccurrenceOut:
    """Replay from the first estimate's saved opening position; never guess an imported baseline."""
    from app.trades import _as_stored, apply_position

    with transaction(db, user_id):
        row = _occurrence(db, user_id, occurrence_id)
        if row.status not in {"posted", "reconciled"} or row.trade_id is None:
            raise RecurringRefused("Only a posted estimate can be corrected or voided.")
        if payload is not None and payload.date > today():
            raise RecurringRefused("A corrected purchase cannot be in the future.", 422)
        holding = db.query(Holding).filter_by(user_id=user_id, ticker=row.ticker).one_or_none()
        anchor = (
            db.query(RecurringOccurrence)
            .filter(
                RecurringOccurrence.user_id == user_id,
                RecurringOccurrence.ticker == row.ticker,
                RecurringOccurrence.position_before.is_not(None),
                RecurringOccurrence.trade_id.is_not(None),
            )
            .order_by(RecurringOccurrence.trade_id)
            .first()
        )
        if holding is None or anchor is None or anchor.position_before is None:
            raise RecurringRefused(
                "The original holding is missing; reconcile the position manually."
            )
        trades = (
            db.query(Trade)
            .filter(
                Trade.user_id == user_id, Trade.ticker == row.ticker, Trade.id >= anchor.trade_id
            )
            .order_by(Trade.id)
            .all()
        )

        def replay() -> Holding:
            initial = anchor.position_before
            assert initial is not None
            position = Holding(
                shares=float(initial["shares"]),
                cost_basis=initial["basis"],
                first_purchase_date=date.fromisoformat(initial["first"])
                if initial["first"]
                else None,
            )
            for trade in trades:
                if trade.provenance != "voided":
                    apply_position(
                        position,
                        TradeIn(
                            date=trade.date,
                            ticker=trade.ticker,
                            action="BUY" if trade.action == "BUY" else "SELL",
                            shares=float(trade.shares),
                            price=float(trade.price),
                        ),
                    )
                    if position.cost_basis is not None:
                        position.cost_basis = float(
                            Decimal(str(position.cost_basis)).quantize(
                                Decimal("0.000001"), rounding=ROUND_HALF_UP
                            )
                        )
            return position

        def same(a: Holding, b: Holding) -> bool:
            def number(value: object) -> Decimal | None:
                return None if value is None else Decimal(str(value)).quantize(Decimal("0.000001"))

            return (
                number(a.shares) == number(b.shares)
                and number(a.cost_basis) == number(b.cost_basis)
                and a.first_purchase_date == b.first_purchase_date
            )

        if not same(replay(), holding):
            raise RecurringRefused(
                "This holding was edited outside its trade history; reconcile it manually first."
            )
        trade = next(t for t in trades if t.id == row.trade_id)
        if payload is None:
            trade.provenance, row.status = "voided", "voided"
        else:
            trade.date = payload.date
            trade.shares, trade.price = _as_stored(payload.shares), _as_stored(payload.price)
            trade.provenance, row.status = "reconciled", "reconciled"
        position = (
            replay()
        )  # Refuses corrections which would make a later sale exceed the position.
        holding.shares, holding.cost_basis = position.shares, position.cost_basis
        holding.first_purchase_date = position.first_purchase_date
    return occurrence_out(db, row)
