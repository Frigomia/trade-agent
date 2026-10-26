"""Verify source authority and the code-level gates on a thesis exclusion.

The model judges thesis impact; it cannot promote a website into an authoritative source or
exclude a company without a quoted, high-materiality fact from the supplied evidence.
"""

import re
from collections.abc import Collection
from typing import Any
from urllib.parse import urlsplit

from app.agents.research import _normalize_url
from app.discovery.citations import validate_citations
from app.discovery.sources import source_tier
from app.schemas_discovery import (
    CandidateMetrics,
    Catalyst,
    Claim,
    Exclusion,
    NegativeDevelopment,
    ResearchEvidence,
)


def normalize_evidence(
    evidence: ResearchEvidence, official_hosts: Collection[str] = ()
) -> ResearchEvidence:
    """Reclassify sources from hostnames without mutating the research result.

    Additional issuer hosts must come from independently verified metadata supplied by trusted
    callers, never from a model, web mention, or public request parameter. No citation is fetched.
    """
    claims: list[Claim] = []
    by_url: dict[str, list[Claim]] = {}
    seen: set[tuple[str, str, str]] = set()
    gaps = list(evidence.gaps)
    for claim in evidence.claims:
        url = _normalize_url(claim.url)
        if url is None:
            continue
        identity = (url, claim.event_id, claim.text)
        if identity in seen:
            continue
        seen.add(identity)
        tier = source_tier(claim.url, official_hosts)
        host = (urlsplit(url).hostname or "").lower().rstrip(".")
        if claim.kind == "forum" or claim.source_tier == "forum" or tier == "forum":
            cleaned = claim.model_copy(update={"url": url, "kind": "forum", "source_tier": "forum"})
        else:
            cleaned = claim.model_copy(update={"url": url, "source_tier": tier})
            if tier == "other" and claim.source_tier in {"official", "reliable_reporting"}:
                gaps.append(f"Source authority not verified for {host}; treated as other.")
        # Revalidate after host classification: model_copy bypasses the confirmation gate.
        cleaned = Claim.model_validate(cleaned.model_dump())
        claims.append(cleaned)
        by_url.setdefault(url, []).append(cleaned)

    developments: list[NegativeDevelopment] = []
    for development in evidence.negative_developments:
        urls = list(
            dict.fromkeys(
                url
                for raw in development.evidence
                if (url := _normalize_url(raw)) and url in by_url
            )
        )
        updates: dict[str, Any] = {"evidence": urls}
        supporting = [claim for url in urls for claim in by_url[url] if _trusted_fact(claim)]
        if development.status == "confirmed" and not supporting:
            updates.update(status="unverified", invalidates_thesis=False)
        elif development.status != "confirmed" or not any(
            claim.materiality == "high" for claim in supporting
        ):
            updates["invalidates_thesis"] = False
        developments.append(development.model_copy(update=updates))
    return evidence.model_copy(
        update={
            "claims": claims,
            "negative_developments": developments,
            "gaps": list(dict.fromkeys(gaps)),
        }
    )


def _trusted_fact(claim: Claim) -> bool:
    return claim.kind == "fact" and claim.source_tier in {"official", "reliable_reporting"}


def dated_catalysts(catalysts: list[Catalyst], evidence: ResearchEvidence) -> list[Catalyst]:
    """Keep event dates only when the cited, same-event excerpts explicitly state the full date."""
    result = []
    for catalyst in catalysts:
        day = catalyst.occurs_on
        if day is not None:
            # shortcut: ISO and full English dates only; add locales when source coverage needs it.
            forms = {day.isoformat()}
            for month in (day.strftime("%B"), day.strftime("%b"), day.strftime("%b") + "."):
                for number in (str(day.day), f"{day.day:02}"):
                    forms.update(
                        (
                            f"{number} {month} {day.year}",
                            f"{month} {number}, {day.year}",
                            f"{month} {number} {day.year}",
                        )
                    )
            pattern = r"(?<!\w)(?:" + "|".join(re.escape(form) for form in forms) + r")(?!\w)"
            supported = any(
                claim.url in catalyst.evidence
                and catalyst.event_id is not None
                and claim.event_id == catalyst.event_id
                and re.search(pattern, " ".join(claim.text.split()), re.IGNORECASE)
                for claim in evidence.claims
            )
            if not supported:
                catalyst = catalyst.model_copy(update={"occurs_on": None})
        result.append(catalyst)
    return result


def pending_development(evidence: ResearchEvidence) -> NegativeDevelopment | None:
    """Choose at most one unresolved development for the scan's bounded follow-up."""
    return next((d for d in evidence.negative_developments if d.status != "confirmed"), None)


def exclusion_for(
    candidate: CandidateMetrics,
    evidence: ResearchEvidence,
    reassessment: dict[str, Any],
) -> Exclusion | None:
    """The reassessment must quote a supporting fact and cite one development's evidence.

    Call with normalized evidence. An unknown source, a forecast, forum repetition, or an
    invented citation cannot become an exclusion merely because the model says "confirmed".
    """
    if evidence.ticker != candidate.ticker or reassessment.get("invalidates_thesis") is not True:
        return None
    explanation = reassessment.get("explanation")
    cited = reassessment.get("evidence")
    if not isinstance(explanation, str) or not explanation.strip() or not isinstance(cited, list):
        return None
    urls = [_normalize_url(raw) for raw in cited]
    if not urls or any(url is None for url in urls):
        return None
    claim_urls = {claim.url for claim in evidence.claims}
    for development in evidence.negative_developments:
        if development.status != "confirmed" or not development.invalidates_thesis:
            continue
        supporting = [
            claim
            for claim in evidence.claims
            if claim.url in development.evidence
            and _trusted_fact(claim)
            and claim.materiality == "high"
        ]
        allowed = {claim.url for claim in supporting}
        if not set(urls) <= allowed:
            continue
        if not any(
            claim.url in urls and claim.text.strip() and claim.text in explanation
            for claim in supporting
        ):
            continue
        occurred = (
            development.occurred_on.isoformat() if development.occurred_on else "date unavailable"
        )
        full_explanation = (
            f"Confirmed development ({occurred}): {development.summary}. "
            f"{explanation.strip()} Thesis impact: {development.thesis_impact}"
        )
        try:
            validate_citations(full_explanation, claim_urls)
        except ValueError:
            continue
        return Exclusion(
            ticker=candidate.ticker,
            name=candidate.name,
            reason="thesis_invalidated",
            explanation=full_explanation,
            evidence=list(dict.fromkeys(u for u in urls if u is not None)),
        )
    return None
