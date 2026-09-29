from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, sessionmaker

from app.admin import service
from app.auth.deps import CurrentUser, get_known_user
from app.db import get_session_factory
from app.models import AppUser
from app.schemas import AcceptIn, MeOut

router = APIRouter(prefix="/me", tags=["me"], dependencies=[Depends(get_known_user)])


@router.get("", response_model=MeOut)
def get_me(
    user: CurrentUser = Depends(get_known_user),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> MeOut:
    with factory() as db:
        row = db.get(AppUser, user.id)
        return MeOut.model_validate(row)


@router.post("/accept", response_model=MeOut)
def accept(
    payload: AcceptIn,
    user: CurrentUser = Depends(get_known_user),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> MeOut:
    with factory() as db:
        return MeOut.model_validate(service.accept_terms(db, user.id))
