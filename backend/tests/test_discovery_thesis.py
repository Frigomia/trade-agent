from datetime import date

import pytest

from app.discovery.thesis import (
    dated_catalysts,
    exclusion_for,
    normalize_evidence,
    pending_development,
)
from app.schemas_discovery import Catalyst, NegativeDevelopment, ResearchEvidence
from tests.discovery_fixtures import sample_candidate, sample_claim

FACT = "The company lost its operating licence."


@pytest.mark.parametrize(
    "kind,tier,status,expected",
    [
        ("fact", "official", "confirmed", "confirmed"),
        ("fact", "official", "disputed", "disputed"),
        ("forecast", "official", "confirmed", "unverified"),
        ("opinion", "official", "confirmed", "unverified"),
        ("forum", "forum", "confirmed", "unverified"),
        ("fact", "other", "confirmed", "unverified"),
    ],
)
def test_claim_confirmation_is_gated_after_source_host_reclassification(
    kind, tier, status, expected
):
    raw = evidence()
    raw.claims[0] = raw.claims[0].model_copy(
        update={
            "kind": kind,
            "source_tier": tier,
            "status": status,
            "url": "https://unknown.example/report" if tier == "other" else raw.claims[0].url,
        }
    )
    normalized = normalize_evidence(raw)
    assert normalized.claims[0].status == expected
    assert raw.claims[0].status == status


@pytest.mark.parametrize(
    "excerpt,supported",
    [
        ("Earnings will be released on 2026-11-06.", True),
        ("Earnings will be released on November 6, 2026.", True),
        ("Earnings will be released on 6 November 2026.", True),
        ("Earnings will be released on 6 Nov. 2026.", True),
        ("Earnings will be released on 6 Nov.", False),
        ("Earnings will be released in November 2026.", False),
        ("The previous earnings were on 2025-11-06.", False),
        ("Earnings date is unavailable.", False),
        ("Unrelated reference: x2026-11-06x.", False),
    ],
)
def test_catalyst_date_requires_a_full_date_in_its_cited_event_excerpt(excerpt, supported):
    raw = evidence()
    raw.claims[0] = raw.claims[0].model_copy(update={"text": excerpt})
    catalyst = Catalyst(
        text="Earnings release",
        occurs_on=date(2026, 11, 6),
        event_id=raw.claims[0].event_id,
        evidence=[raw.claims[0].url],
    )
    out = dated_catalysts([catalyst], raw)[0]
    assert out.occurs_on == (date(2026, 11, 6) if supported else None)
    assert out.text == catalyst.text and out.evidence == catalyst.evidence
    assert catalyst.occurs_on == date(2026, 11, 6)


def test_date_from_another_event_in_the_same_article_or_publication_metadata_is_not_used():
    raw = evidence()
    raw.claims[0].published_at = date(2026, 11, 6)
    catalyst = Catalyst(
        text="Earnings release",
        occurs_on=date(2026, 11, 6),
        event_id=raw.claims[0].event_id,
        evidence=[raw.claims[0].url],
    )
    assert dated_catalysts([catalyst], raw)[0].occurs_on is None
    raw.claims.append(
        raw.claims[0].model_copy(
            update={"event_id": "different-event", "text": "Product launch on 2026-11-06."}
        )
    )
    assert dated_catalysts([catalyst], raw)[0].occurs_on is None
    raw.claims[0].text = "Earnings on 2026-11-06."
    assert dated_catalysts([catalyst.model_copy(update={"evidence": []})], raw)[0].occurs_on is None


def evidence(url: str = "https://www.reuters.com/business/licence") -> ResearchEvidence:
    claim = sample_claim().model_copy(update={"text": FACT, "url": url, "stance": "bear"})
    return ResearchEvidence(
        ticker=sample_candidate().ticker,
        claims=[claim],
        negative_developments=[
            NegativeDevelopment(
                summary="Operating licence revoked",
                occurred_on=date(2026, 10, 10),
                evidence=[url],
                thesis_impact="The licensed business cannot operate.",
                status="confirmed",
                invalidates_thesis=True,
            )
        ],
        competitors=[],
        mentions=[],
        conflicts=[],
        gaps=[],
    )


def assessment(url: str) -> dict[str, object]:
    return {
        "invalidates_thesis": True,
        "explanation": f'"{FACT}" removes the operating premise of the thesis.',
        "evidence": [url],
    }


def test_verified_high_material_fact_and_quoted_reassessment_can_exclude() -> None:
    raw = evidence()
    normalized = normalize_evidence(raw)
    result = exclusion_for(sample_candidate(), normalized, assessment(normalized.claims[0].url))
    assert result is not None
    assert result.reason == "thesis_invalidated"
    assert FACT in result.explanation
    assert "2026-10-10" in result.explanation and "Confirmed" in result.explanation
    assert normalized.negative_developments[0].thesis_impact in result.explanation
    assert result.evidence == [normalized.claims[0].url]
    assert raw.claims[0].source_tier == "official"  # input was not mutated
    assert normalized.claims[0].source_tier == "reliable_reporting"


@pytest.mark.parametrize(
    "url",
    [
        "https://unknown.example/licence",
        "https://reuters.com.attacker.example/licence",
        "https://notreuters.com/licence",
        "https://www.reddit.com/r/stocks/comments/licence",
    ],
)
def test_model_claiming_an_official_source_cannot_bypass_host_verification(url: str) -> None:
    normalized = normalize_evidence(evidence(url))
    assert normalized.negative_developments[0].status == "unverified"
    assert not normalized.negative_developments[0].invalidates_thesis
    assert exclusion_for(sample_candidate(), normalized, assessment(url)) is None
    assert pending_development(normalized) is not None


def test_verified_issuer_host_is_explicit_and_cannot_match_a_suffix_attack() -> None:
    url = "https://investors.issuer.example/licence"
    normalized = normalize_evidence(evidence(url), official_hosts={"issuer.example"})
    assert normalized.claims[0].source_tier == "official"
    assert exclusion_for(sample_candidate(), normalized, assessment(url)) is not None
    spoofed = normalize_evidence(
        evidence(url + "/../other"), official_hosts={"issuer.example.evil"}
    )
    assert spoofed.claims[0].source_tier == "other"


def test_forum_label_is_preserved_even_on_an_otherwise_trusted_host() -> None:
    raw = evidence()
    raw.claims[0] = raw.claims[0].model_copy(update={"kind": "forum", "source_tier": "forum"})
    normalized = normalize_evidence(raw)
    assert normalized.claims[0].kind == normalized.claims[0].source_tier == "forum"
    assert (
        exclusion_for(sample_candidate(), normalized, assessment(normalized.claims[0].url)) is None
    )


@pytest.mark.parametrize(
    "field,value", [("materiality", "medium"), ("kind", "opinion"), ("kind", "forecast")]
)
def test_a_lower_materiality_or_nonfactual_claim_does_not_exclude(field: str, value: str) -> None:
    raw = evidence()
    raw.claims[0] = raw.claims[0].model_copy(update={field: value})
    normalized = normalize_evidence(raw)
    assert (
        exclusion_for(sample_candidate(), normalized, assessment(normalized.claims[0].url)) is None
    )


@pytest.mark.parametrize(
    "change",
    [
        {"invalidates_thesis": "true"},
        {"invalidates_thesis": False},
        {"explanation": "It invalidates the thesis without quoting evidence."},
        {"evidence": ["https://www.reuters.com/invented"]},
        {"evidence": []},
        {"evidence": "https://www.reuters.com/business/licence"},
    ],
)
def test_reassessment_must_quote_and_cite_the_actual_eligible_claim(
    change: dict[str, object],
) -> None:
    normalized = normalize_evidence(evidence())
    decision = {**assessment(normalized.claims[0].url), **change}
    assert exclusion_for(sample_candidate(), normalized, decision) is None


def test_disputed_development_or_other_candidate_cannot_be_excluded() -> None:
    normalized = normalize_evidence(evidence())
    normalized.negative_developments[0].status = "disputed"
    assert (
        exclusion_for(sample_candidate(), normalized, assessment(normalized.claims[0].url)) is None
    )
    normalized = normalize_evidence(evidence()).model_copy(update={"ticker": "OTHER"})
    assert (
        exclusion_for(sample_candidate(), normalized, assessment(normalized.claims[0].url)) is None
    )


def test_unknown_development_citations_are_removed_without_losing_the_allegation() -> None:
    raw = evidence()
    raw.negative_developments[0].evidence = ["https://www.reuters.com/not-fetched"]
    normalized = normalize_evidence(raw)
    assert normalized.negative_developments[0].summary == "Operating licence revoked"
    assert normalized.negative_developments[0].evidence == []
    assert normalized.negative_developments[0].status == "unverified"


@pytest.mark.parametrize("field", ["explanation", "summary", "thesis_impact"])
@pytest.mark.parametrize(
    "extra",
    [
        " See https://invented.example/report.",
        " See //invented.example/report.",
        " See [support](//invented.example/report).",
        " See <https://invented.example/report>.",
        " See javascript:alert(1).",
    ],
)
def test_embedded_unfetched_or_unsupported_citations_cannot_exclude(field: str, extra: str) -> None:
    normalized = normalize_evidence(evidence())
    decision = assessment(normalized.claims[0].url)
    if field == "explanation":
        decision[field] = str(decision[field]) + extra
    else:
        development = normalized.negative_developments[0]
        setattr(development, field, getattr(development, field) + extra)
    assert exclusion_for(sample_candidate(), normalized, decision) is None


def test_plain_text_fetched_citation_is_allowed_in_exclusion_explanation() -> None:
    normalized = normalize_evidence(evidence())
    url = normalized.claims[0].url
    decision = assessment(url)
    decision["explanation"] = str(decision["explanation"]) + f" See {url}."
    assert exclusion_for(sample_candidate(), normalized, decision) is not None


@pytest.mark.parametrize("bear_first", [True, False])
def test_distinct_facts_in_one_article_survive_and_the_quoted_bear_fact_can_exclude(
    bear_first: bool,
) -> None:
    raw = evidence()
    bear = raw.claims[0]
    bull = bear.model_copy(
        update={"text": "Revenue increased ten percent.", "event_id": "earnings", "stance": "bull"}
    )
    raw.claims = [bear, bull] if bear_first else [bull, bear]
    normalized = normalize_evidence(raw)
    assert len(normalized.claims) == 2
    assert exclusion_for(sample_candidate(), normalized, assessment(bear.url)) is not None


def test_quote_of_low_materiality_fact_cannot_borrow_another_claims_high_materiality() -> None:
    raw = evidence()
    high = raw.claims[0]
    low = high.model_copy(
        update={
            "text": "The filing was published today.",
            "event_id": "filing",
            "materiality": "low",
        }
    )
    raw.claims = [high, low]
    normalized = normalize_evidence(raw)
    decision = {**assessment(high.url), "explanation": f'"{low.text}" invalidates the thesis.'}
    assert exclusion_for(sample_candidate(), normalized, decision) is None


@pytest.mark.parametrize(
    "url",
    [
        "https://stocktwits.com/symbol/EXM",
        "https://news.ycombinator.com/item?id=123",
        "https://seekingalpha.com/article/123#comments",
    ],
)
def test_other_community_sources_are_forum_evidence(url: str) -> None:
    normalized = normalize_evidence(evidence(url))
    assert normalized.claims[0].kind == normalized.claims[0].source_tier == "forum"
    assert normalized.negative_developments[0].status == "unverified"
    assert not normalized.negative_developments[0].invalidates_thesis
