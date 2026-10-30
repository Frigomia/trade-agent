from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import recurring
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.http_headers import no_store
from app.models import Trade
from app.rate_limit import rate_limiter
from app.schemas import PlaceIn, TradeOut
from app.schemas_recurring import (
    OccurrenceOut,
    OccurrenceStatusIn,
    RecurringIn,
    RecurringListOut,
    RecurringOut,
    RecurringPreviewOut,
    RecurringStatusIn,
)

router = APIRouter(
    prefix="/portfolio/recurring",
    tags=["recurring"],
    dependencies=[
        Depends(get_current_user),
        Depends(no_store),
        Depends(rate_limiter("recurring", limit=60)),
    ],
)


@router.get("", response_model=RecurringListOut)
def list_recurring(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> RecurringListOut:
    return recurring.load(db, user.id)


@router.post("/preview", response_model=RecurringPreviewOut)
def preview(payload: RecurringIn, editing: bool = False) -> RecurringPreviewOut:
    return recurring.preview(payload, editing=editing)


@router.post("", response_model=RecurringOut, status_code=201)
def create(
    payload: RecurringIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> RecurringOut:
    return recurring.save(db, user.id, payload)


@router.put("/{plan_id}", response_model=RecurringOut)
def edit(
    plan_id: int,
    payload: RecurringIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> RecurringOut:
    return recurring.save(db, user.id, payload, plan_id)


@router.patch("/{plan_id}/status", response_model=RecurringOut)
def status(
    plan_id: int,
    payload: RecurringStatusIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> RecurringOut:
    return recurring.set_status(db, user.id, plan_id, payload.status)


@router.patch("/occurrences/{occurrence_id}", response_model=OccurrenceOut)
def occurrence_status(
    occurrence_id: int,
    payload: OccurrenceStatusIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> OccurrenceOut:
    return recurring.set_occurrence_status(db, user.id, occurrence_id, payload.status)


@router.post("/occurrences/{occurrence_id}/confirm", response_model=TradeOut)
def confirm(
    occurrence_id: int,
    payload: PlaceIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> Trade:
    return recurring.confirm(db, user.id, occurrence_id, payload)
