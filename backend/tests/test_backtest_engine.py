from unittest.mock import patch

import pytest

from app.backtest.engine import MAX_CURVE_POINTS, downsample, simulate


def test_simulate_buys_the_dip_and_beats_buy_and_hold():
    flat = [150.0] * 200
    decline = [150.0 - i for i in range(1, 15)]
    recovery = [136.0 + i * 0.5 for i in range(1, 41)]
    closes = flat + decline + recovery

    metrics = simulate(closes)

    assert metrics.final_value == pytest.approx(10675.829534817442)
    assert metrics.buy_and_hold_value == pytest.approx(10400.0)
    assert metrics.excess_return_pct == pytest.approx(0.026522070655523224)
    assert metrics.hit_rate_by_signal.keys() == {"OVERSOLD"}
    assert metrics.hit_rate_by_signal["OVERSOLD"]["count"] == pytest.approx(20.0)
    assert metrics.hit_rate_by_signal["OVERSOLD"]["avg_forward_return_pct"] == pytest.approx(
        0.023849938336244644
    )
    assert 0.0 <= metrics.hit_rate_by_signal["OVERSOLD"]["hit_rate"] <= 1.0


def test_simulate_trims_on_weak_downtrend_after_holding():
    # Oscillating baseline (avoids RSI pinning at 0 on the first down-tick
    # after a dead-flat run), a sharp dip that triggers an OVERSOLD buy, a
    # small bounce, then a shallow multi-week bleed that clears 20%+
    # drawdown while staying above the OVERSOLD RSI threshold -- this is
    # what actually reaches the WEAK_DOWNTREND branch (TRIM), since a
    # steady/sharp decline keeps tripping OVERSOLD instead.
    base = [150.0 + (0.5 if i % 2 == 0 else 0.0) for i in range(200)]
    sharp_dip = [150.0 - i for i in range(1, 15)]
    recover = [136.0 + i for i in range(1, 11)]
    gentle: list[float] = []
    price = recover[-1]
    for _ in range(110):
        price -= 1.0
        gentle.append(price)
        price += 0.7
        gentle.append(price)
    closes = (base + sharp_dip + recover + gentle)[:390]

    metrics = simulate(closes)

    # A TRIM fires partway through this series (not directly observable from
    # BacktestMetrics alone) -- final_value/buy_and_hold_value pin down the
    # exact bookkeeping so a regression that breaks TRIM's cash/shares split
    # changes these numbers.
    assert metrics.final_value == pytest.approx(8378.195019304001)
    assert metrics.buy_and_hold_value == pytest.approx(8046.511627906936)
    assert metrics.excess_return_pct == pytest.approx(0.04122076829501117)
    assert metrics.hit_rate_by_signal.keys() == {"OVERSOLD"}
    assert 0.0 <= metrics.hit_rate_by_signal["OVERSOLD"]["hit_rate"] <= 1.0


def test_simulate_flat_series_has_no_signals_or_trades():
    closes = [150.0] * 220

    metrics = simulate(closes)

    assert metrics.final_value == pytest.approx(10000.0)
    assert metrics.buy_and_hold_value == pytest.approx(10000.0)
    assert metrics.excess_return_pct == pytest.approx(0.0)
    assert metrics.hit_rate_by_signal == {}


def test_simulate_never_sees_future_prices():
    # 300 days > LIVE_LOOKBACK_DAYS (252), so this also exercises the window
    # cap: once the window would exceed 252 elements, its start slides
    # forward instead of growing further -- never future prices, and never
    # more trailing history than the live path (period="1y") sees either.
    closes = [150.0] * 300
    seen = []
    with patch(
        "app.backtest.engine.technical.score_technical",
        side_effect=lambda w: seen.append(list(w)) or "NEUTRAL",
    ):
        simulate(closes)
    assert seen == [closes[max(0, i + 1 - 252) : i + 1] for i in range(len(closes))]


def test_downsample_passes_short_lists_through_rounded():
    assert downsample([1.234, 2.0]) == [1.23, 2.0]
    assert downsample([]) == []
    assert downsample([5.0]) == [5.0]


def test_downsample_caps_length_and_keeps_first_and_last():
    values = [float(i) for i in range(1000)]
    out = downsample(values)
    assert len(out) == MAX_CURVE_POINTS
    assert out[0] == 0.0
    assert out[-1] == 999.0
    assert out == sorted(out)
    assert len(set(out)) == MAX_CURVE_POINTS  # no duplicated picks


def test_downsample_at_the_cap_is_unchanged():
    values = [float(i) for i in range(MAX_CURVE_POINTS)]
    assert downsample(values) == values


def test_simulate_curves_end_at_the_final_values_and_are_capped():
    flat = [150.0] * 200
    decline = [150.0 - i for i in range(1, 15)]
    recovery = [136.0 + i * 0.5 for i in range(1, 41)]
    closes = flat + decline + recovery  # 254 days, more than the cap

    metrics = simulate(closes)
    curve = metrics.equity_curve

    assert curve is not None
    assert len(curve["strategy"]) == len(curve["buy_and_hold"]) == MAX_CURVE_POINTS
    assert curve["strategy"][0] == pytest.approx(10000.0)
    assert curve["buy_and_hold"][0] == pytest.approx(10000.0)
    assert curve["strategy"][-1] == pytest.approx(metrics.final_value, abs=0.01)
    assert curve["buy_and_hold"][-1] == pytest.approx(metrics.buy_and_hold_value, abs=0.01)


def test_simulate_short_series_keeps_one_point_per_day():
    metrics = simulate([100.0] * 60)
    assert metrics.equity_curve is not None
    assert len(metrics.equity_curve["strategy"]) == 60
    assert len(metrics.equity_curve["buy_and_hold"]) == 60
