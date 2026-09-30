import logging
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy.orm import Session

from app.agents.market_data import fetch_price_history
from app.models import Recommendation

logger = logging.getLogger(__name__)

OUTCOME_LOOKBACK_DAYS = 20
OUTCOME_BATCH_SIZE = 50


async def compute_outcome(
    ticker: str, price_at_recommendation: float, created_at: date, lookback_days: int
) -> float:
    end = created_at + timedelta(days=lookback_days)
    closes = await fetch_price_history(ticker, created_at, end)
    if not closes:
        raise ValueError(f"No price history for {ticker} between {created_at} and {end}")
    outcome_price = closes[-1]
    return (outcome_price - price_at_recommendation) / price_at_recommendation


async def evaluate_due_outcomes(db: Session, user_id: uuid.UUID) -> tuple[int, int]:
    """Evaluates one batch of the user's due recommendations; returns (evaluated, remaining)."""
    # Recommendation.created_at is DateTime (no tz) — this comparison is only
    # correct because the Postgres session's TimeZone is UTC (true for this
    # project's Docker Postgres image). Not enforced at the schema level.
    cutoff = datetime.now(UTC) - timedelta(days=OUTCOME_LOOKBACK_DAYS)
    due_filter = (
        Recommendation.user_id == user_id,
        Recommendation.outcome_evaluated_at.is_(None),
        Recommendation.price_at_recommendation.isnot(None),
        Recommendation.created_at <= cutoff,
    )
    pending = (
        db.query(Recommendation)
        .filter(*due_filter)
        .order_by(Recommendation.id)
        .limit(OUTCOME_BATCH_SIZE)
        .all()
    )

    evaluated = 0
    for rec in pending:
        try:
            price = rec.price_at_recommendation
            if price is None:  # due_filter excludes these; belt-and-braces for mypy
                continue
            rec.outcome_forward_return_pct = await compute_outcome(
                rec.ticker, float(price), rec.created_at.date(), OUTCOME_LOOKBACK_DAYS
            )
            rec.outcome_evaluated_at = datetime.now(UTC)
            db.commit()
            evaluated += 1
        except Exception:
            logger.exception("Failed to evaluate outcome for recommendation %s", rec.id)
            db.rollback()
            # compute_outcome's only failure mode (no price history for the
            # ticker) is permanent, not transient -- stamp evaluated_at even
            # on failure so this row stops matching due_filter and blocking
            # the batch forever. outcome_forward_return_pct stays None,
            # which is how a caller tells "resolved, no valid outcome" apart
            # from "not due yet".
            rec.outcome_evaluated_at = datetime.now(UTC)
            db.commit()

    remaining = db.query(Recommendation).filter(*due_filter).count()
    return evaluated, remaining
