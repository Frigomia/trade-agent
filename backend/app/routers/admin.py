import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.admin import service
from app.auth.deps import get_user_db, require_admin
from app.auth.supabase_admin import SupabaseAdmin, get_supabase_admin
from app.config import settings
from app.models import AppUser
from app.schemas import AdminUserOut, InviteIn

# require_admin runs first for every route here (it depends on get_current_user), so an
# unauthenticated caller gets 401 and a non-admin gets 403 before anything else happens.
router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _to_out(user: AppUser) -> AdminUserOut:
    out = AdminUserOut.model_validate(user)
    if user.status == "invited" and user.invited_at is not None:
        out.invite_expires_at = user.invited_at + timedelta(hours=settings.invite_link_hours)
    return out


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    status: Literal["invited", "active", "disabled"] | None = None,
    db: Session = Depends(get_user_db),
) -> list[AdminUserOut]:
    return [_to_out(u) for u in service.list_users(db, status)]


@router.post("/users/invite", response_model=AdminUserOut, status_code=201)
def invite_user(
    payload: InviteIn,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> AdminUserOut:
    user = service.invite_user(db, supabase, payload.email, settings.invite_redirect_url)
    return _to_out(user)


@router.post("/users/{user_id}/resend", response_model=AdminUserOut)
def resend_invite(
    user_id: uuid.UUID,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> AdminUserOut:
    user = service.resend_invite(db, supabase, user_id, settings.invite_redirect_url)
    return _to_out(user)


@router.post("/users/{user_id}/revoke", status_code=204)
def revoke_invite(
    user_id: uuid.UUID,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> Response:
    service.revoke_invite(db, supabase, user_id)
    return Response(status_code=204)
