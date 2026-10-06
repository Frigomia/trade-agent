import asyncio
import logging
import math
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import claude_keys
from app.agents.jobs import (
    MAX_RUN_TICKERS,
    create_job,
    default_ticker_infos,
    get_job_status,
    run_job,
)
from app.agents.market_data import fetch_quote_and_history
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.background import make_task_tracker
from app.claude_keys import require_claude_key
from app.models import Holding, Recommendation, WatchlistItem
from app.rate_limit import rate_limiter
from app.schemas import RecommendationOut, Ticker
from app.usage import check_monthly_usage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analysis", tags=["analysis"], dependencies=[Depends(get_current_user)])

_track_background_task = make_task_tracker("analysis")


QUOTE_LIMIT_PER_MINUTE = 30  # per user, per route: these routes fan out to yfinance


class AnalysisRunIn(BaseModel):
    tickers: list[Ticker] | None = Field(default=None, max_length=MAX_RUN_TICKERS)

    @field_validator("tickers")
    @classmethod
    def _drop_duplicates(cls, tickers: list[str] | None) -> list[str] | None:
        # dict keys are unique and keep insertion order, so this removes repeats in order
        return list(dict.fromkeys(tickers)) if tickers is not None else None


@router.post(
    "/run",
    status_code=202,
    dependencies=[
        Depends(require_claude_key),
        Depends(rate_limiter("analysis_run", limit=5)),
        Depends(check_monthly_usage("analysis_run")),
    ],
)
async def run_analysis(
    payload: AnalysisRunIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> dict[str, str]:
    client = await run_in_threadpool(claude_keys.resolve_client, db, user.id, user.role)
    # The queries are synchronous, so they run in a worker thread to keep the event loop free.
    ticker_infos = await run_in_threadpool(_build_ticker_infos, db, user.id, payload.tickers)
    job_id = await create_job(user.id, ticker_infos)
    task = asyncio.create_task(run_job(job_id, user.id, ticker_infos, client=client))
    _track_background_task(task)
    return {"job_id": job_id}


def _build_ticker_infos(
    db: Session, user_id: uuid.UUID, tickers: list[str] | None
) -> list[dict[str, Any]]:
    ticker_infos: list[dict[str, Any]]
    if tickers:
        holdings = {h.ticker: h for h in db.query(Holding).filter_by(user_id=user_id)}
        watchlist = {w.ticker: w for w in db.query(WatchlistItem).filter_by(user_id=user_id)}
        ticker_infos = []
        for ticker in tickers:
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
        ticker_infos = default_ticker_infos(db, user_id)
    return ticker_infos


@router.get("/run/{job_id}")
async def get_run_status(
    job_id: str, user: CurrentUser = Depends(get_current_user)
) -> dict[str, Any]:
    status = await get_job_status(job_id, user.id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


async def _quote_for_ticker(ticker: str) -> tuple[float, float | None] | None:
    try:
        data = await fetch_quote_and_history(ticker)
    except Exception as exc:
        logger.warning("Live quote fetch failed for %s: %s", ticker, type(exc).__name__)
        return None
    price = data.get("price")
    if price is None or not math.isfinite(price):
        return None
    closes = data.get("closes") or []
    change_pct: float | None = None
    if len(closes) >= 2 and math.isfinite(closes[-1]) and math.isfinite(closes[-2]) and closes[-2]:
        change_pct = (closes[-1] - closes[-2]) / closes[-2] * 100
    return price, change_pct


async def _attach_live_quotes(recs: list[RecommendationOut]) -> None:
    """Mutates PENDING rows in place with a live price/day-change; everything else, and any row
    whose fetch fails, is left at the schema's None default — degrading quietly rather than
    ever failing the request over a flaky quote."""
    pending = [r for r in recs if r.status == "PENDING"]
    tickers = {r.ticker for r in pending}
    if not tickers:
        return
    results = await asyncio.gather(*(_quote_for_ticker(t) for t in tickers))
    quotes = dict(zip(tickers, results, strict=True))
    for rec in pending:
        quote = quotes.get(rec.ticker)
        if quote is not None:
            rec.current_price, rec.price_change_pct = quote


@router.get(
    "/recommendations",
    response_model=list[RecommendationOut],
    dependencies=[Depends(rate_limiter("recommendations", limit=QUOTE_LIMIT_PER_MINUTE))],
)
async def list_recommendations(
    status: str | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> list[RecommendationOut]:
    query = db.query(Recommendation).filter_by(user_id=user.id)
    if status:
        query = query.filter_by(status=status)
    outs = [RecommendationOut.model_validate(r) for r in query.all()]
    # Rows are copied out; release the pooled connection before awaiting live quotes, which can
    # take seconds (retries) during a yfinance outage.
    db.close()
    await _attach_live_quotes(outs)
    return outs


@router.get(
    "/recommendations/{recommendation_id}",
    response_model=RecommendationOut,
    dependencies=[Depends(rate_limiter("recommendation", limit=QUOTE_LIMIT_PER_MINUTE))],
)
async def get_recommendation(
    recommendation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> RecommendationOut:
    rec = db.query(Recommendation).filter_by(id=recommendation_id, user_id=user.id).one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    out = RecommendationOut.model_validate(rec)
    db.close()  # as in list_recommendations: don't hold the connection over the quote fetch
    await _attach_live_quotes([out])
    return out


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
