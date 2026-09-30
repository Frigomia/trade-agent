import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.config import settings
from app.memory.embeddings import embed_text
from app.memory.outcomes import evaluate_due_outcomes
from app.memory.similarity import find_similar
from app.models import Recommendation
from app.rate_limit import rate_limiter
from app.schemas import MemorySimilarOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/memory", tags=["memory"], dependencies=[Depends(get_current_user)])

BATCH_SIZE = 50
# Per user, per minute. /embed and /similar call the embedding API (they cost money);
# /evaluate-outcomes makes yfinance calls and is fired automatically when Track record opens.
EMBED_LIMIT_PER_MINUTE = 5
EVALUATE_OUTCOMES_LIMIT_PER_MINUTE = 6
SIMILAR_LIMIT_PER_MINUTE = 30


@router.post(
    "/embed", dependencies=[Depends(rate_limiter("memory_embed", limit=EMBED_LIMIT_PER_MINUTE))]
)
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


@router.post(
    "/evaluate-outcomes",
    dependencies=[
        Depends(rate_limiter("evaluate_outcomes", limit=EVALUATE_OUTCOMES_LIMIT_PER_MINUTE))
    ],
)
async def evaluate_outcomes(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> dict[str, int]:
    evaluated, remaining = await evaluate_due_outcomes(db, user.id)
    return {"evaluated": evaluated, "remaining": remaining}


class MemorySimilarIn(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=50)


@router.post(
    "/similar",
    response_model=list[MemorySimilarOut],
    dependencies=[Depends(rate_limiter("memory_similar", limit=SIMILAR_LIMIT_PER_MINUTE))],
)
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
