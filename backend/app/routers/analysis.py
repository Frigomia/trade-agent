import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.agents.jobs import create_job, get_job_status, run_job
from app.config import settings
from app.db import get_db
from app.models import Holding, Recommendation, WatchlistItem
from app.schemas import RecommendationOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analysis", tags=["analysis"])

_background_tasks: set[asyncio.Task[None]] = set()


def _log_background_task_exception(task: asyncio.Task[None]) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.exception("Background analysis job failed", exc_info=exc)


class AnalysisRunIn(BaseModel):
    tickers: list[str] | None = None


@router.post("/run", status_code=202)
async def run_analysis(payload: AnalysisRunIn, db: Session = Depends(get_db)) -> dict[str, str]:
    holdings = {h.ticker: h for h in db.query(Holding).filter_by(user_id=settings.default_user_id)}
    watchlist = {
        w.ticker: w for w in db.query(WatchlistItem).filter_by(user_id=settings.default_user_id)
    }

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

    job_id = await create_job(ticker_infos)
    task = asyncio.create_task(run_job(job_id, ticker_infos))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    task.add_done_callback(_log_background_task_exception)
    return {"job_id": job_id}


@router.get("/run/{job_id}")
async def get_run_status(job_id: str) -> dict[str, Any]:
    status = await get_job_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


@router.get("/recommendations", response_model=list[RecommendationOut])
def list_recommendations(
    status: str | None = None, db: Session = Depends(get_db)
) -> list[Recommendation]:
    query = db.query(Recommendation).filter_by(user_id=settings.default_user_id)
    if status:
        query = query.filter_by(status=status)
    return query.all()


@router.post("/recommendations/{recommendation_id}/approve", response_model=RecommendationOut)
def approve_recommendation(recommendation_id: int, db: Session = Depends(get_db)) -> Recommendation:
    return _set_recommendation_status(db, recommendation_id, "APPROVED")


@router.post("/recommendations/{recommendation_id}/reject", response_model=RecommendationOut)
def reject_recommendation(recommendation_id: int, db: Session = Depends(get_db)) -> Recommendation:
    return _set_recommendation_status(db, recommendation_id, "REJECTED")


def _set_recommendation_status(db: Session, recommendation_id: int, status: str) -> Recommendation:
    rec = (
        db.query(Recommendation)
        .filter_by(id=recommendation_id, user_id=settings.default_user_id)
        .one_or_none()
    )
    if rec is None:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    rec.status = status
    rec.reviewed_at = datetime.now(UTC)
    db.commit()
    db.refresh(rec)
    return rec
