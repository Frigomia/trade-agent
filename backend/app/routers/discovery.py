import asyncio
from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import claude_keys
from app.agents.market_data import fetch_currency, fetch_dated_closes
from app.agents.news import _get_client
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.background import make_task_tracker
from app.claude_keys import require_claude_key
from app.discovery.feed import saved_ideas
from app.discovery.jobs import DiscoveryAlreadyRunning, create_job, get_job_status, run_job
from app.fx import SUBUNITS
from app.models import Recommendation
from app.rate_limit import rate_limiter
from app.schemas import DiscoveryIdeasOut, HistoryRange, PriceHistoryOut, PricePointOut
from app.usage import check_monthly_usage, refund_usage

router = APIRouter(
    prefix="/discovery", tags=["discovery"], dependencies=[Depends(get_current_user)]
)
_track_background_task = make_task_tracker("discovery")


@router.post(
    "/run",
    status_code=202,
    dependencies=[
        Depends(require_claude_key),
        Depends(rate_limiter("discovery_run", limit=2)),
        Depends(check_monthly_usage("analysis_run")),
    ],
)
async def run_discovery(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> dict[str, str]:
    try:
        client = await run_in_threadpool(claude_keys.resolve_client, db, user.id, user.role)
        db.close()
        uses_saved_key = client is not None
        if client is None:
            # resolve_client permits the server key only for an admin without a saved key.
            if user.role != "admin":
                raise claude_keys.ClaudeKeyRequired()
            client = _get_client()
            if client is None:
                raise claude_keys.ClaudeKeyRequired()
        job_id = await create_job(user.id)
    except DiscoveryAlreadyRunning:
        await refund_usage("analysis_run", str(user.id))
        raise HTTPException(
            status_code=409, detail="A discovery scan is already running."
        ) from None
    except Exception:
        await refund_usage("analysis_run", str(user.id))
        raise
    _track_background_task(
        asyncio.create_task(run_job(job_id, user.id, client, uses_saved_key=uses_saved_key))
    )
    return {"job_id": job_id}


@router.get("/run/{job_id}")
async def get_run_status(
    job_id: UUID,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    status = await get_job_status(str(job_id), user.id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


@router.get("/ideas", response_model=DiscoveryIdeasOut)
def list_ideas(
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> DiscoveryIdeasOut:
    response.headers["Cache-Control"] = "no-store"
    return saved_ideas(db, user.id)


# yfinance periods for the chart's ranges; "1w" is five trading days.
HISTORY_PERIODS = {"1w": "5d", "1m": "1mo", "6m": "6mo", "1y": "1y", "5y": "5y"}
HISTORY_LIMIT_PER_MINUTE = 30  # per user: this route fans out to yfinance


def _major_unit(
    quote_currency: str | None, saved_currency: str | None
) -> tuple[str | None, float | None]:
    """The major currency and the factor that turns a close into it; the factor is None when the
    unit cannot be told.

    Yahoo quotes London in pence, Johannesburg in cents and Tel Aviv in agorot. A saved idea keeps
    only the major unit, so the live quote currency decides. Without it, a saved GBP, ZAR or ILS
    could be a minor-unit quote 100 times too high, so no series is guessed.
    """
    if quote_currency:
        major, unit = SUBUNITS.get(quote_currency, (quote_currency, 1))
        return major, float(unit)
    if saved_currency and saved_currency not in {major for major, _ in SUBUNITS.values()}:
        return saved_currency, 1.0
    return saved_currency, None


@router.get(
    "/ideas/{recommendation_id}/history",
    response_model=PriceHistoryOut,
    dependencies=[Depends(rate_limiter("idea_history", limit=HISTORY_LIMIT_PER_MINUTE))],
)
async def idea_history(
    recommendation_id: Annotated[int, Path(ge=1, le=2**31 - 1)],  # the column is a 32-bit integer
    response: Response,
    range_: HistoryRange = Query("1y", alias="range"),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> PriceHistoryOut:
    """Daily closes for the ticker of one of the caller's saved ideas, never a client's ticker."""
    response.headers["Cache-Control"] = "no-store"
    rec = (
        db.query(Recommendation)
        .filter_by(id=recommendation_id, user_id=user.id, source="discovery")
        .one_or_none()
    )
    if rec is None:
        raise HTTPException(status_code=404, detail="Idea not found")
    ticker = rec.ticker
    saved = ((rec.idea or {}).get("snapshot") or {}).get("currency")
    db.close()  # release the pooled connection before awaiting the provider

    async def quote_currency() -> str | None:
        try:
            return await fetch_currency(ticker)
        except Exception:
            return None  # a missing unit is handled below, not an outage

    try:
        closes, currency = await asyncio.gather(
            fetch_dated_closes(ticker, HISTORY_PERIODS[range_], strict=True), quote_currency()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Price history is unavailable") from exc
    major, factor = _major_unit(currency, saved if isinstance(saved, str) else None)
    if factor is None and closes:
        # History exists but its unit is unknown: an answer to retry, not "no history".
        raise HTTPException(status_code=502, detail="Price history is unavailable")
    points = [
        PricePointOut(date=date.fromisoformat(day), close=round(close * (factor or 1), 6))
        for day, close in sorted(closes.items())
    ]
    return PriceHistoryOut(
        ticker=ticker,
        currency=major,
        as_of=points[-1].date if points else None,
        range=range_,
        points=points,
    )
