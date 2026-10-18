"""Synthetic price series make covariance, exposure and candidate-fit errors observable."""

import math
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from statistics import covariance, variance

import pytest

from app.analysis.portfolio import (
    PositionInput,
    analyze_portfolio,
    annualized_volatility,
    log_returns,
    marginal_effect,
    pairwise_correlation,
)
from app.fx import EurPrice

AS_OF = datetime(2026, 10, 15, 12, tzinfo=UTC)


def curve(phase: float = 0, count: int = 121) -> dict[str, float]:
    day = AS_OF.date()
    dates = []
    while len(dates) < count:
        if day.weekday() < 5:
            dates.append(day.isoformat())
        day -= timedelta(days=1)
    value, result = 100.0, {}
    for i, day_text in enumerate(reversed(dates)):
        value *= math.exp(0.001 + 0.01 * math.sin(i + phase))
        result[day_text] = value
    return result


def analysis(histories=None, profiles=None, holdings=None, prices=None, skipped=None):
    histories = histories if histories is not None else {"A": curve(), "B": curve(1)}
    prices = (
        prices
        if prices is not None
        else {
            "A": EurPrice(Decimal(100), "EUR", Decimal(1)),
            "B": EurPrice(Decimal(100), "USD", Decimal("0.8")),
        }
    )
    holdings = (
        holdings
        if holdings is not None
        else [
            PositionInput("A", "Alpha", 2, "STOCK", "Technology"),
            PositionInput("B", "Beta", 1, "STOCK"),
        ]
    )
    return analyze_portfolio(holdings, prices, histories, profiles or {}, AS_OF, skipped)


def test_eur_values_and_each_exposure_partition_preserve_all_priced_weight():
    histories = {"A": {"2026-10-15": 100.0}, "B": {"2026-10-15": 200.0}}
    exposure = analysis(histories)

    assert exposure.total_value_eur == pytest.approx(360)
    assert [p.value_eur for p in exposure.positions] == pytest.approx([200, 160])
    assert [p.weight for p in exposure.positions] == pytest.approx([5 / 9, 4 / 9])
    for partition in (
        exposure.by_sector,
        exposure.by_industry,
        exposure.by_country,
        exposure.by_currency,
    ):
        assert sum(group.weight for group in partition) == pytest.approx(1, abs=1e-9)
    assert any(group.label == "Unclassified" for group in exposure.by_sector)
    assert exposure.hhi == pytest.approx((5 / 9) ** 2 + (4 / 9) ** 2)
    assert exposure.effective_n == pytest.approx(1 / exposure.hhi)


def test_pence_price_and_timestamp_are_from_the_same_dated_observation():
    exposure = analysis(
        histories={"A": {"2026-10-15": 5000.0}},
        holdings=[PositionInput("A", "London", 2, "STOCK")],
        prices={"A": EurPrice(Decimal(100), "GBp", Decimal("0.0125"))},
    )
    assert exposure.total_value_eur == 125
    [position] = exposure.positions
    assert position.price == 5000
    assert position.currency == "GBp"
    assert position.price_as_of == datetime(2026, 10, 15, tzinfo=UTC)
    assert position.stale is False


def test_quote_fallback_is_retained_with_unknown_timestamp_when_history_fails():
    exposure = analysis(histories={})

    assert exposure.total_value_eur == 300
    assert all(p.price_as_of is None and p.stale for p in exposure.positions)
    assert exposure.volatility_annualized is None
    assert any("no price history" in note for note in exposure.notes)


def test_missing_price_is_skipped_and_the_other_position_still_works():
    exposure = analysis(prices={"A": EurPrice(Decimal(10), "EUR", Decimal(1))})

    assert [p.ticker for p in exposure.positions] == ["A"]
    assert exposure.positions[0].weight == 1
    assert "B" in exposure.skipped
    assert any("priced positions only" in note for note in exposure.notes)


def test_unknown_country_and_etf_category_are_explicit_buckets_not_look_through():
    exposure = analysis(
        holdings=[PositionInput("A", "Fund", 1, "ETF", "Technology")],
        profiles={"A": {"category": "Global Equity", "sector": "Technology"}},
    )
    assert exposure.by_sector[0].label == "ETF: Global Equity"
    assert exposure.by_industry[0].label == "ETF: Global Equity"
    assert exposure.by_country[0].label == "Unclassified"
    assert any("no constituent look-through" in note for note in exposure.notes)


def test_profile_metadata_supplies_industry_and_country_without_storing_it():
    exposure = analysis(
        profiles={"B": {"industry": "Banks", "country": "Japan", "sector": "Finance"}}
    )

    assert any(group.label == "Japan" for group in exposure.by_country)
    assert any(group.label == "Banks" for group in exposure.by_industry)
    assert any(group.label == "Financial Services" for group in exposure.by_sector)


def test_all_none_profile_still_explains_unclassified_exposures():
    exposure = analysis(profiles={"A": {"sector": None, "country": None, "category": None}})
    assert any("A: profile unavailable" in note for note in exposure.notes)


def test_manual_and_provider_sector_names_share_one_normalized_bucket():
    exposure = analysis(
        holdings=[
            PositionInput("A", "Alpha", 1, "STOCK", "  tech  "),
            PositionInput("B", "Beta", 1, "STOCK"),
        ],
        profiles={"B": {"sector": "Technology"}},
    )
    assert [(group.label, group.weight) for group in exposure.by_sector] == [("Technology", 1)]


def test_literal_unclassified_and_missing_sector_share_one_bucket():
    exposure = analysis(
        holdings=[
            PositionInput("A", "Alpha", 1, "STOCK", "unclassified"),
            PositionInput("B", "Beta", 1, "STOCK"),
        ]
    )
    assert [(group.label, group.weight) for group in exposure.by_sector] == [("Unclassified", 1)]


def test_unknown_sector_spelling_is_preserved_but_case_variants_share_exposure_and_fit():
    exposure = analysis(
        holdings=[
            PositionInput("A", "Alpha", 1, "STOCK", "Semiconductors"),
            PositionInput("B", "Beta", 1, "STOCK", "semiconductors"),
        ],
    )
    assert [(group.label, group.weight) for group in exposure.by_sector] == [("Semiconductors", 1)]
    returns = log_returns(curve())
    result = marginal_effect(
        exposure,
        returns,
        "SEMICONDUCTORS",
        ticker="C",
        portfolio_returns={"A": returns, "B": returns},
    )
    assert result.sector_weight_before == 1


def test_provider_labels_stay_bounded_and_the_untrusted_note_survives_candidate_fit():
    exposure = analysis(profiles={"A": {"sector": "s" * 5000, "country": "c" * 5000}})
    assert all(len(group.label) <= 100 for group in exposure.by_sector + exposure.by_country)
    result = marginal_effect(exposure, {}, None, ticker="C", portfolio_returns={})
    assert any("untrusted provider text" in note for note in result.notes)


def test_correlation_matrix_is_symmetric_with_undefined_values_preserved():
    exposure = analysis(histories={"A": curve(), "B": dict.fromkeys(curve(), 100.0)})
    assert exposure.correlation["A"]["B"] is None
    assert exposure.correlation["B"]["A"] is None
    assert exposure.correlation["A"]["A"] == pytest.approx(1)


def test_portfolio_volatility_matches_the_covariance_matrix_formula():
    a, b = curve(), curve(1)
    exposure = analysis({"A": a, "B": b})
    w_a, w_b = [p.weight for p in exposure.positions]
    r_a, r_b = list(log_returns(a).values()), list(log_returns(b).values())
    expected = 252 * (
        w_a**2 * variance(r_a) + w_b**2 * variance(r_b) + 2 * w_a * w_b * covariance(r_a, r_b)
    )
    assert exposure.volatility_annualized == pytest.approx(math.sqrt(expected))
    assert annualized_volatility(log_returns(a)) == pytest.approx(math.sqrt(252 * variance(r_a)))


def test_identical_nonconstant_series_have_correlation_one():
    exposure = analysis({"A": curve(), "B": curve()})
    assert exposure.correlation["A"]["B"] == pytest.approx(1)


def test_constant_series_have_no_defined_correlation_but_zero_volatility():
    history = dict.fromkeys(curve(), 100.0)
    assert pairwise_correlation(log_returns(history), log_returns(history)) is None
    assert annualized_volatility(log_returns(history)) == 0


@pytest.mark.parametrize(("observations", "available"), [(60, False), (61, True)])
def test_sixty_matching_return_intervals_are_required(observations, available):
    a, b = curve(count=observations), curve(count=observations)
    assert (pairwise_correlation(log_returns(a), log_returns(b)) is not None) is available


def test_dates_must_overlap_not_just_series_lengths():
    early = {date(2020, 1, 1).isoformat(): 100.0}
    for i in range(1, 121):
        early[(date(2020, 1, 1) + timedelta(days=i)).isoformat()] = 100 + i
    assert pairwise_correlation(log_returns(early), log_returns(curve())) is None


def test_return_intervals_match_both_endpoints_around_different_exchange_calendars():
    a = curve(count=62)
    b = dict(a)
    del b[list(a)[20]]
    # A's two one-day returns do not match B's one two-day return: only 59 intervals agree.
    assert pairwise_correlation(log_returns(a), log_returns(b)) is None


def test_missing_history_does_not_renormalize_risk_to_the_usable_holding():
    exposure = analysis(histories={"A": curve()})
    assert len(exposure.positions) == 2
    assert exposure.volatility_annualized is None
    assert exposure.correlation["A"]["B"] is None


def test_invalid_and_future_prices_never_enter_return_computation():
    history = {**curve(), "invalid": 100, "2026-10-16": 1e20, "2026-10-14": float("nan")}
    exposure = analysis(histories={"A": history, "B": curve()})
    assert all(math.isfinite(p.price) for p in exposure.positions)
    assert all(p.price_as_of.date() <= AS_OF.date() for p in exposure.positions)
    assert exposure.total_value_eur < 1000


def test_sold_out_positions_are_not_valued_or_reported_as_skipped():
    exposure = analysis(holdings=[PositionInput("SOLD", "Sold", 0, "STOCK")])
    assert exposure.positions == [] and exposure.skipped == {}


def fit(exposure, candidate_returns, portfolio_returns, **kwargs):
    return marginal_effect(
        exposure,
        candidate_returns,
        "Technology",
        ticker="C",
        portfolio_returns=portfolio_returns,
        **kwargs,
    )


def test_adding_the_same_return_stream_does_not_invent_diversification():
    returns = log_returns(curve())
    exposure = analysis({"A": curve(), "B": curve()})
    result = fit(exposure, returns, {"A": returns, "B": returns})
    assert result.applicable
    assert result.avg_correlation_to_portfolio == pytest.approx(1)
    assert result.portfolio_vol_after == pytest.approx(result.portfolio_vol_before)
    assert result.hhi_after == pytest.approx(exposure.hhi * 0.95**2 + 0.05**2)
    assert any("FX moves are excluded" in note for note in result.notes)


def test_opposite_candidate_returns_reduce_volatility_with_consistent_weights():
    returns = log_returns(curve())
    opposite = {key: -value for key, value in returns.items()}
    exposure = analysis({"A": curve(), "B": curve()})
    result = fit(exposure, opposite, {"A": returns, "B": returns})
    assert result.portfolio_vol_after == pytest.approx(0.9 * result.portfolio_vol_before)
    assert result.avg_correlation_to_portfolio == pytest.approx(-1)
    assert result.sector_weight_after == pytest.approx(0.95 * result.sector_weight_before + 0.05)


@pytest.mark.parametrize("holdings", [[], [PositionInput("A", "Alpha", 1, "STOCK")]])
def test_empty_or_single_holding_has_no_applicable_fit(holdings):
    exposure = analysis(holdings=holdings)
    result = fit(exposure, log_returns(curve()), {"A": log_returns(curve())})
    assert result.applicable is False
    assert result.portfolio_vol_after is None
    if not holdings:
        assert exposure.total_value_eur is None
        assert exposure.effective_n is None


def test_candidate_with_insufficient_overlap_is_not_applicable():
    returns = log_returns(curve())
    result = fit(analysis(), log_returns(curve(count=30)), {"A": returns, "B": returns})
    assert result.applicable is False and result.hhi_after is None


def test_before_after_fit_uses_the_same_window_as_the_candidate():
    returns = log_returns(curve())
    candidate = dict(list(returns.items())[-60:])
    result = fit(analysis(), candidate, {"A": returns, "B": returns})

    assert result.applicable
    assert result.portfolio_vol_before == pytest.approx(annualized_volatility(candidate))
    assert result.portfolio_vol_after == pytest.approx(result.portfolio_vol_before)


def test_existing_position_cannot_be_counted_twice_as_a_new_candidate():
    returns = log_returns(curve())
    result = marginal_effect(
        analysis(),
        returns,
        "Technology",
        ticker="A",
        portfolio_returns={"A": returns, "B": returns},
    )
    assert result.applicable is False
    assert result.hhi_after is None


@pytest.mark.parametrize("weight", [0, -1, 1.01, float("nan"), float("inf")])
def test_hypothetical_weight_must_be_a_finite_positive_share(weight):
    with pytest.raises(ValueError, match="hypothetical_weight"):
        fit(analysis(), {}, {}, hypothetical_weight=weight)
