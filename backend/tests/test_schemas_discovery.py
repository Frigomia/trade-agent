"""The contract between the two discovery lanes. A change here is a change for both."""

from datetime import date, datetime

import pytest
from pydantic import ValidationError

from app.schemas_discovery import (
    CandidateFit,
    CandidateMetrics,
    Claim,
    Coverage,
    DimensionScore,
    Exclusion,
    IdeaOut,
    Mention,
    NegativeDevelopment,
    PeerComparison,
    PortfolioExposure,
    RejectedMention,
    ResearchEvidence,
    RiskProfile,
)
from tests.discovery_fixtures import (
    sample_candidate,
    sample_claim,
    sample_evidence,
    sample_exposure,
    sample_idea,
)


def test_every_sample_survives_a_json_round_trip() -> None:
    for model in (
        sample_exposure(),
        sample_candidate(),
        sample_evidence(),
        sample_idea(),
    ):
        again = type(model).model_validate_json(model.model_dump_json())

        assert again == model


def test_a_misspelled_field_is_rejected_instead_of_silently_dropped() -> None:
    data = sample_candidate().model_dump()
    data["sektor"] = "Technology"

    with pytest.raises(ValidationError):
        CandidateMetrics.model_validate(data)


def test_an_unknown_literal_value_is_rejected() -> None:
    data = sample_candidate().model_dump()
    data["origin"] = "twitter"

    with pytest.raises(ValidationError):
        CandidateMetrics.model_validate(data)


def test_a_missing_dimension_score_is_explicit_none_not_a_default() -> None:
    unavailable = DimensionScore(name="valuation", score=None, reasons=["No peer comparison"])

    assert unavailable.score is None
    with pytest.raises(ValidationError):
        DimensionScore(name="valuation", reasons=[])  # type: ignore[call-arg]


@pytest.mark.parametrize("score", [-1, 101])
def test_a_dimension_score_outside_zero_to_one_hundred_is_rejected(score: int) -> None:
    with pytest.raises(ValidationError):
        DimensionScore(name="quality", score=score, reasons=[])


def test_a_forum_claim_must_carry_the_forum_source_tier() -> None:
    data = sample_claim().model_dump()
    data["kind"] = "forum"
    data["source_tier"] = "reliable_reporting"

    with pytest.raises(ValidationError, match="forum"):
        Claim.model_validate(data)


def test_a_non_forum_claim_cannot_claim_the_forum_source_tier() -> None:
    data = sample_claim().model_dump()
    data["kind"] = "fact"
    data["source_tier"] = "forum"

    with pytest.raises(ValidationError, match="forum"):
        Claim.model_validate(data)


def test_a_thesis_exclusion_must_cite_its_evidence() -> None:
    with pytest.raises(ValidationError, match="evidence"):
        Exclusion(
            ticker="XYZ",
            name="XYZ Corp",
            reason="thesis_invalidated",
            explanation="The regulator withdrew the licence.",
            evidence=[],
        )


def test_a_data_exclusion_needs_no_evidence_urls() -> None:
    exclusion = Exclusion(
        ticker="XYZ",
        name="XYZ Corp",
        reason="unreliable_price",
        explanation="The last close is 12 days old.",
        evidence=[],
    )

    assert exclusion.reason == "unreliable_price"


def test_portfolio_weights_stay_between_zero_and_one() -> None:
    data = sample_exposure().model_dump()
    data["by_sector"][0]["weight"] = 1.2

    with pytest.raises(ValidationError):
        PortfolioExposure.model_validate(data)


def test_an_empty_portfolio_is_representable() -> None:
    exposure = PortfolioExposure(
        as_of=datetime(2026, 10, 15, 9, 0),
        total_value_eur=None,
        positions=[],
        by_sector=[],
        by_industry=[],
        by_country=[],
        by_currency=[],
        top_position_weight=None,
        hhi=None,
        effective_n=None,
        volatility_annualized=None,
        correlation={},
        skipped={},
    )
    fit = CandidateFit(
        ticker="SAP.DE",
        applicable=False,
        avg_correlation_to_portfolio=None,
        portfolio_vol_before=None,
        portfolio_vol_after=None,
        hhi_before=None,
        hhi_after=None,
        sector_weight_before=None,
        sector_weight_after=None,
        hypothetical_weight=0.05,
        notes=["No holdings to compare with."],
    )

    assert exposure.total_value_eur is None
    assert not fit.applicable


def test_an_unavailable_peer_comparison_is_representable() -> None:
    peer = PeerComparison(
        metric="freeCashflow",
        value=1.2e9,
        peer_group="none",
        peer_count=3,
        peer_median=None,
        peer_p25=None,
        peer_p75=None,
        position="unavailable",
    )

    assert peer.peer_median is None


def test_coverage_counts_cannot_be_negative() -> None:
    with pytest.raises(ValidationError):
        Coverage(core_metrics_present=-1, core_metrics_total=10, missing=[])


def test_a_mention_carries_no_scoring_fields() -> None:
    # The source of a discovered company has zero scoring weight: nothing numeric belongs here.
    assert set(Mention.model_fields) == {
        "name",
        "ticker_hint",
        "exchange_hint",
        "origin",
        "reason",
        "url",
    }


def test_a_rejected_mention_names_why_it_was_rejected() -> None:
    mention = Mention(
        name="Orange",
        ticker_hint=None,
        exchange_hint=None,
        origin="reddit",
        reason="Mentioned in r/stocks",
        url=None,
    )

    rejected = RejectedMention(mention=mention, reason="ambiguous")

    assert rejected.reason == "ambiguous"


def test_a_negative_development_records_what_when_and_how_sure() -> None:
    development = NegativeDevelopment(
        summary="Regulator opened an investigation.",
        occurred_on=date(2026, 10, 1),
        evidence=["https://example.com/a"],
        thesis_impact="Weakens the margin assumption.",
        status="disputed",
        invalidates_thesis=False,
    )

    assert development.status == "disputed"


def test_research_evidence_lists_gaps_instead_of_inventing_claims() -> None:
    evidence = ResearchEvidence(
        ticker="SAP.DE",
        claims=[],
        negative_developments=[],
        competitors=[],
        mentions=[],
        conflicts=[],
        gaps=["No news found in the last 30 days."],
    )

    assert evidence.gaps


def test_an_idea_keeps_the_numeric_and_the_qualitative_parts_apart() -> None:
    idea = sample_idea()

    assert {score.name for score in idea.scores} <= {"quality", "valuation", "fit"}
    assert isinstance(idea.outlook, str)  # a sentence, never a number
    assert isinstance(idea.risk, RiskProfile)


# ---- Review round: plan fields restored and validation gaps closed ---------------------------


def test_effective_n_is_part_of_the_portfolio_exposure() -> None:
    exposure = sample_exposure()

    assert exposure.effective_n == pytest.approx(1 / exposure.hhi)  # type: ignore[operator]
    data = exposure.model_dump()
    data["effective_n"] = None
    assert PortfolioExposure.model_validate(data).effective_n is None


def test_style_tags_are_part_of_an_idea() -> None:
    assert sample_idea().style_tags == ["quality", "defensive"]


def test_an_unavailable_pairwise_correlation_is_representable() -> None:
    data = sample_exposure().model_dump()
    data["correlation"] = {"SAP.DE": {"AAPL": None}, "AAPL": {"SAP.DE": None}}

    exposure = PortfolioExposure.model_validate(data)

    assert exposure.correlation["SAP.DE"]["AAPL"] is None


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_numbers_are_rejected_not_turned_into_null(bad: float) -> None:
    data = sample_candidate().model_dump()
    data["price"] = bad
    with pytest.raises(ValidationError):
        CandidateMetrics.model_validate(data)

    data = sample_candidate().model_dump()
    data["fundamentals"]["trailingPE"] = bad
    with pytest.raises(ValidationError):
        CandidateMetrics.model_validate(data)


def test_an_unavailable_number_is_still_valid_as_none() -> None:
    data = sample_candidate().model_dump()
    data["price"] = None
    data["fundamentals"]["trailingPE"] = None

    assert CandidateMetrics.model_validate(data).price is None


def _idea_data() -> dict:
    return sample_idea().model_dump()


def test_an_idea_with_no_scores_is_rejected() -> None:
    data = _idea_data()
    data["scores"] = []

    with pytest.raises(ValidationError, match="quality, valuation and fit"):
        IdeaOut.model_validate(data)


def test_an_idea_with_a_duplicate_dimension_is_rejected() -> None:
    data = _idea_data()
    data["scores"][1] = {"name": "quality", "score": 10, "reasons": []}

    with pytest.raises(ValidationError, match="quality, valuation and fit"):
        IdeaOut.model_validate(data)


def test_an_idea_missing_a_dimension_is_rejected() -> None:
    data = _idea_data()
    data["scores"] = data["scores"][:2]

    with pytest.raises(ValidationError, match="quality, valuation and fit"):
        IdeaOut.model_validate(data)


def test_an_overall_score_needs_a_quality_or_valuation_score_behind_it() -> None:
    data = _idea_data()
    for score in data["scores"]:
        score["score"] = None
    data["overall"] = 70

    with pytest.raises(ValidationError, match="overall"):
        IdeaOut.model_validate(data)


def test_an_idea_with_nothing_scored_has_no_overall() -> None:
    data = _idea_data()
    for score in data["scores"]:
        score["score"] = None
    data["overall"] = None

    assert IdeaOut.model_validate(data).overall is None


def test_a_hypothetical_weight_is_bounded_like_every_other_weight() -> None:
    fit = CandidateFit(
        ticker="SAP.DE",
        applicable=True,
        avg_correlation_to_portfolio=0.3,
        portfolio_vol_before=0.2,
        portfolio_vol_after=0.19,
        hhi_before=0.5,
        hhi_after=0.4,
        sector_weight_before=0.5,
        sector_weight_after=0.52,
        hypothetical_weight=0.05,
        notes=[],
    )
    data = fit.model_dump()
    data["hypothetical_weight"] = 2.0

    with pytest.raises(ValidationError):
        CandidateFit.model_validate(data)


def test_coverage_cannot_report_more_present_than_total() -> None:
    with pytest.raises(ValidationError, match="present"):
        Coverage(core_metrics_present=12, core_metrics_total=10, missing=[])


def test_coverage_missing_list_matches_the_counts() -> None:
    with pytest.raises(ValidationError, match="missing"):
        Coverage(core_metrics_present=9, core_metrics_total=10, missing=[])
    with pytest.raises(ValidationError, match="missing"):
        Coverage(core_metrics_present=10, core_metrics_total=10, missing=["marketCap"])

    assert Coverage(core_metrics_present=8, core_metrics_total=10, missing=["a", "b"]).missing


@pytest.mark.parametrize("citation", ["", "   ", "not a url", "ftp://example.com/file"])
def test_a_blank_or_non_http_citation_is_rejected_on_an_exclusion(citation: str) -> None:
    with pytest.raises(ValidationError):
        Exclusion(
            ticker="XYZ",
            name="XYZ Corp",
            reason="thesis_invalidated",
            explanation="The regulator withdrew the licence.",
            evidence=[citation],
        )


def test_a_thesis_exclusion_with_an_http_citation_is_valid() -> None:
    exclusion = Exclusion(
        ticker="XYZ",
        name="XYZ Corp",
        reason="thesis_invalidated",
        explanation="The regulator withdrew the licence.",
        evidence=["https://example.com/notice"],
    )

    assert exclusion.evidence == ["https://example.com/notice"]


def test_every_citation_in_the_contract_must_be_a_usable_url() -> None:
    claim = sample_claim().model_dump()
    claim["url"] = ""
    with pytest.raises(ValidationError):
        Claim.model_validate(claim)

    development = sample_evidence().negative_developments[0].model_dump()
    development["evidence"] = ["see the filing"]
    with pytest.raises(ValidationError):
        NegativeDevelopment.model_validate(development)

    with pytest.raises(ValidationError):
        Mention(
            name="Orange",
            ticker_hint=None,
            exchange_hint=None,
            origin="reddit",
            reason="r/stocks",
            url="javascript:alert(1)",
        )
