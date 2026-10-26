import asyncio
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import claude_keys
from app.agents.news import _get_client
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.background import make_task_tracker
from app.claude_keys import require_claude_key
from app.discovery.company_jobs import company_job_status
from app.discovery.feed import saved_ideas
from app.discovery.jobs import DiscoveryAlreadyRunning, create_job, get_job_status, run_job
from app.models import Recommendation
from app.price_history import HistoryUnavailable, load_price_history
from app.rate_limit import rate_limiter
from app.schemas import DiscoveryIdeasOut, HistoryRange, PriceHistoryOut
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
    db: Session = Depends(get_user_db),
) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    status = await company_job_status(user.id, str(job_id), db)
    if status is None:
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


HISTORY_LIMIT_PER_MINUTE = 30


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

    try:
        return await load_price_history(ticker, range_, saved if isinstance(saved, str) else None)
    except HistoryUnavailable:
        raise HTTPException(status_code=502, detail="Price history is unavailable") from None
