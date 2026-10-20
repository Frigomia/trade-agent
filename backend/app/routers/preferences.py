import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.auto_analysis import pause_state
from app.config import settings
from app.models import AppUser, InvestmentPreferences
from app.schemas import AutoAnalysisPaused, PreferencesIn, PreferencesOut
from app.usage import load_limit_defaults

logger = logging.getLogger(__name__)

router = APIRouter(tags=["preferences"], dependencies=[Depends(get_current_user)])


def _load(db: Session, user: CurrentUser) -> InvestmentPreferences | None:
    return db.query(InvestmentPreferences).filter_by(user_id=user.id).one_or_none()


async def _out(
    db: Session, user: CurrentUser, pref: InvestmentPreferences | None
) -> PreferencesOut:
    out = PreferencesOut.model_validate(pref) if pref is not None else PreferencesOut()
    if out.auto_analysis or out.auto_discovery:
        row = await run_in_threadpool(db.get, AppUser, user.id)
        defaults = await run_in_threadpool(load_limit_defaults, db, settings)
        if row is not None:
            for field, enabled, reserve in (
                ("auto_analysis_paused", out.auto_analysis, False),
                ("auto_discovery_paused", out.auto_discovery, True),
            ):
                if not enabled:
                    continue
                try:
                    pause = await pause_state(
                        db, row, defaults, datetime.now(UTC).date(), reserve_last_run=reserve
                    )
                except RedisError as exc:
                    logger.warning("Preferences: usage read failed (%s)", type(exc).__name__)
                    return out
                if pause is not None:
                    setattr(
                        out,
                        field,
                        AutoAnalysisPaused(
                            reason=pause.reason, limit=pause.limit, resumes_on=pause.resumes_on
                        ),
                    )
    return out


@router.get("/preferences", response_model=PreferencesOut)
async def get_preferences(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> PreferencesOut:
    pref = await run_in_threadpool(_load, db, user)
    return await _out(db, user, pref)


def _save(db: Session, user: CurrentUser, payload: PreferencesIn) -> InvestmentPreferences:
    # Only the fields the client actually sent; the rest keep their stored values.
    values = payload.model_dump(exclude_unset=True)
    auto = values.pop("auto_analysis", None)  # an explicit null is ignored (the column is not null)
    discovery = values.pop("auto_discovery", None)
    drift = values.pop("drift_threshold_pct", None)  # same: the column is not null
    pref = _load(db, user)
    if pref is None:
        pref = InvestmentPreferences(user_id=user.id, **values)
        db.add(pref)
    else:
        for field, value in values.items():
            setattr(pref, field, value)
    if auto is not None:
        pref.auto_analysis = auto
    if discovery is not None:
        pref.auto_discovery = discovery
    if drift is not None:
        pref.drift_threshold_pct = drift
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
