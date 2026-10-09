from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import plans
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.http_headers import no_store
from app.rate_limit import rate_limiter
from app.schemas import (
    DriftItemOut,
    OpenOrdersOut,
    PlaceIn,
    PlanIn,
    PlanLineOut,
    PlanOut,
    PlanSummaryOut,
)

router = APIRouter(
    prefix="/plans", tags=["plans"], dependencies=[Depends(get_current_user), Depends(no_store)]
)

PREVIEW_LIMIT_PER_MINUTE = 10


@router.post(
    "/preview",
    response_model=PlanOut,
    dependencies=[Depends(rate_limiter("plans_preview", limit=PREVIEW_LIMIT_PER_MINUTE))],
)
async def preview_plan(
    payload: PlanIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> PlanOut:
    return await plans.compute(db, user.id, payload)


@router.post(
    "",
    response_model=PlanOut,
    status_code=201,
    dependencies=[Depends(rate_limiter("plans_save", limit=PREVIEW_LIMIT_PER_MINUTE))],
)
async def save_plan(
    payload: PlanIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> PlanOut:
    # Only the amount and the mode come from the client: the lines are always recomputed here.
    plan = await plans.compute(db, user.id, payload)
    return await run_in_threadpool(plans.save, db, user.id, plan)


@router.get("", response_model=list[PlanSummaryOut])
def list_plans(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> list[PlanSummaryOut]:
    return plans.list_summaries(db, user.id)


@router.get(
    "/drift",
    response_model=list[DriftItemOut],
    dependencies=[Depends(rate_limiter("plans_drift", limit=30))],
)
async def drift(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> list[DriftItemOut]:
    return await plans.drift(db, user.id)


@router.get("/orders/open", response_model=OpenOrdersOut)
def open_orders(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> OpenOrdersOut:
    return plans.open_orders(db, user.id)


# Keep the "/{plan_id}" routes LAST: fixed paths such as "/drift" must be declared above them.
@router.get("/{plan_id}", response_model=PlanOut)
def get_plan(
    plan_id: int, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> PlanOut:
    plan = plans.load(db, user.id, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


@router.delete("/{plan_id}", status_code=204)
def delete_plan(
    plan_id: int, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> Response:
    if not plans.delete(db, user.id, plan_id):
        raise HTTPException(status_code=404, detail="Plan not found")
    return Response(status_code=204)


@router.post(
    "/{plan_id}/lines/{line_id}/placed",
    response_model=PlanLineOut,
    dependencies=[Depends(rate_limiter("plans_placed", limit=60))],
)
def place_plan_line(
    plan_id: int,
    line_id: int,
    payload: PlaceIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> PlanLineOut:
    return plans.place_line(db, user.id, plan_id, line_id, payload)
