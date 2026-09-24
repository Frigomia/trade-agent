import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.memory.embeddings import embed_text
from app.memory.outcomes import compute_outcome
from app.memory.similarity import find_similar
from app.models import Recommendation
from app.schemas import MemorySimilarOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/memory", tags=["memory"])

BATCH_SIZE = 50
OUTCOME_LOOKBACK_DAYS = 20


def _situation_text(rec: Recommendation) -> str:
    text = f"{rec.ticker} ({rec.asset_type}): {rec.action}. {'; '.join(rec.reasoning)}."
    if rec.ai_analysis:
        text += f" {rec.ai_analysis}"
    return text


@router.post("/embed")
async def embed_recommendations(db: Session = Depends(get_db)) -> dict[str, int]:
    if not settings.voyage_api_key:
        raise HTTPException(status_code=503, detail="Embeddings not configured")

    pending_filter = (
        Recommendation.user_id == settings.default_user_id,
        Recommendation.embedding.is_(None),
    )
    pending = db.query(Recommendation).filter(*pending_filter).limit(BATCH_SIZE).all()

    embedded = 0
    for rec in pending:
        try:
            rec.embedding = await embed_text(_situation_text(rec))
            db.commit()
            embedded += 1
        except Exception:
            logger.exception("Failed to embed recommendation %s", rec.id)
            db.rollback()

    remaining = db.query(Recommendation).filter(*pending_filter).count()
    return {"embedded": embedded, "remaining": remaining}


@router.post("/evaluate-outcomes")
async def evaluate_outcomes(db: Session = Depends(get_db)) -> dict[str, int]:
    cutoff = datetime.now(UTC) - timedelta(days=OUTCOME_LOOKBACK_DAYS)
    due_filter = (
        Recommendation.user_id == settings.default_user_id,
        Recommendation.outcome_evaluated_at.is_(None),
        Recommendation.price_at_recommendation.isnot(None),
        Recommendation.created_at <= cutoff,
    )
    pending = db.query(Recommendation).filter(*due_filter).limit(BATCH_SIZE).all()

    evaluated = 0
    for rec in pending:
        try:
            assert rec.price_at_recommendation is not None  # guaranteed by due_filter
            rec.outcome_forward_return_pct = await compute_outcome(
                rec.ticker, float(rec.price_at_recommendation)
            )
            rec.outcome_evaluated_at = datetime.now(UTC)
            db.commit()
            evaluated += 1
        except Exception:
            logger.exception("Failed to evaluate outcome for recommendation %s", rec.id)
            db.rollback()

    remaining = db.query(Recommendation).filter(*due_filter).count()
    return {"evaluated": evaluated, "remaining": remaining}


class MemorySimilarIn(BaseModel):
    query: str
    top_k: int = 5


@router.post("/similar", response_model=list[MemorySimilarOut])
async def similar_recommendations(
    payload: MemorySimilarIn, db: Session = Depends(get_db)
) -> list[Recommendation]:
    if not settings.voyage_api_key:
        raise HTTPException(status_code=503, detail="Embeddings not configured")
    query_embedding = await embed_text(payload.query)
    return find_similar(db, query_embedding, payload.top_k)
