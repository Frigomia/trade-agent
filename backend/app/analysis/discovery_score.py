"""Deterministic discovery scores; qualitative evidence only limits confidence.

Overall is the equally weighted mean of available quality/valuation scores. Portfolio fit is
context and breaks ties, never changes overall. Missing measurements are never filled in.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from app.discovery.peers import METRIC_SETS, metric_group
from app.discovery.scoring import dimension_score
from app.discovery.screen import PRICE_DATE_UNCERTAIN_PREFIX, RISK_ORDER
from app.schemas_discovery import (
    CandidateFit,
    CandidateMetrics,
    DimensionScore,
    IdeaOut,
    ResearchEvidence,
)
from app.sectors import Sector

OVERALL_WEIGHTS = {"quality": 1, "valuation": 1}
NO_OPPORTUNITY_MIN_OVERALL = 60
MIN_CONFIDENCE_COVERAGE = 0.5
HIGH_CONFIDENCE_COVERAGE = 0.8
QUALITY_STYLE_MIN = 70
VALUE_STYLE_MIN = 70
GROWTH_STYLE_MIN = 0.1
INCOME_STYLE_MIN = 0.03
DEFENSIVE_MIN_ROE = 0.0
DEFENSIVE_SECTORS: set[Sector] = {"Consumer Defensive", "Healthcare", "Utilities"}
FIT_COMPONENT_WEIGHTS = {"correlation": 1, "volatility": 1, "concentration": 1}


@dataclass(frozen=True)
class Evaluation:
    scores: list[DimensionScore]
    overall: int | None
    confidence: Literal["high", "medium", "low"]
    style_tags: list[str]


def _fundamental_dimension(
    candidate: CandidateMetrics, group: str, name: Literal["quality", "valuation"]
) -> DimensionScore:
    score = dimension_score(candidate.peers, group, name)
    if score is None:
        return DimensionScore(
            name=name,
            score=None,
            reasons=["Fewer than two valid peer comparisons; this dimension is unavailable."],
        )
    metrics = {
        spec.name
        for spec in METRIC_SETS[group]
        if spec.dimension == name and spec.higher_is_better is not None
    }
    reasons = [
        f"{peer.metric}: {peer.value:g}; peer p25 {peer.peer_p25:g}, p75 {peer.peer_p75:g}."
        for peer in candidate.peers
        if peer.metric in metrics
        and peer.position != "unavailable"
        and peer.value is not None
        and peer.peer_p25 is not None
        and peer.peer_p75 is not None
    ]
    return DimensionScore(name=name, score=score, reasons=reasons)


def _fit_dimension(fit: CandidateFit | None) -> DimensionScore:
    """Mean of three bounded measures, requiring every measurement.

    Correlation contributes 100*(1-correlation)/2. Volatility and HHI each contribute
    50 + 50*(before-after)/before. Each component is clamped to 0..100. This describes
    the measured hypothetical addition, with no sector target or suggested allocation.
    """
    if fit is None or not fit.applicable:
        return DimensionScore(
            name="fit", score=None, reasons=["Portfolio comparison is not applicable."]
        )
    correlation = fit.avg_correlation_to_portfolio
    vol_before, vol_after = fit.portfolio_vol_before, fit.portfolio_vol_after
    hhi_before, hhi_after = fit.hhi_before, fit.hhi_after
    if (
        correlation is None
        or vol_before is None
        or vol_after is None
        or hhi_before is None
        or hhi_after is None
        or vol_before <= 0
        or hhi_before <= 0
    ):
        return DimensionScore(
            name="fit",
            score=None,
            reasons=[
                "Correlation, positive baseline volatility and positive baseline HHI required."
            ],
        )
    components = {
        "correlation": 100 * (1 - correlation) / 2,
        "volatility": 50 + 50 * (1 - vol_after / vol_before),
        "concentration": 50 + 50 * (1 - hhi_after / hhi_before),
    }
    score = round(
        sum(
            min(100.0, max(0.0, value)) * FIT_COMPONENT_WEIGHTS[name]
            for name, value in components.items()
        )
        / sum(FIT_COMPONENT_WEIGHTS.values())
    )
    return DimensionScore(
        name="fit",
        score=score,
        reasons=[
            f"Correlation to portfolio {correlation:g}.",
            f"Annualized volatility {vol_before:g} -> {vol_after:g}.",
            f"Concentration HHI {hhi_before:g} -> {hhi_after:g}.",
            f"Hypothetical candidate weight {fit.hypothetical_weight:.1%}; context only.",
        ],
    )


def _confidence(
    candidate: CandidateMetrics, evidence: ResearchEvidence, scores: Sequence[DimensionScore]
) -> Literal["high", "medium", "low"]:
    coverage = candidate.coverage
    fraction = (
        coverage.core_metrics_present / coverage.core_metrics_total
        if coverage.core_metrics_total
        else 0.0
    )
    have = [score.score for score in scores if score.name in OVERALL_WEIGHTS]
    # Presence of research is a coverage check, never a score or a count-based strength claim.
    research_available = any(claim.kind != "forum" for claim in evidence.claims)
    if (
        all(score is None for score in have)
        or fraction < MIN_CONFIDENCE_COVERAGE
        or candidate.price is None
        or candidate.price <= 0
        or candidate.price_as_of is None
        or not research_available
    ):
        return "low"
    uncertain_price = any(
        note.casefold().startswith(PRICE_DATE_UNCERTAIN_PREFIX.casefold())
        for note in candidate.data_notes
    )
    unresolved = any(
        development.status != "confirmed" or development.invalidates_thesis
        for development in evidence.negative_developments
    )
    # The graph verifies these source tiers against hostnames before evaluation.
    qualified_research = any(
        claim.kind == "fact" and claim.source_tier in ("official", "reliable_reporting")
        for claim in evidence.claims
    )
    if (
        any(score is None for score in have)
        or fraction < HIGH_CONFIDENCE_COVERAGE
        or uncertain_price
        or evidence.conflicts
        or evidence.gaps
        or unresolved
        or not qualified_research
    ):
        return "medium"
    return "high"


def _style_tags(candidate: CandidateMetrics, scores: Sequence[DimensionScore]) -> list[str]:
    tags: list[str] = []
    thresholds = {"quality": QUALITY_STYLE_MIN, "valuation": VALUE_STYLE_MIN}
    for dimension in scores:
        threshold = thresholds.get(dimension.name)
        if threshold is not None and dimension.score is not None and dimension.score >= threshold:
            tags.append("value" if dimension.name == "valuation" else "quality")
    growth = candidate.fundamentals.get("revenueGrowth")
    if growth is not None and growth >= GROWTH_STYLE_MIN:
        tags.append("growth")
    income = candidate.fundamentals.get("dividendYield")
    if income is not None and income >= INCOME_STYLE_MIN:
        tags.append("income")
    roe = candidate.fundamentals.get("returnOnEquity")
    if candidate.sector in DEFENSIVE_SECTORS and roe is not None and roe > DEFENSIVE_MIN_ROE:
        tags.append("defensive")
    return tags


def evaluate(
    candidate: CandidateMetrics, evidence: ResearchEvidence, fit: CandidateFit | None = None
) -> Evaluation:
    """Score this candidate without network, model calls, or changes to the input objects."""
    if evidence.ticker != candidate.ticker or (fit is not None and fit.ticker != candidate.ticker):
        raise ValueError("Research and portfolio fit must belong to the candidate ticker")
    group = metric_group(candidate.sector, candidate.industry, candidate.asset_type)
    scores = [
        _fundamental_dimension(candidate, group, "quality"),
        _fundamental_dimension(candidate, group, "valuation"),
        _fit_dimension(fit),
    ]
    have = [score for score in scores if score.name in OVERALL_WEIGHTS and score.score is not None]
    overall = (
        round(
            sum(
                score.score * OVERALL_WEIGHTS[score.name]
                for score in have
                if score.score is not None
            )
            / sum(OVERALL_WEIGHTS[score.name] for score in have)
        )
        if have
        else None
    )
    return Evaluation(
        scores, overall, _confidence(candidate, evidence, scores), _style_tags(candidate, scores)
    )


def is_opportunity(idea: IdeaOut) -> bool:
    return (
        idea.overall is not None
        and idea.overall >= NO_OPPORTUNITY_MIN_OVERALL
        and idea.confidence in ("medium", "high")
    )


def rank_ideas(
    ideas: Sequence[IdeaOut], fits: Mapping[str, CandidateFit] | None = None
) -> list[IdeaOut]:
    """Overall, risk, measured fit, ticker; unavailable overall/fit follow available values."""

    def key(idea: IdeaOut) -> tuple[bool, int, int, int, str]:
        if fits is None:
            fit_score = next(score.score for score in idea.scores if score.name == "fit")
        else:
            fit_score = _fit_dimension(fits.get(idea.ticker)).score
        return (
            idea.overall is None,
            -(idea.overall if idea.overall is not None else 0),
            RISK_ORDER[idea.risk.risk_level],
            -(fit_score if fit_score is not None else -1),
            idea.ticker,
        )

    return sorted(ideas, key=key)
