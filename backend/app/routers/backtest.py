import asyncio
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.background import make_task_tracker
from app.backtest.jobs import create_job, get_job_status, run_job
from app.config import settings
from app.db import get_db
from app.models import BacktestResult
from app.schemas import BacktestResultOut

router = APIRouter(prefix="/backtest", tags=["backtest"])

_track_background_task = make_task_tracker("backtest")


class BacktestRunIn(BaseModel):
    ticker: str
    start_date: date
    end_date: date


@router.post("/run", status_code=202)
async def run_backtest(payload: BacktestRunIn) -> dict[str, str]:
    job_id = await create_job(payload.ticker, payload.start_date, payload.end_date)
    task = asyncio.create_task(
        run_job(job_id, payload.ticker, payload.start_date, payload.end_date)
    )
    _track_background_task(task)
    return {"job_id": job_id}


@router.get("/run/{job_id}")
async def get_run_status(job_id: str) -> dict[str, Any]:
    status = await get_job_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


@router.get("/results", response_model=list[BacktestResultOut])
def list_results(ticker: str | None = None, db: Session = Depends(get_db)) -> list[BacktestResult]:
    query = db.query(BacktestResult).filter_by(user_id=settings.default_user_id)
    if ticker:
        query = query.filter_by(ticker=ticker)
    return query.all()
