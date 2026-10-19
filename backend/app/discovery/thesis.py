"""Verify source authority and the code-level gates on a thesis exclusion.

The model judges thesis impact; it cannot promote a website into an authoritative source or
exclude a company without a quoted, high-materiality fact from the supplied evidence.
"""

from collections.abc import Collection
from typing import Any
from urllib.parse import urlsplit

from app.agents.research import _normalize_url
from app.discovery.citations import validate_citations
from app.schemas_discovery import (
    CandidateMetrics,
    Claim,
    Exclusion,
    NegativeDevelopment,
    ResearchEvidence,
)

# Small explicit policy, not a model-supplied reputation score. Unknown publishers stay "other".
REPORTING_HOSTS = frozenset({"reuters.com", "apnews.com", "ft.com", "wsj.com", "bloomberg.com"})
OFFICIAL_HOSTS = frozenset({"sec.gov", "fca.org.uk", "justice.gov", "ec.europa.eu"})


def _under(host: str, domains: Collection[str]) -> bool:
    return any(host == domain or host.endswith("." + domain) for domain in domains)


def normalize_evidence(
    evidence: ResearchEvidence, official_hosts: Collection[str] = ()
) -> ResearchEvidence:
    """Reclassify sources from hostnames without mutating the research result.

    Additional issuer hosts must come from independently verified metadata supplied by trusted
    callers, never from a model, web mention, or public request parameter. No citation is fetched.
    """
    claims: dict[str, Claim] = {}
    gaps = list(evidence.gaps)
    verified_hosts = OFFICIAL_HOSTS | {h.lower().strip().rstrip(".") for h in official_hosts if h}
    for claim in evidence.claims:
        url = _normalize_url(claim.url)
        if url is None or url in claims:
            continue
        host = (urlsplit(url).hostname or "").lower().rstrip(".")
        if claim.kind == "forum" or claim.source_tier == "forum" or _under(host, {"reddit.com"}):
            cleaned = claim.model_copy(update={"url": url, "kind": "forum", "source_tier": "forum"})
        elif _under(host, verified_hosts):
            cleaned = claim.model_copy(update={"url": url, "source_tier": "official"})
        elif _under(host, REPORTING_HOSTS):
            cleaned = claim.model_copy(update={"url": url, "source_tier": "reliable_reporting"})
        else:
            cleaned = claim.model_copy(update={"url": url, "source_tier": "other"})
            if claim.source_tier in {"official", "reliable_reporting"}:
                gaps.append(f"Source authority not verified for {host}; treated as other.")
        claims[url] = cleaned

    developments: list[NegativeDevelopment] = []
    for development in evidence.negative_developments:
        urls = list(
            dict.fromkeys(
                url
                for raw in development.evidence
                if (url := _normalize_url(raw)) and url in claims
            )
        )
        updates: dict[str, Any] = {"evidence": urls}
        if development.status == "confirmed" and not any(_trusted_fact(claims[u]) for u in urls):
            updates.update(status="unverified", invalidates_thesis=False)
        elif development.status != "confirmed":
            updates["invalidates_thesis"] = False
        developments.append(development.model_copy(update=updates))
    return evidence.model_copy(
        update={
            "claims": list(claims.values()),
            "negative_developments": developments,
            "gaps": list(dict.fromkeys(gaps)),
        }
    )


def _trusted_fact(claim: Claim) -> bool:
    return claim.kind == "fact" and claim.source_tier in {"official", "reliable_reporting"}


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
    claims = {c.url: c for c in evidence.claims}
    for development in evidence.negative_developments:
        if development.status != "confirmed" or not development.invalidates_thesis:
            continue
        allowed = {
            u
            for u in development.evidence
            if u in claims and _trusted_fact(claims[u]) and claims[u].materiality == "high"
        }
        if not set(urls) <= allowed:
            continue
        if not any(
            claims[u].text.strip() and claims[u].text in explanation for u in allowed & set(urls)
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
            validate_citations(full_explanation, claims)
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
