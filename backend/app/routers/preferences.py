from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import InvestmentPreferences
from app.schemas import PreferencesIn, PreferencesOut

router = APIRouter(tags=["preferences"])


@router.get("/preferences", response_model=PreferencesOut)
def get_preferences(db: Session = Depends(get_db)) -> PreferencesOut | InvestmentPreferences:
    pref = (
        db.query(InvestmentPreferences)
        .filter_by(user_id=settings.default_user_id)
        .one_or_none()
    )
    if pref is None:
        return PreferencesOut()
    return pref


@router.post("/preferences", response_model=PreferencesOut)
def upsert_preferences(
    payload: PreferencesIn, db: Session = Depends(get_db)
) -> InvestmentPreferences:
    pref = (
        db.query(InvestmentPreferences)
        .filter_by(user_id=settings.default_user_id)
        .one_or_none()
    )
    if pref is None:
        pref = InvestmentPreferences(user_id=settings.default_user_id, **payload.model_dump())
        db.add(pref)
    else:
        for field, value in payload.model_dump().items():
            setattr(pref, field, value)
    db.commit()
    db.refresh(pref)
    return pref
