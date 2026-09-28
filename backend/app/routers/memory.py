import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.config import settings
from app.memory.embeddings import embed_text
from app.memory.outcomes import compute_outcome
from app.memory.similarity import find_similar
from app.models import Recommendation
from app.schemas import MemorySimilarOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/memory", tags=["memory"], dependencies=[Depends(get_current_user)])

BATCH_SIZE = 50
OUTCOME_LOOKBACK_DAYS = 20


@router.post("/embed")
async def embed_recommendations(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> dict[str, int]:
    if not settings.voyage_api_key:
        raise HTTPException(status_code=503, detail="Embeddings not configured")

    pending_filter = (
        Recommendation.user_id == user.id,
        Recommendation.embedding.is_(None),
    )
    pending = (
        db.query(Recommendation)
        .filter(*pending_filter)
        .order_by(Recommendation.id)
        .limit(BATCH_SIZE)
        .all()
    )

    embedded = 0
    for rec in pending:
        try:
            reasoning = "; ".join(rec.reasoning)
            situation = f"{rec.ticker} ({rec.asset_type}): {rec.action}. {reasoning}."
            if rec.ai_analysis:
                situation += f" {rec.ai_analysis}"
            rec.embedding = await embed_text(situation)
            db.commit()
            embedded += 1
        except Exception:
            logger.exception("Failed to embed recommendation %s", rec.id)
            db.rollback()

    remaining = db.query(Recommendation).filter(*pending_filter).count()
    return {"embedded": embedded, "remaining": remaining}


@router.post("/evaluate-outcomes")
async def evaluate_outcomes(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> dict[str, int]:
    # Recommendation.created_at is DateTime (no tz) — this comparison is only
    # correct because the Postgres session's TimeZone is UTC (true for this
    # project's Docker Postgres image). Not enforced at the schema level.
    cutoff = datetime.now(UTC) - timedelta(days=OUTCOME_LOOKBACK_DAYS)
    due_filter = (
        Recommendation.user_id == user.id,
        Recommendation.outcome_evaluated_at.is_(None),
        Recommendation.price_at_recommendation.isnot(None),
        Recommendation.created_at <= cutoff,
    )
    pending = (
        db.query(Recommendation)
        .filter(*due_filter)
        .order_by(Recommendation.id)
        .limit(BATCH_SIZE)
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
    return {"evaluated": evaluated, "remaining": remaining}


class MemorySimilarIn(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=50)


@router.post("/similar", response_model=list[MemorySimilarOut])
async def similar_recommendations(
    payload: MemorySimilarIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> list[Recommendation]:
    if not settings.voyage_api_key:
        raise HTTPException(status_code=503, detail="Embeddings not configured")
    try:
        query_embedding = await embed_text(payload.query)
    except Exception:
        logger.exception("Embedding failed for similarity query")
        raise HTTPException(status_code=503, detail="Embeddings unavailable") from None
    return find_similar(db, user.id, query_embedding, payload.top_k)
