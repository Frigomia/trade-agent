from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.auto_analysis import pause_state
from app.config import settings
from app.models import AppUser, InvestmentPreferences
from app.schemas import AutoAnalysisPaused, PreferencesIn, PreferencesOut
from app.usage import load_limit_defaults

router = APIRouter(tags=["preferences"], dependencies=[Depends(get_current_user)])


def _load(db: Session, user: CurrentUser) -> InvestmentPreferences | None:
    return db.query(InvestmentPreferences).filter_by(user_id=user.id).one_or_none()


async def _out(
    db: Session, user: CurrentUser, pref: InvestmentPreferences | None
) -> PreferencesOut:
    out = PreferencesOut.model_validate(pref) if pref is not None else PreferencesOut()
    if out.auto_analysis:
        row = await run_in_threadpool(db.get, AppUser, user.id)
        defaults = await run_in_threadpool(load_limit_defaults, db, settings)
        if row is not None:
            # One short key lookup runs on the loop inside pause_state; the usage read is async.
            pause = await pause_state(db, row, defaults, datetime.now(UTC).date())
            if pause is not None:
                out.auto_analysis_paused = AutoAnalysisPaused(
                    reason=pause.reason, limit=pause.limit, resumes_on=pause.resumes_on
                )
    return out


@router.get("/preferences", response_model=PreferencesOut)
async def get_preferences(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> PreferencesOut:
    pref = await run_in_threadpool(_load, db, user)
    return await _out(db, user, pref)


def _save(db: Session, user: CurrentUser, payload: PreferencesIn) -> InvestmentPreferences:
    values = payload.model_dump()
    auto = values.pop("auto_analysis")  # None means the client did not send it
    pref = _load(db, user)
    if pref is None:
        pref = InvestmentPreferences(user_id=user.id, **values)
        db.add(pref)
    else:
        for field, value in values.items():
            setattr(pref, field, value)
    if auto is not None:
        pref.auto_analysis = auto
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    db.refresh(pref)
    return pref


@router.post("/preferences", response_model=PreferencesOut)
async def upsert_preferences(
    payload: PreferencesIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> PreferencesOut:
    pref = await run_in_threadpool(_save, db, user, payload)
    return await _out(db, user, pref)
