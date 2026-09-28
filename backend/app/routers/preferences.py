from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.models import InvestmentPreferences
from app.schemas import PreferencesIn, PreferencesOut

router = APIRouter(tags=["preferences"], dependencies=[Depends(get_current_user)])


@router.get("/preferences", response_model=PreferencesOut)
def get_preferences(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> PreferencesOut | InvestmentPreferences:
    pref = db.query(InvestmentPreferences).filter_by(user_id=user.id).one_or_none()
    if pref is None:
        return PreferencesOut()
    return pref


@router.post("/preferences", response_model=PreferencesOut)
def upsert_preferences(
    payload: PreferencesIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> InvestmentPreferences:
    pref = db.query(InvestmentPreferences).filter_by(user_id=user.id).one_or_none()
    if pref is None:
        pref = InvestmentPreferences(user_id=user.id, **payload.model_dump())
        db.add(pref)
    else:
        for field, value in payload.model_dump().items():
            setattr(pref, field, value)
    db.commit()
    db.refresh(pref)
    return pref
