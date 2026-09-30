import asyncio
from datetime import date, timedelta
from typing import Any, Self

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.background import make_task_tracker
from app.backtest.jobs import create_job, get_job_status, run_job
from app.models import BacktestResult
from app.schemas import BacktestListItemOut, BacktestResultOut, Ticker

router = APIRouter(prefix="/backtest", tags=["backtest"], dependencies=[Depends(get_current_user)])

_track_background_task = make_task_tracker("backtest")

MAX_BACKTEST_RANGE = timedelta(days=365 * 30)
RESULTS_LIMIT = 20


class BacktestRunIn(BaseModel):
    ticker: Ticker
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def _validate_date_range(self) -> Self:
        if self.start_date > self.end_date:
            raise ValueError("start_date must not be after end_date")
        if self.end_date - self.start_date > MAX_BACKTEST_RANGE:
            raise ValueError(f"date range must not exceed {MAX_BACKTEST_RANGE.days} days")
        return self


@router.post("/run", status_code=202)
async def run_backtest(
    payload: BacktestRunIn, user: CurrentUser = Depends(get_current_user)
) -> dict[str, str]:
    job_id = await create_job(user.id, payload.ticker, payload.start_date, payload.end_date)
    task = asyncio.create_task(
        run_job(job_id, user.id, payload.ticker, payload.start_date, payload.end_date)
    )
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


@router.get("/results", response_model=list[BacktestListItemOut])
def list_results(
    ticker: str | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> list[BacktestResult]:
    query = db.query(BacktestResult).filter_by(user_id=user.id)
    if ticker:
        query = query.filter_by(ticker=ticker)
    # Newest first; id breaks ties between rows created in the same transaction.
    return (
        query.order_by(BacktestResult.created_at.desc(), BacktestResult.id.desc())
        .limit(RESULTS_LIMIT)
        .all()
    )


@router.get("/results/{result_id}", response_model=BacktestResultOut)
def get_result(
    result_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> BacktestResult:
    row = db.query(BacktestResult).filter_by(id=result_id, user_id=user.id).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Backtest result not found")
    return row
