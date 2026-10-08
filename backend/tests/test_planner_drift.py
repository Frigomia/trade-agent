from decimal import Decimal as D

from app.planner import drift_items
from tests.test_planner import cand


def test_drift_lists_holdings_beyond_the_threshold_biggest_first():
    cands = [cand("AAPL", 1000, 0.4), cand("MSFT", 3000, 0.4)]  # weights 25 / 75 against 50 / 50
    items = drift_items(cands, D("5"))
    assert [(i.ticker, round(float(i.points), 1)) for i in items] == [
        ("AAPL", -25.0),
        ("MSFT", 25.0),
    ]


def test_drift_below_the_threshold_is_not_listed():
    cands = [cand("AAPL", 1000, 0.4), cand("MSFT", 3000, 0.4)]
    assert drift_items(cands, D("30")) == []


def test_watchlist_items_and_untargeted_holdings_are_ignored():
    cands = [
        cand("AAPL", 1000, 0.5),
        cand("MSFT", 1000, 0.5),
        cand("NVDA", 0, 0.5, held=False),
        cand("OLD", 9000, None),
    ]
    assert drift_items(cands, D("1")) == []


def test_a_single_targeted_holding_never_drifts():
    assert drift_items([cand("AAPL", 1000, 0.3)], D("1")) == []


def test_the_boundary_counts():
    cands = [cand("AAPL", 55, 0.5), cand("MSFT", 45, 0.5)]  # exactly 5 points either way
    assert len(drift_items(cands, D("5"))) == 2


def test_points_exactly_at_the_threshold_are_included():
    cands = [cand("AAPL", 55, 0.5), cand("MSFT", 45, 0.5)]
    assert len(drift_items(cands, D("5"))) == 2
    assert drift_items(cands, D("5.01")) == []
