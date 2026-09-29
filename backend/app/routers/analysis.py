import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.agents.jobs import create_job, get_job_status, run_job
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.background import make_task_tracker
from app.models import Holding, Recommendation, WatchlistItem
from app.rate_limit import rate_limiter
from app.schemas import RecommendationOut
from app.usage import check_monthly_usage

router = APIRouter(prefix="/analysis", tags=["analysis"], dependencies=[Depends(get_current_user)])

_track_background_task = make_task_tracker("analysis")


class AnalysisRunIn(BaseModel):
    tickers: list[str] | None = None


@router.post(
    "/run",
    status_code=202,
    dependencies=[
        Depends(rate_limiter("analysis_run", limit=5)),
        Depends(check_monthly_usage("analysis_run")),
    ],
)
async def run_analysis(
    payload: AnalysisRunIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> dict[str, str]:
    holdings = {h.ticker: h for h in db.query(Holding).filter_by(user_id=user.id)}
    watchlist = {w.ticker: w for w in db.query(WatchlistItem).filter_by(user_id=user.id)}

    if payload.tickers:
        ticker_infos = []
        for ticker in payload.tickers:
            if ticker in holdings:
                ticker_infos.append(
                    {"ticker": ticker, "asset_type": holdings[ticker].asset_type, "is_held": True}
                )
            elif ticker in watchlist:
                ticker_infos.append(
                    {
                        "ticker": ticker,
                        "asset_type": watchlist[ticker].asset_type,
                        "is_held": False,
                    }
                )
            else:
                raise HTTPException(status_code=404, detail=f"Unknown ticker: {ticker}")
    else:
        ticker_infos = [
            {"ticker": h.ticker, "asset_type": h.asset_type, "is_held": True}
            for h in holdings.values()
        ] + [
            {"ticker": w.ticker, "asset_type": w.asset_type, "is_held": False}
            for w in watchlist.values()
        ]

    job_id = await create_job(user.id, ticker_infos)
    task = asyncio.create_task(run_job(job_id, user.id, ticker_infos))
    _track_background_task(task)
    return {"job_id": job_id}


@router.get("/run/{job_id}")
async def get_run_status(
    job_id: str, user: CurrentUser = Depends(get_current_user)
) -> dict[str, Any]:
    status = await get_job_status(job_id, user.id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


@router.get("/recommendations", response_model=list[RecommendationOut])
def list_recommendations(
    status: str | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> list[Recommendation]:
    query = db.query(Recommendation).filter_by(user_id=user.id)
    if status:
        query = query.filter_by(status=status)
    return query.all()


@router.post("/recommendations/{recommendation_id}/approve", response_model=RecommendationOut)
def approve_recommendation(
    recommendation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> Recommendation:
    return _set_recommendation_status(db, user.id, recommendation_id, "APPROVED")


@router.post("/recommendations/{recommendation_id}/reject", response_model=RecommendationOut)
def reject_recommendation(
    recommendation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> Recommendation:
    return _set_recommendation_status(db, user.id, recommendation_id, "REJECTED")


def _set_recommendation_status(
    db: Session, user_id: uuid.UUID, recommendation_id: int, status: str
) -> Recommendation:
    rec = db.query(Recommendation).filter_by(id=recommendation_id, user_id=user_id).one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    rec.status = status
    rec.reviewed_at = datetime.now(UTC)
    db.commit()
    db.refresh(rec)
    return rec
