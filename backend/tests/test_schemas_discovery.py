"""The contract between the two discovery lanes. A change here is a change for both."""

from datetime import datetime

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
    PortfolioExposure,
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


@pytest.mark.parametrize(("kind", "tier"), [("forum", "reliable_reporting"), ("fact", "forum")])
def test_the_forum_kind_and_the_forum_source_tier_go_together(kind: str, tier: str) -> None:
    data = sample_claim().model_dump()
    data["kind"] = kind
    data["source_tier"] = tier

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


@pytest.mark.parametrize(
    ("present", "total", "missing"),
    [(-1, 10, []), (12, 10, []), (9, 10, []), (10, 10, ["marketCap"])],
)
def test_inconsistent_coverage_is_rejected(present: int, total: int, missing: list[str]) -> None:
    with pytest.raises(ValidationError):
        Coverage(core_metrics_present=present, core_metrics_total=total, missing=missing)


def test_consistent_coverage_is_valid() -> None:
    coverage = Coverage(core_metrics_present=8, core_metrics_total=10, missing=["a", "b"])

    assert coverage.missing == ["a", "b"]


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


# Three ways to break "exactly one each of quality, valuation and fit".
BAD_SCORES = {
    "none": lambda scores: [],
    "duplicate": lambda scores: [scores[0], {**scores[0], "score": 10}, scores[2]],
    "missing": lambda scores: scores[:2],
}


@pytest.mark.parametrize("make", BAD_SCORES.values(), ids=list(BAD_SCORES))
def test_an_idea_without_one_score_per_dimension_is_rejected(make) -> None:  # type: ignore[no-untyped-def]
    data = sample_idea().model_dump()
    data["scores"] = make(data["scores"])

    with pytest.raises(ValidationError, match="quality, valuation and fit"):
        IdeaOut.model_validate(data)


def test_an_overall_score_needs_a_quality_or_valuation_score_behind_it() -> None:
    data = sample_idea().model_dump()
    for score in data["scores"]:
        score["score"] = None
    data["overall"] = 70

    with pytest.raises(ValidationError, match="overall"):
        IdeaOut.model_validate(data)


def test_an_idea_with_nothing_scored_has_no_overall() -> None:
    data = sample_idea().model_dump()
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


@pytest.mark.parametrize(
    "citation",
    [
        "",
        "   ",
        "not a url",
        "ftp://example.com/file",
        "https:///missing-host",
        "https://#fragment",
        "https://?query=1",
        "http://",
        "https://:8080/path",
        "https://user@/path",
        "https://[::1/path",
    ],
)
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


def test_a_valid_citation_keeps_its_exact_text() -> None:
    url = "https://Example.com:8080/a/b?x=1&y=2#section"
    data = sample_claim().model_dump()
    data["url"] = url

    assert Claim.model_validate(data).url == url


def test_data_notes_are_required_and_must_be_text() -> None:
    data = sample_candidate().model_dump()
    assert data["data_notes"] == []  # the sample candidate has nothing to disclose

    del data["data_notes"]
    with pytest.raises(ValidationError):
        CandidateMetrics.model_validate(data)
    with pytest.raises(ValidationError):
        CandidateMetrics.model_validate({**data, "data_notes": [None]})

    noted = CandidateMetrics.model_validate({**data, "data_notes": ["price date uncertain"]})
    assert noted.data_notes == ["price date uncertain"]
