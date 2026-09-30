from datetime import date

import pytest

from app.models import BacktestResult
from tests.auth_support import USER_ID


def test_backtest_result_roundtrip(db_session):
    result = BacktestResult(
        user_id=USER_ID,
        ticker="AAPL",
        start_date=date(2020, 1, 1),
        end_date=date(2024, 1, 1),
        final_value=12000.50,
        buy_and_hold_value=11000.25,
        excess_return_pct=0.0909,
        hit_rate_by_signal={"OVERSOLD": {"count": 5.0, "avg_forward_return_pct": 0.02}},
        status="DONE",
    )
    db_session.add(result)
    db_session.commit()
    db_session.refresh(result)

    assert result.id is not None
    assert result.final_value == pytest.approx(12000.50)
    assert result.hit_rate_by_signal == {"OVERSOLD": {"count": 5.0, "avg_forward_return_pct": 0.02}}


def test_backtest_result_stores_an_equity_curve(db_session):
    curve = {"strategy": [10000.0, 10100.5], "buy_and_hold": [10000.0, 10050.0]}
    result = BacktestResult(
        user_id=USER_ID,
        ticker="AAPL",
        start_date=date(2020, 1, 1),
        end_date=date(2024, 1, 1),
        final_value=10100.5,
        buy_and_hold_value=10050.0,
        excess_return_pct=0.005,
        hit_rate_by_signal={},
        equity_curve=curve,
        status="DONE",
    )
    db_session.add(result)
    db_session.commit()
    db_session.refresh(result)
    assert result.equity_curve == curve
