"""Read saved discovery results without provider work or unbounded payload loading."""

from uuid import UUID

from sqlalchemy import Integer, Text, case, cast, func
from sqlalchemy.dialects.postgresql import JSONB, JSONPATH, array
from sqlalchemy.orm import Session

from app.discovery.screen import RISK_ORDER
from app.models import Recommendation, ScanRun
from app.schemas import DiscoveryIdeasOut, RecommendationOut, ScanRunOut


def saved_ideas(db: Session, user_id: UUID) -> DiscoveryIdeasOut:
    # Find fit by name: persisted score arrays need not use a particular dimension order.
    fit = func.jsonb_path_query_first(
        cast(Recommendation.idea, JSONB),
        cast('$.scores[*] ? (@.name == "fit").score', JSONPATH),
    )
    # Extract scalar text before casting so JSON null becomes SQL NULL, not a cast error.
    fit_score = cast(fit.op("#>>")(array([], type_=Text)), Integer)
    risk = case(
        RISK_ORDER,
        value=Recommendation.idea["risk"]["risk_level"].as_string(),
        else_=RISK_ORDER["unknown"],
    )
    recommendations = (
        db.query(Recommendation)
        .filter_by(user_id=user_id, source="discovery", status="PENDING")
        # Same order as rank_ideas, applied BEFORE the limit, across all pending scans.
        .order_by(
            Recommendation.idea["overall"].as_integer().desc().nulls_last(),
            risk,
            fit_score.desc().nulls_last(),
            Recommendation.ticker,
            Recommendation.created_at.desc(),
            Recommendation.id.desc(),
        )
        .limit(50)
        .all()
    )
    latest = (
        db.query(ScanRun)
        .filter_by(user_id=user_id)
        .order_by(ScanRun.created_at.desc(), ScanRun.id.desc())
        .first()
    )
    return DiscoveryIdeasOut(
        recommendations=[RecommendationOut.model_validate(rec) for rec in recommendations],
        latest_scan=ScanRunOut.model_validate(latest) if latest is not None else None,
    )
