import logging
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.agents.market_data import fetch_closes_between
from app.models import Recommendation

logger = logging.getLogger(__name__)

# The return is the price change over 20 trading days, from the close on the recommendation's day.
HORIZON_TRADING_DAYS = 20
# 20 trading days take at least 28 calendar days; a row is looked at once that has passed.
READY_AFTER_DAYS = 28
# A row with still too few closes after this many days belongs to a stock that stopped trading.
GIVE_UP_AFTER_DAYS = 75
# The entry close is the first one on or after the entry day: a weekend or holiday is a few days.
MAX_ENTRY_GAP_DAYS = 5
# A provider error is tried again on a later day, this many times, then the row is left unscored.
MAX_ATTEMPTS = 5
RETRY_AFTER = timedelta(hours=20)
OUTCOME_BATCH_SIZE = 50


class NoPriceHistory(Exception):
    """The provider has no prices for the symbol: permanent."""


class NotEnoughHistory(Exception):
    """Fewer than 20 trading days have closed since the entry day: not an error, just early."""


async def compute_outcome(ticker: str, entry: date) -> float:
    """The change from the close on `entry` (or the next trading day) to the close 20 trading days
    later. Both closes come from one series, so a currency subunit (pence) or a split between the
    two cannot make them disagree. A provider failure is raised as it is (transient)."""
    closes = await fetch_closes_between(ticker, entry, entry + timedelta(days=GIVE_UP_AFTER_DAYS))
    if not closes:
        raise NoPriceHistory(ticker)
    days = sorted(closes)
    if (date.fromisoformat(days[0]) - entry).days > MAX_ENTRY_GAP_DAYS:
        raise NoPriceHistory(ticker)  # no close near the entry day: the start would be a guess
    if len(days) <= HORIZON_TRADING_DAYS:
        raise NotEnoughHistory(ticker)
    return closes[days[HORIZON_TRADING_DAYS]] / closes[days[0]] - 1


def _entry_day(rec: Recommendation) -> date:
    return (rec.price_as_of or rec.created_at).date()


async def evaluate_due_outcomes(db: Session, user_id: uuid.UUID) -> tuple[int, int]:
    """Evaluates one batch of the user's due recommendations; returns (evaluated, remaining).

    Every recommendation with an entry price is scored once, whatever its status (a replaced idea
    was still issued). Rows without one (ideas from before it was stored) are never guessed."""
    # created_at and price_as_of are DateTime (no tz): these comparisons are only correct because
    # the Postgres session's TimeZone is UTC (true for this project's Docker Postgres image).
    now = datetime.now(UTC)
    due_filter = (
        Recommendation.user_id == user_id,
        Recommendation.outcome_evaluated_at.is_(None),
        Recommendation.price_at_recommendation.isnot(None),
        func.coalesce(Recommendation.price_as_of, Recommendation.created_at)
        <= now - timedelta(days=READY_AFTER_DAYS),
        or_(
            Recommendation.outcome_attempted_at.is_(None),
            Recommendation.outcome_attempted_at <= now - RETRY_AFTER,
        ),
    )
    pending = (
        db.query(Recommendation)
        .filter(*due_filter)
        .order_by(Recommendation.id)
        .limit(OUTCOME_BATCH_SIZE)
        .with_for_update(skip_locked=True)
        .all()
    )
    # Claim the batch before the slow provider calls, so a second run (the daily job and a person
    # opening Track record) neither takes the same rows nor spends their attempts twice.
    for rec in pending:
        rec.outcome_attempted_at = datetime.now(UTC)
    db.commit()

    evaluated = 0
    for rec in pending:
        entry = _entry_day(rec)
        try:
            rec.outcome_forward_return_pct = await compute_outcome(rec.ticker, entry)
            rec.outcome_evaluated_at = datetime.now(UTC)
            evaluated += 1
        except NoPriceHistory:
            # Resolved with no valid outcome: outcome_forward_return_pct stays None, which is how a
            # caller tells that apart from "not due yet".
            rec.outcome_evaluated_at = datetime.now(UTC)
        except NotEnoughHistory:
            rec.outcome_attempted_at = datetime.now(UTC)
            if (now.date() - entry).days > GIVE_UP_AFTER_DAYS:
                rec.outcome_evaluated_at = datetime.now(UTC)
        except Exception as exc:
            logger.warning(
                "Failed to evaluate outcome for recommendation %s: %s", rec.id, type(exc).__name__
            )
            rec.outcome_attempts += 1
            rec.outcome_attempted_at = datetime.now(UTC)
            if rec.outcome_attempts >= MAX_ATTEMPTS:
                rec.outcome_evaluated_at = datetime.now(UTC)
        db.commit()

    remaining = db.query(Recommendation).filter(*due_filter).count()
    return evaluated, remaining
