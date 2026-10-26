import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from app.memory.outcomes import (
    GIVE_UP_AFTER_DAYS,
    MAX_ATTEMPTS,
    OUTCOME_BATCH_SIZE,
    NoPriceHistory,
    NotEnoughHistory,
    compute_outcome,
    evaluate_due_outcomes,
)
from app.models import Recommendation
from tests.auth_support import OTHER_USER_ID, USER_ID


def _closes(count: int, first: float = 100.0, step: float = 1.0) -> dict[str, float]:
    start = date(2026, 1, 5)
    return {(start + timedelta(days=i)).isoformat(): first + step * i for i in range(count)}


def _compute(closes: dict[str, float]) -> float:
    with patch("app.memory.outcomes.fetch_closes_between", AsyncMock(return_value=closes)):
        return asyncio.run(compute_outcome("AAPL", date(2026, 1, 5)))


def test_the_return_is_the_close_20_trading_days_after_the_entry_close():
    # 25 closes: the 21st (index 20) is 120 against an entry close of 100
    assert _compute(_closes(25)) == pytest.approx(0.20)


def test_a_price_quoted_in_pence_gives_the_same_return_as_in_pounds():
    pence = _compute(_closes(25, first=10000.0, step=100.0))
    pounds = _compute(_closes(25, first=100.0, step=1.0))

    assert pence == pytest.approx(pounds) == pytest.approx(0.20)


def test_a_split_between_entry_and_outcome_does_not_show_as_a_fall():
    # The provider's closes are split-adjusted, so both ends are in the same terms: 2-for-1 here.
    halved = {day: price / 2 for day, price in _closes(25).items()}

    assert _compute(halved) == pytest.approx(0.20)


def test_fewer_than_21_closes_is_too_early_and_none_is_no_history():
    with pytest.raises(NotEnoughHistory):
        _compute(_closes(20))
    with pytest.raises(NoPriceHistory):
        _compute({})


def test_a_provider_error_is_raised_as_it_is():
    provider = AsyncMock(side_effect=OSError("x"))
    with patch("app.memory.outcomes.fetch_closes_between", provider), pytest.raises(OSError):
        asyncio.run(compute_outcome("AAPL", date(2026, 1, 5)))


def _rec(
    db,
    *,
    days_old: int,
    user_id: uuid.UUID = USER_ID,
    ticker: str = "AAPL",
    price: float | None = 100.0,
    as_of_days_old: int | None = None,
    status: str = "PENDING",
) -> Recommendation:
    now = datetime.now(UTC).replace(tzinfo=None)
    rec = Recommendation(
        user_id=user_id,
        ticker=ticker,
        asset_type="STOCK",
        action="BUY",
        reasoning=["x"],
        status=status,
        price_at_recommendation=price,
        price_as_of=None if as_of_days_old is None else now - timedelta(days=as_of_days_old),
        created_at=now - timedelta(days=days_old),
    )
    db.add(rec)
    db.commit()
    return rec


def _evaluate(db, compute, user_id: uuid.UUID = USER_ID) -> tuple[int, int]:
    with patch("app.memory.outcomes.compute_outcome", compute):
        return asyncio.run(evaluate_due_outcomes(db, user_id))


def test_evaluate_due_outcomes_evaluates_only_due_rows_of_the_user(db_session):
    due = _rec(db_session, days_old=29)
    not_due = _rec(db_session, days_old=25)  # 20 trading days have not surely closed yet
    other_users = _rec(db_session, days_old=40, user_id=OTHER_USER_ID)

    evaluated, remaining = _evaluate(db_session, AsyncMock(return_value=0.05))

    assert (evaluated, remaining) == (1, 0)
    for rec in (due, not_due, other_users):
        db_session.refresh(rec)
    assert float(due.outcome_forward_return_pct) == 0.05
    assert due.outcome_evaluated_at is not None
    assert not_due.outcome_evaluated_at is None
    assert other_users.outcome_evaluated_at is None


def test_evaluate_due_outcomes_reports_what_is_left_after_one_batch(db_session):
    for _ in range(OUTCOME_BATCH_SIZE + 1):
        _rec(db_session, days_old=40)

    first = _evaluate(db_session, AsyncMock(return_value=0.01))
    second = _evaluate(db_session, AsyncMock(return_value=0.01))

    assert first == (OUTCOME_BATCH_SIZE, 1)
    assert second == (1, 0)


def test_a_symbol_with_no_prices_is_stamped_so_it_stops_blocking(db_session):
    bad = _rec(db_session, days_old=40, ticker="NOPE")

    first = _evaluate(db_session, AsyncMock(side_effect=NoPriceHistory("NOPE")))
    second = _evaluate(db_session, AsyncMock(return_value=0.02))

    assert first == (0, 0) and second == (0, 0)
    db_session.refresh(bad)
    assert bad.outcome_forward_return_pct is None
    assert bad.outcome_evaluated_at is not None


def test_a_replaced_idea_is_still_scored(db_session):
    superseded = _rec(db_session, days_old=40, status="SUPERSEDED")

    assert _evaluate(db_session, AsyncMock(return_value=0.03)) == (1, 0)
    db_session.refresh(superseded)
    assert float(superseded.outcome_forward_return_pct) == 0.03


def test_an_idea_without_an_entry_price_is_left_unmeasured(db_session):
    old_idea = _rec(db_session, days_old=90, price=None)
    compute = AsyncMock(return_value=0.1)

    assert _evaluate(db_session, compute) == (0, 0)
    compute.assert_not_called()
    db_session.refresh(old_idea)
    assert old_idea.outcome_evaluated_at is None


def test_the_horizon_starts_on_the_price_date_not_the_scan_date(db_session):
    # Scanned yesterday on a snapshot 35 days old: due, and measured from the snapshot's day.
    stale = _rec(db_session, days_old=1, as_of_days_old=35)
    # Scanned long ago on a fresh price date: the 20 trading days have not closed.
    fresh = _rec(db_session, days_old=60, as_of_days_old=3)
    compute = AsyncMock(return_value=0.04)

    assert _evaluate(db_session, compute) == (1, 0)
    compute.assert_awaited_once_with("AAPL", stale.price_as_of.date())
    db_session.refresh(fresh)
    assert fresh.outcome_evaluated_at is None


def test_a_provider_error_is_retried_on_a_later_day_not_burned_in_one_run(db_session):
    rec = _rec(db_session, days_old=40)
    failing = AsyncMock(side_effect=OSError("throttled"))

    assert _evaluate(db_session, failing) == (0, 0)  # attempted: not due again today
    assert _evaluate(db_session, failing) == (0, 0)
    db_session.refresh(rec)
    assert rec.outcome_attempts == 1 and rec.outcome_evaluated_at is None
    assert failing.await_count == 1

    rec.outcome_attempted_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
    db_session.commit()
    assert _evaluate(db_session, AsyncMock(return_value=0.07)) == (1, 0)
    db_session.refresh(rec)
    assert float(rec.outcome_forward_return_pct) == 0.07


def test_a_row_that_keeps_failing_is_given_up_after_the_attempt_limit(db_session):
    rec = _rec(db_session, days_old=40)
    rec.outcome_attempts = MAX_ATTEMPTS - 1
    db_session.commit()

    _evaluate(db_session, AsyncMock(side_effect=OSError("down")))

    db_session.refresh(rec)
    assert rec.outcome_attempts == MAX_ATTEMPTS
    assert rec.outcome_evaluated_at is not None and rec.outcome_forward_return_pct is None


def test_too_few_closes_waits_then_gives_up_for_a_stock_that_stopped_trading(db_session):
    waiting = _rec(db_session, days_old=40, ticker="WAIT")
    dead = _rec(db_session, days_old=GIVE_UP_AFTER_DAYS + 5, ticker="DEAD")

    _evaluate(db_session, AsyncMock(side_effect=NotEnoughHistory("x")))

    db_session.refresh(waiting)
    db_session.refresh(dead)
    assert waiting.outcome_evaluated_at is None and waiting.outcome_attempts == 0
    assert waiting.outcome_attempted_at is not None  # looked at today, not again before tomorrow
    assert dead.outcome_evaluated_at is not None and dead.outcome_forward_return_pct is None


def test_closes_that_start_days_after_the_entry_day_are_not_a_valid_entry():
    late = {day: price for day, price in _closes(25).items() if day >= "2026-01-15"}  # 10 days on

    with pytest.raises(NoPriceHistory):
        _compute(late)


def test_a_weekend_entry_uses_the_next_close():
    weekend = {day: price for day, price in _closes(25).items() if day >= "2026-01-07"}  # 2 days on

    assert _compute(weekend) == pytest.approx(122 / 102 - 1)  # from the first close on


def test_a_batch_is_claimed_before_the_provider_is_asked(db_session):
    rec = _rec(db_session, days_old=40)
    seen = {}

    async def slow(ticker, entry):
        db_session.refresh(rec)
        seen["attempted"] = rec.outcome_attempted_at
        return 0.01

    _evaluate(db_session, slow)

    assert seen["attempted"] is not None  # a second run would find it already taken
