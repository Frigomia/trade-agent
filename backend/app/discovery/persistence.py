"""Save a discovery scan atomically after all provider work has finished."""

from collections.abc import Sequence
from typing import Any
from uuid import UUID

from app.analysis.discovery_score import is_opportunity, rank_ideas
from app.config import settings
from app.db import lock_and_check_active, scoped_session
from app.models import Recommendation, ScanRun
from app.schemas_discovery import Exclusion, IdeaOut, RejectedMention


def save_scan(
    user_id: UUID,
    ideas: Sequence[IdeaOut],
    *,
    universe_size: int,
    eligible: int,
    shortlisted: int,
    researched: int,
    excluded: Sequence[Exclusion] = (),
    rejected_mentions: Sequence[RejectedMention] = (),
    coverage_summary: dict[str, Any] | None = None,
) -> ScanRun | None:
    """Write recommendations and their scan together; inactive accounts receive no writes."""
    if min(universe_size, eligible, shortlisted, researched) < 0:
        raise ValueError("Scan counts must be non-negative")
    # Revalidate at the persistence boundary, including instances mutated since construction.
    ranked = rank_ideas([IdeaOut.model_validate(idea.model_dump()) for idea in ideas])
    if len({idea.ticker for idea in ranked}) != len(ranked):
        raise ValueError("A scan must not contain duplicate candidate tickers")
    qualifying = [idea for idea in ranked if is_opportunity(idea)]
    coverage = dict(coverage_summary or {})
    if not qualifying:
        coverage["nearest_misses"] = [
            {"ticker": idea.ticker, "overall": idea.overall, "confidence": idea.confidence}
            for idea in ranked[:3]
        ]
    exclusions = [
        Exclusion.model_validate(item.model_dump()).model_dump(mode="json") for item in excluded
    ]
    rejections = [
        RejectedMention.model_validate(item.model_dump()).model_dump(mode="json")
        for item in rejected_mentions
    ]
    summary = (
        f"Found {len(qualifying)} compelling opportunit{'y' if len(qualifying) == 1 else 'ies'} "
        f"from {researched} researched candidates."
        if qualifying
        else "No compelling opportunity met the score and confidence thresholds."
    )
    with scoped_session(user_id) as db:
        try:
            if not lock_and_check_active(db, user_id):
                return None
            # Retire earlier advice when re-evaluation no longer supports an opportunity.
            evaluated = {idea.ticker for idea in ranked} | {item["ticker"] for item in exclusions}
            if evaluated:
                db.query(Recommendation).filter(
                    Recommendation.user_id == user_id,
                    Recommendation.source == "discovery",
                    Recommendation.status == "PENDING",
                    Recommendation.ticker.in_(evaluated),
                ).update({"status": "SUPERSEDED"}, synchronize_session=False)
            for idea in qualifying:
                db.add(
                    Recommendation(
                        user_id=user_id,
                        ticker=idea.ticker,
                        asset_type=idea.asset_type,
                        action="BUY",
                        reasoning=[idea.conclusion],
                        ai_analysis=idea.thesis,
                        suggested_position_pct=(
                            settings.max_single_position_pct
                            if idea.overall is not None and idea.overall >= 80
                            else settings.max_single_position_pct / 2
                        ),
                        source="discovery",
                        status="PENDING",
                        idea=idea.model_dump(mode="json"),
                    )
                )
            scan = ScanRun(
                user_id=user_id,
                status="completed",
                universe_size=universe_size,
                eligible=eligible,
                shortlisted=shortlisted,
                researched=researched,
                outcome="ideas" if qualifying else "none",
                summary=summary,
                excluded=exclusions,
                rejected_mentions=rejections,
                coverage_summary=coverage,
            )
            db.add(scan)
            db.flush()
            # Retain generated identifiers/timestamps after the short-lived session closes.
            db.expunge(scan)
            db.commit()
            return scan
        except Exception:
            db.rollback()
            raise
