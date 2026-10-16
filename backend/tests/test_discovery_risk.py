from decimal import Decimal
from typing import Any

import pytest

from app.discovery.risk import MIN_HISTORY_DAYS, build_risk_profile

FLAT = [100.0] * (MIN_HISTORY_DAYS + 10)
EUR = {"EUR": Decimal(1)}


def profile(**overrides: Any):  # type: ignore[no-untyped-def]
    args: dict[str, Any] = {
        "group": "general",
        "market_cap": 5e9,
        "currency": "EUR",
        "rates": EUR,
        "avg_volume": 1e6,
        "price": 50.0,
        "closes": FLAT,
        "metrics": {},
    }
    return build_risk_profile(**{**args, **overrides})


def flags(**overrides: Any) -> set[str]:
    return {flag.split(":")[0] for flag in profile(**overrides).risk_flags}


def test_size_and_liquidity_are_converted_to_eur() -> None:
    p = profile(market_cap=1e9, currency="USD", rates={"USD": Decimal("0.8")}, price=10.0)

    assert (p.market_cap_eur, p.size_bucket) == (pytest.approx(0.8e9), "small")
    assert p.avg_daily_value_eur == pytest.approx(1e6 * 10.0 * 0.8)


def test_a_pence_quoted_stock_uses_pounds_for_cap_and_pence_for_the_price() -> None:
    p = profile(market_cap=193e9, currency="GBp", rates={"GBp": Decimal("0.0115")}, price=5000.0)

    assert (p.market_cap_eur, p.size_bucket) == (pytest.approx(193e9 * 1.15), "large")
    assert p.avg_daily_value_eur == pytest.approx(1e6 * 5000.0 * 0.0115)


def test_volatility_and_drawdown_come_from_the_closes() -> None:
    swinging = [100.0, 110.0] * 70
    p = profile(closes=swinging)
    assert p.volatility_annualized == pytest.approx(1.51, abs=0.05)  # ln(1.1) a day, annualized

    drop = [100.0] * 130 + [120.0, 90.0, 100.0]
    assert profile(closes=drop).max_drawdown_1y == pytest.approx(-0.25)
    assert profile(closes=FLAT).volatility_annualized == 0.0


def test_a_short_history_gives_no_estimate_not_a_guess() -> None:
    p = profile(closes=[100.0, 101.0] * 20)

    assert (p.volatility_annualized, p.max_drawdown_1y) == (None, None)


def test_missing_inputs_stay_missing() -> None:
    p = profile(market_cap=None, avg_volume=None, rates={}, closes=[], metrics={})

    assert (p.market_cap_eur, p.avg_daily_value_eur, p.size_bucket) == (None, None, "unknown")
    assert (p.volatility_annualized, p.risk_flags, p.risk_level) == (None, [], "unknown")


def test_size_and_liquidity_flags_carry_their_numbers() -> None:
    p = profile(market_cap=100e6, avg_volume=1e4)  # 100M cap, 0.5M a day

    assert {f.split(":")[0] for f in p.risk_flags} == {"small_cap", "thin_liquidity"}
    assert all(":" in f and any(ch.isdigit() for ch in f) for f in p.risk_flags)


def test_high_volatility_is_flagged() -> None:
    assert "high_volatility" in flags(closes=[100.0, 110.0] * 70)
    assert "high_volatility" not in flags(closes=FLAT)


def test_stability_flags_apply_to_non_financial_companies() -> None:
    sick = {"debtToEquity": 3.0, "fcfMargin": -0.05, "revenueGrowth": -0.10}

    assert flags(metrics=sick) == {"high_leverage", "negative_fcf", "shrinking_revenue"}
    assert flags(metrics={"debtToEquity": 0.5, "fcfMargin": 0.1, "revenueGrowth": 0.1}) == set()


SICK = {"debtToEquity": 5.0, "fcfMargin": -1.0, "revenueGrowth": -0.5}
NOTHING: dict[str, Any] = {
    "market_cap": None,
    "avg_volume": None,
    "price": None,
    "closes": [],
    "rates": {},
}


@pytest.mark.parametrize(
    ("group", "expected"),
    [
        ("general", {"high_leverage", "negative_fcf", "shrinking_revenue"}),
        ("bank", {"shrinking_revenue"}),
        ("insurer", {"shrinking_revenue"}),
        ("financial_other", {"shrinking_revenue"}),
        ("reit", {"negative_fcf", "shrinking_revenue"}),
        ("utility", {"negative_fcf", "shrinking_revenue"}),
    ],
)
def test_a_flag_is_withheld_only_where_its_measure_means_something_else(
    group: str, expected: set[str]
) -> None:
    # Leverage is by design for banks, insurers, REITs and utilities; cash flow includes
    # deposits, premiums and trading for banks, insurers and other financials. Revenue counts.
    assert flags(group=group, metrics=SICK) == expected


@pytest.mark.parametrize("metrics", [{"priceToBook": -2.0}, {"debtToEquity": -1.5}])
def test_negative_equity_is_flagged_in_every_group(metrics: dict[str, float]) -> None:
    assert "negative_equity" in flags(group="bank", metrics=metrics)
    assert "negative_equity" in flags(metrics=metrics)


def test_a_zero_price_to_book_is_not_evidence_of_negative_equity() -> None:
    assert "negative_equity" not in flags(metrics={"priceToBook": 0.0})


def test_a_negative_price_to_book_means_negative_equity_only_with_a_valid_price() -> None:
    assert "negative_equity" in flags(metrics={"priceToBook": -2.0}, price=50.0)
    assert "negative_equity" not in flags(metrics={"priceToBook": -2.0}, price=-50.0)
    assert "negative_equity" in flags(metrics={"debtToEquity": -1.5}, price=None)  # the D/E sign


def test_financial_measurements_alone_make_the_level_known() -> None:
    healthy = profile(
        **NOTHING, metrics={"debtToEquity": 0.5, "fcfMargin": 0.1, "revenueGrowth": 0.1}
    )
    sick = profile(**NOTHING, metrics=SICK)

    assert (healthy.risk_level, healthy.risk_flags) == ("low", [])
    assert sick.risk_level == "high"
    assert profile(**NOTHING).risk_level == "unknown"


@pytest.mark.parametrize("price", [-50.0, 0.0])
def test_a_price_that_is_not_positive_gives_no_traded_value(price: float) -> None:
    assert profile(price=price).avg_daily_value_eur is None
    assert "thin_liquidity" not in flags(price=price)


@pytest.mark.parametrize("cap", [-100.0, 0.0])
def test_a_market_cap_that_is_not_positive_is_unknown_not_micro(cap: float) -> None:
    p = profile(market_cap=cap)

    assert (p.market_cap_eur, p.size_bucket) == (None, "unknown")
    assert "small_cap" not in flags(market_cap=cap)


@pytest.mark.parametrize("rate", [Decimal(0), Decimal(-1)])
def test_a_conversion_rate_that_is_not_positive_converts_nothing(rate: Decimal) -> None:
    p = profile(currency="USD", rates={"USD": rate})

    assert (p.market_cap_eur, p.avg_daily_value_eur) == (None, None)


def test_a_negative_volume_is_invalid_but_zero_volume_is_real_illiquidity() -> None:
    assert profile(avg_volume=-5.0).avg_daily_value_eur is None
    assert profile(avg_volume=0.0).avg_daily_value_eur == 0.0
    assert "thin_liquidity" in flags(avg_volume=0.0)


def test_unknown_stability_data_raises_no_flag() -> None:
    assert flags(metrics={"debtToEquity": None, "fcfMargin": None}) == set()


@pytest.mark.parametrize(
    ("overrides", "level"),
    [
        ({}, "low"),
        ({"market_cap": 100e6}, "medium"),
        ({"market_cap": 100e6, "avg_volume": 1e4}, "high"),
    ],
)
def test_risk_level_counts_the_flags(overrides: dict[str, Any], level: str) -> None:
    assert profile(**overrides).risk_level == level
