import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, patch

from app.memory.outcomes import OUTCOME_BATCH_SIZE, compute_outcome, evaluate_due_outcomes
from app.models import Recommendation
from tests.auth_support import OTHER_USER_ID, USER_ID


def test_compute_outcome_calculates_forward_return():
    with patch(
        "app.memory.outcomes.fetch_price_history",
        AsyncMock(return_value=[160.0, 162.0, 165.0]),
    ):
        result = asyncio.run(compute_outcome("AAPL", 150.0, date(2024, 1, 1), lookback_days=20))

    assert result == (165.0 - 150.0) / 150.0


def _rec(
    db, *, days_old: int, user_id: uuid.UUID = USER_ID, price: float = 100.0, ticker: str = "AAPL"
) -> Recommendation:
    rec = Recommendation(
        user_id=user_id,
        ticker=ticker,
        asset_type="STOCK",
        action="BUY",
        reasoning=["x"],
        price_at_recommendation=price,
        created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=days_old),
    )
    db.add(rec)
    db.commit()
    return rec


def _evaluate(db, compute, user_id: uuid.UUID = USER_ID) -> tuple[int, int]:
    with patch("app.memory.outcomes.compute_outcome", compute):
        return asyncio.run(evaluate_due_outcomes(db, user_id))


def test_evaluate_due_outcomes_evaluates_only_due_rows_of_the_user(db_session):
    due = _rec(db_session, days_old=21)
    not_due = _rec(db_session, days_old=5)
    other_users = _rec(db_session, days_old=30, user_id=OTHER_USER_ID)

    evaluated, remaining = _evaluate(db_session, AsyncMock(return_value=0.05))

    assert (evaluated, remaining) == (1, 0)
    db_session.refresh(due)
    db_session.refresh(not_due)
    db_session.refresh(other_users)
    assert float(due.outcome_forward_return_pct) == 0.05
    assert due.outcome_evaluated_at is not None
    assert not_due.outcome_evaluated_at is None
    assert other_users.outcome_evaluated_at is None


def test_evaluate_due_outcomes_reports_what_is_left_after_one_batch(db_session):
    for _ in range(OUTCOME_BATCH_SIZE + 1):
        _rec(db_session, days_old=25)
    assert db_session.query(Recommendation).count() == OUTCOME_BATCH_SIZE + 1

    first = _evaluate(db_session, AsyncMock(return_value=0.01))
    second = _evaluate(db_session, AsyncMock(return_value=0.01))

    assert first == (OUTCOME_BATCH_SIZE, 1)
    assert second == (1, 0)


def test_evaluate_due_outcomes_stamps_a_permanent_failure_so_it_stops_blocking(db_session):
    bad = _rec(db_session, days_old=25, ticker="NOPE")

    first = _evaluate(db_session, AsyncMock(side_effect=ValueError("no history")))
    second = _evaluate(db_session, AsyncMock(return_value=0.02))

    assert first == (0, 0)
    assert second == (0, 0)
    db_session.refresh(bad)
    assert bad.outcome_forward_return_pct is None
    assert bad.outcome_evaluated_at is not None
