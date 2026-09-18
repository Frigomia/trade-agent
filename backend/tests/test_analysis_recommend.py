from app.analysis.recommend import synthesize


def test_stock_gated_held_oversold_adds():
    action, pct, reasoning = synthesize("STOCK", True, 85, "OVERSOLD")
    assert action == "ADD"
    assert pct == 0.15
    assert reasoning


def test_stock_gated_held_neutral_holds():
    action, pct, reasoning = synthesize("STOCK", True, 70, "NEUTRAL")
    assert action == "HOLD"
    assert pct is None


def test_stock_gated_not_held_oversold_buys_moderate_conviction():
    action, pct, reasoning = synthesize("STOCK", False, 70, "OVERSOLD")
    assert action == "BUY"
    assert pct == 0.075


def test_stock_gated_not_held_neutral_watches():
    action, pct, reasoning = synthesize("STOCK", False, 70, "NEUTRAL")
    assert action == "WATCH"
    assert pct is None


def test_stock_ungated_held_low_score_sells():
    action, pct, reasoning = synthesize("STOCK", True, 30, "NEUTRAL")
    assert action == "SELL"


def test_stock_ungated_held_mid_score_trims():
    action, pct, reasoning = synthesize("STOCK", True, 50, "NEUTRAL")
    assert action == "TRIM"


def test_stock_ungated_not_held_ok_score_watches():
    action, pct, reasoning = synthesize("STOCK", False, 45, "NEUTRAL")
    assert action == "WATCH"


def test_stock_ungated_not_held_low_score_emits_nothing():
    action, pct, reasoning = synthesize("STOCK", False, 30, "NEUTRAL")
    assert action is None
    assert pct is None
    assert reasoning == []


def test_etf_held_oversold_adds_strong_conviction():
    action, pct, reasoning = synthesize("ETF", True, None, "OVERSOLD")
    assert action == "ADD"
    assert pct == 0.15


def test_etf_held_weak_downtrend_trims():
    action, pct, reasoning = synthesize("ETF", True, None, "WEAK_DOWNTREND")
    assert action == "TRIM"
    assert pct is None


def test_etf_held_neutral_holds():
    action, pct, reasoning = synthesize("ETF", True, None, "NEUTRAL")
    assert action == "HOLD"


def test_etf_not_held_strong_uptrend_buys_moderate_conviction():
    action, pct, reasoning = synthesize("ETF", False, None, "STRONG_UPTREND")
    assert action == "BUY"
    assert pct == 0.075


def test_etf_not_held_neutral_watches():
    action, pct, reasoning = synthesize("ETF", False, None, "NEUTRAL")
    assert action == "WATCH"
    assert pct is None
