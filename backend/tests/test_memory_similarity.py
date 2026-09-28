from app.memory.similarity import find_similar
from app.models import Recommendation
from tests.auth_support import OTHER_USER_ID, USER_ID


def _vector(index: int, value: float = 1.0) -> list[float]:
    v = [0.0] * 1024
    v[index] = value
    return v


def test_find_similar_orders_by_cosine_distance(db_session):
    user_id = USER_ID
    close = Recommendation(
        user_id=user_id,
        ticker="AAA",
        asset_type="STOCK",
        action="BUY",
        reasoning=["close"],
        embedding=_vector(0, 1.0),
    )
    far = Recommendation(
        user_id=user_id,
        ticker="BBB",
        asset_type="STOCK",
        action="BUY",
        reasoning=["far"],
        embedding=_vector(1, 1.0),
    )
    opposite = Recommendation(
        user_id=user_id,
        ticker="CCC",
        asset_type="STOCK",
        action="BUY",
        reasoning=["opposite"],
        embedding=_vector(0, -1.0),
    )
    no_embedding = Recommendation(
        user_id=user_id,
        ticker="DDD",
        asset_type="STOCK",
        action="BUY",
        reasoning=["no embedding"],
    )
    db_session.add_all([close, far, opposite, no_embedding])
    db_session.commit()

    results = find_similar(db_session, USER_ID, _vector(0, 1.0), top_k=2)

    assert [r.ticker for r in results] == ["AAA", "BBB"]


def test_find_similar_ignores_other_users_recommendations(db_session):
    db_session.add(
        Recommendation(
            user_id=OTHER_USER_ID,
            ticker="AAPL",
            asset_type="STOCK",
            action="BUY",
            reasoning=["theirs"],
            embedding=_vector(0, 1.0),
        )
    )
    db_session.commit()

    assert find_similar(db_session, USER_ID, _vector(0, 1.0), top_k=5) == []
