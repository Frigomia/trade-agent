from app.analysis.fundamental import score_fundamentals


def test_score_fundamentals_all_strong():
    metrics = {
        "peg_ratio": 0.9,
        "roe": 0.22,
        "debt_to_equity": 0.3,
        "revenue_growth": 0.18,
        "profit_margin": 0.20,
    }
    assert score_fundamentals(metrics) == 100


def test_score_fundamentals_all_missing():
    assert score_fundamentals({}) == 0


def test_score_fundamentals_mixed():
    metrics = {
        "peg_ratio": 1.5,
        "roe": 0.12,
        "debt_to_equity": 1.0,
        "revenue_growth": 0.03,
        "profit_margin": 0.10,
    }
    assert score_fundamentals(metrics) == 53
