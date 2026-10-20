import asyncio
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import claude_keys
from app.agents.news import _get_client
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.background import make_task_tracker
from app.claude_keys import require_claude_key
from app.discovery.jobs import DiscoveryAlreadyRunning, create_job, get_job_status, run_job
from app.models import Recommendation, ScanRun
from app.rate_limit import rate_limiter
from app.schemas import DiscoveryIdeasOut, RecommendationOut, ScanRunOut
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
    _track_background_task(asyncio.create_task(run_job(job_id, user.id, client)))
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
    recommendations = (
        db.query(Recommendation)
        .filter_by(
            user_id=user.id,
            source="discovery",
            status="PENDING",
        )
        .order_by(Recommendation.created_at.desc(), Recommendation.id.desc())
        .limit(50)
        .all()
    )
    latest = (
        db.query(ScanRun)
        .filter_by(user_id=user.id)
        .order_by(
            ScanRun.created_at.desc(),
            ScanRun.id.desc(),
        )
        .first()
    )
    return DiscoveryIdeasOut(
        recommendations=[RecommendationOut.model_validate(rec) for rec in recommendations],
        latest_scan=ScanRunOut.model_validate(latest) if latest is not None else None,
    )
