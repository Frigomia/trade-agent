from sqlalchemy.orm import Session

from app.config import settings
from app.models import Recommendation


def find_similar(db: Session, query_embedding: list[float], top_k: int) -> list[Recommendation]:
    return (
        db.query(Recommendation)
        .filter(
            Recommendation.user_id == settings.default_user_id,
            Recommendation.embedding.isnot(None),
        )
        .order_by(Recommendation.embedding.cosine_distance(query_embedding))
        .limit(top_k)
        .all()
    )
