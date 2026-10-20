"""Pure score fixtures exercise coverage, uncertainty and the complete ranking order."""

from typing import Any

import pytest

from app.analysis.discovery_score import (
    NO_OPPORTUNITY_MIN_OVERALL,
    evaluate,
    is_opportunity,
    rank_ideas,
)
from app.discovery.screen import PRICE_DATE_UNCERTAIN_PREFIX
from app.schemas_discovery import (
    CandidateFit,
    CandidateMetrics,
    Claim,
    Coverage,
    DimensionScore,
    IdeaOut,
    NegativeDevelopment,
    PeerComparison,
    ResearchEvidence,
)
from tests.discovery_fixtures import sample_candidate, sample_claim, sample_idea


def peer(metric: str, value: float, unavailable: bool = False) -> PeerComparison:
    return PeerComparison(
        metric=metric,
        value=value,
        peer_group="none" if unavailable else "industry",
        peer_count=0 if unavailable else 12,
        peer_median=None if unavailable else 0.5,
        peer_p25=None if unavailable else 0.0,
        peer_p75=None if unavailable else 1.0,
        position="unavailable" if unavailable else "within",
    )


def candidate(**updates: Any) -> CandidateMetrics:
    base = sample_candidate().model_dump()
    base.update(
        peers=[
            peer("returnOnEquity", 0.8),
            peer("operatingMargins", 0.8),
            peer("trailingPE", 0.2),
            peer("priceToSalesTrailing12Months", 0.2),
        ],
        coverage=Coverage(core_metrics_present=10, core_metrics_total=10, missing=[]),
    )
    base.update(updates)
    return CandidateMetrics.model_validate(base)


def evidence(**updates: Any) -> ResearchEvidence:
    base: dict[str, Any] = {
        "ticker": "NESN.SW",
        "claims": [sample_claim()],
        "negative_developments": [],
        "competitors": [],
        "mentions": [],
        "conflicts": [],
        "gaps": [],
    }
    base.update(updates)
    return ResearchEvidence.model_validate(base)


def fit(**updates: Any) -> CandidateFit:
    base: dict[str, Any] = {
        "ticker": "NESN.SW",
        "applicable": True,
        "avg_correlation_to_portfolio": 0.0,
        "portfolio_vol_before": 0.2,
        "portfolio_vol_after": 0.18,
        "hhi_before": 0.5,
        "hhi_after": 0.45,
        "sector_weight_before": 0.0,
        "sector_weight_after": 0.05,
        "hypothetical_weight": 0.05,
        "notes": [],
    }
    base.update(updates)
    return CandidateFit.model_validate(base)


def score_of(result: Any, name: str) -> int | None:
    return next(dimension.score for dimension in result.scores if dimension.name == name)


def idea(ticker: str = "NESN.SW", **updates: Any) -> IdeaOut:
    base = sample_idea().model_dump()
    base.update(ticker=ticker)
    base.update(updates)
    return IdeaOut.model_validate(base)


def test_peer_scores_and_overall_match_the_existing_dimension_scale() -> None:
    result = evaluate(candidate(), evidence())

    assert score_of(result, "quality") == 60
    assert score_of(result, "valuation") == 60
    assert result.overall == 60
    assert result.confidence == "high"
    assert score_of(result, "fit") is None
    assert result == evaluate(candidate(), evidence())


def test_overall_is_equal_weighted_mean_of_different_dimensions() -> None:
    result = evaluate(
        candidate(
            peers=[
                peer("returnOnEquity", 2.0),
                peer("operatingMargins", 2.0),
                peer("trailingPE", 0.5),
                peer("priceToSalesTrailing12Months", 0.5),
            ]
        ),
        evidence(),
    )

    assert [dimension.score for dimension in result.scores] == [100, 50, None]
    assert result.overall == 75


@pytest.mark.parametrize("no_peers", [[], [peer("returnOnEquity", 0.8, unavailable=True)]])
def test_no_usable_peers_is_unavailable_never_zero(no_peers: list[PeerComparison]) -> None:
    result = evaluate(candidate(peers=no_peers), evidence(), fit())

    assert [dimension.score for dimension in result.scores[:2]] == [None, None]
    assert result.overall is None
    assert result.confidence == "low"
    assert score_of(result, "fit") == 53


def test_one_available_dimension_ranks_by_it_without_filling_in_the_other() -> None:
    result = evaluate(
        candidate(peers=[peer("returnOnEquity", 0.8), peer("operatingMargins", 0.8)]), evidence()
    )

    assert [dimension.score for dimension in result.scores] == [60, None, None]
    assert result.overall == 60
    assert result.confidence == "medium"


def test_fit_is_measured_context_without_any_effect_on_overall() -> None:
    favorable = evaluate(candidate(), evidence(), fit())
    unfavorable = evaluate(
        candidate(),
        evidence(),
        fit(avg_correlation_to_portfolio=1.0, portfolio_vol_after=0.24, hhi_after=0.6),
    )

    assert score_of(favorable, "fit") == round((50 + 55 + 55) / 3)
    assert score_of(unfavorable, "fit") == round((0 + 40 + 40) / 3)
    assert favorable.overall == unfavorable.overall == 60
    assert favorable.confidence == unfavorable.confidence == "high"


@pytest.mark.parametrize(
    "updates",
    [
        {"applicable": False},
        {"avg_correlation_to_portfolio": None},
        {"portfolio_vol_before": None},
        {"portfolio_vol_after": None},
        {"portfolio_vol_before": 0.0},
        {"hhi_before": None},
        {"hhi_after": None},
        {"hhi_before": 0.0},
    ],
)
def test_fit_does_not_replace_missing_or_undefined_measures(updates: dict[str, Any]) -> None:
    assert score_of(evaluate(candidate(), evidence(), fit(**updates)), "fit") is None


def test_fit_components_are_bounded_for_large_measured_changes() -> None:
    result = evaluate(
        candidate(),
        evidence(),
        fit(avg_correlation_to_portfolio=-1.0, portfolio_vol_after=2.0, hhi_after=1.0),
    )

    assert score_of(result, "fit") == 33  # correlation 100, volatility 0, concentration 0


@pytest.mark.parametrize(
    ("present", "expected"), [(0, "low"), (4, "low"), (5, "medium"), (7, "medium"), (8, "high")]
)
def test_confidence_coverage_thresholds(present: int, expected: str) -> None:
    coverage = Coverage(
        core_metrics_present=present,
        core_metrics_total=10,
        missing=[f"missing-{index}" for index in range(10 - present)],
    )
    assert evaluate(candidate(coverage=coverage), evidence()).confidence == expected


def test_zero_core_metrics_total_is_low_confidence_without_division_by_zero() -> None:
    coverage = Coverage(core_metrics_present=0, core_metrics_total=0, missing=[])

    assert evaluate(candidate(coverage=coverage), evidence()).confidence == "low"


@pytest.mark.parametrize("updates", [{"price": None}, {"price": 0.0}, {"price_as_of": None}])
def test_unknown_or_invalid_price_data_is_low_confidence(updates: dict[str, Any]) -> None:
    result = evaluate(candidate(**updates), evidence())

    assert result.confidence == "low"
    assert result.overall == 60


@pytest.mark.parametrize(
    "prefix", [PRICE_DATE_UNCERTAIN_PREFIX, PRICE_DATE_UNCERTAIN_PREFIX.upper()]
)
def test_uncertain_freshness_lowers_confidence_without_changing_score(prefix: str) -> None:
    result = evaluate(candidate(data_notes=[f"{prefix} holiday or outage"]), evidence())

    assert result.confidence == "medium"
    assert result.overall == 60


@pytest.mark.parametrize(
    "updates",
    [{"conflicts": ["Sources disagree about guidance."]}, {"gaps": ["No bear research."]}],
)
def test_research_conflicts_and_gaps_cap_confidence(updates: dict[str, Any]) -> None:
    result = evaluate(candidate(), evidence(**updates))

    assert result.confidence == "medium"
    assert result.overall == 60


@pytest.mark.parametrize("status", ["unverified", "disputed"])
def test_unresolved_negative_development_caps_confidence(status: str) -> None:
    development = NegativeDevelopment(
        summary="Reported regulatory action.",
        occurred_on=None,
        evidence=["https://example.com/report"],
        thesis_impact="May restrict operations.",
        status=status,  # type: ignore[arg-type]
        invalidates_thesis=False,
    )

    result = evaluate(candidate(), evidence(negative_developments=[development]))

    assert result.confidence == "medium"
    assert result.overall == 60


def test_missing_or_forum_only_research_is_low_confidence() -> None:
    forum = sample_claim().model_dump()
    forum.update(kind="forum", source_tier="forum")

    for claims in ([], [Claim.model_validate(forum)]):
        result = evaluate(candidate(), evidence(claims=claims))
        assert result.confidence == "low"
        assert result.overall == 60


@pytest.mark.parametrize(
    ("kind", "tier"),
    [("fact", "other"), ("opinion", "official"), ("forecast", "reliable_reporting")],
)
def test_other_sources_or_qualitative_predictions_cannot_establish_high_confidence(
    kind: str, tier: str
) -> None:
    claim = sample_claim().model_dump()
    claim.update(kind=kind, source_tier=tier)

    assert evaluate(candidate(), evidence(claims=[claim])).confidence == "medium"


def test_repeating_claims_and_changing_origin_cannot_inflate_any_score_or_confidence() -> None:
    before = evaluate(candidate(), evidence())
    after = evaluate(
        candidate(origin="reddit", origin_note="A million votes and ten repeated bullish posts"),
        evidence(claims=[sample_claim()] * 10),
    )

    assert before == after


def test_style_tags_come_from_measured_fundamentals_with_named_thresholds() -> None:
    result = evaluate(
        candidate(
            fundamentals={"returnOnEquity": 0.2, "revenueGrowth": 0.1, "dividendYield": 0.03},
            peers=[
                peer("returnOnEquity", 2.0),
                peer("operatingMargins", 2.0),
                peer("trailingPE", -1.0),
                peer("priceToSalesTrailing12Months", -1.0),
            ],
        ),
        evidence(),
    )

    assert result.style_tags == ["quality", "value", "growth", "income", "defensive"]


def test_missing_fundamentals_never_establish_style_tags() -> None:
    assert evaluate(candidate(fundamentals={}, peers=[]), evidence()).style_tags == []


def test_defensive_sector_requires_positive_measured_roe() -> None:
    assert (
        "defensive"
        not in evaluate(candidate(fundamentals={"returnOnEquity": 0.0}), evidence()).style_tags
    )


def test_rank_order_uses_overall_then_risk_then_available_fit_then_ticker() -> None:
    def with_fit(ticker: str, fit_score: int | None, **updates: Any) -> IdeaOut:
        scores = sample_idea().scores
        scores[2] = DimensionScore(name="fit", score=fit_score, reasons=[])
        return idea(ticker, scores=scores, **updates)

    high_risk = sample_candidate().risk.model_copy(update={"risk_level": "high"})
    unknown_risk = sample_candidate().risk.model_copy(update={"risk_level": "unknown"})
    values = [
        with_fit("Z", None),
        with_fit("C", 80),
        with_fit("A", 60),
        with_fit("B", 80),
        with_fit("LOWER", 100, overall=69),
        with_fit("HIGHER", None, overall=71, risk=high_risk),
        with_fit("HIGH_RISK", 100, risk=high_risk),
        with_fit("UNKNOWN_RISK", 100, risk=unknown_risk),
        with_fit("UNRANKABLE", 100, overall=None),
    ]

    assert [row.ticker for row in rank_ideas(values)] == [
        "HIGHER",
        "B",
        "C",
        "A",
        "Z",
        "HIGH_RISK",
        "UNKNOWN_RISK",
        "LOWER",
        "UNRANKABLE",
    ]
    assert values[0].ticker == "Z"  # ranking leaves the input sequence intact


def test_explicit_fit_mapping_only_uses_applicable_measured_fit() -> None:
    values = [idea("A"), idea("B"), idea("C")]
    fits = {
        "A": fit(ticker="A", applicable=False),
        "B": fit(ticker="B", avg_correlation_to_portfolio=0.8),
        "C": fit(ticker="C", avg_correlation_to_portfolio=-0.8),
    }

    assert [row.ticker for row in rank_ideas(values, fits)] == ["C", "B", "A"]


@pytest.mark.parametrize(
    ("overall", "confidence", "expected"),
    [
        (None, "high", False),
        (59, "high", False),
        (60, "low", False),
        (60, "medium", True),
        (60, "high", True),
        (100, "low", False),
    ],
)
def test_no_opportunity_boundary(overall: int | None, confidence: str, expected: bool) -> None:
    assert NO_OPPORTUNITY_MIN_OVERALL == 60
    assert is_opportunity(idea(overall=overall, confidence=confidence)) is expected


def test_empty_ranking_is_a_valid_no_opportunity_result() -> None:
    assert rank_ideas([]) == []


@pytest.mark.parametrize("mismatch", ["evidence", "fit"])
def test_evaluation_rejects_mixed_candidate_context(mismatch: str) -> None:
    with pytest.raises(ValueError, match="candidate ticker"):
        evaluate(
            candidate(),
            evidence(ticker="OTHER" if mismatch == "evidence" else "NESN.SW"),
            fit(ticker="OTHER" if mismatch == "fit" else "NESN.SW"),
        )
