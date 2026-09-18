from app.analysis.technical import score_technical


def test_score_technical_oversold_on_low_rsi():
    closes = [100.0] * 200 + [100.0 - i for i in range(1, 15)]
    assert score_technical(closes) == "OVERSOLD"


def test_score_technical_strong_uptrend():
    closes = [100.0 + i * 0.5 for i in range(220)]
    assert score_technical(closes) == "STRONG_UPTREND"


def test_score_technical_weak_downtrend():
    closes = [150.0] * 200 + [110.0] * 20
    assert score_technical(closes) == "WEAK_DOWNTREND"


def test_score_technical_neutral_on_flat_prices():
    closes = [100.0] * 220
    assert score_technical(closes) == "NEUTRAL"


def test_score_technical_neutral_on_insufficient_history():
    assert score_technical([]) == "NEUTRAL"
    assert score_technical([100.0]) == "NEUTRAL"
    # Thin history (well under the 200-close floor) should not produce a
    # confident signal even though it's more than the old len(closes) < 2 guard.
    assert score_technical([100.0 - i for i in range(50)]) == "NEUTRAL"
