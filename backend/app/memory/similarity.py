import uuid

from sqlalchemy.orm import Session

from app.models import Recommendation


def find_similar(
    db: Session, user_id: uuid.UUID, query_embedding: list[float], top_k: int
) -> list[Recommendation]:
    return (
        db.query(Recommendation)
        .filter(
            Recommendation.user_id == user_id,
            Recommendation.embedding.isnot(None),
        )
        .order_by(Recommendation.embedding.cosine_distance(query_embedding))
        .limit(top_k)
        .all()
    )
