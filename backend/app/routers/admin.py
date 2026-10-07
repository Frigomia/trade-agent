import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session, sessionmaker
from starlette.concurrency import run_in_threadpool

from app import telegram, usage
from app.admin import service
from app.auth.deps import CurrentUser, get_user_db, require_admin
from app.auth.supabase_admin import SupabaseAdmin, get_supabase_admin
from app.config import settings
from app.db import get_session_factory
from app.models import AppUser
from app.schemas import (
    AdminUserOut,
    InviteIn,
    LimitDefaults,
    LimitsIn,
    RemoveIn,
)

# require_admin runs first for every route here (it depends on get_current_user), so an
# unauthenticated caller gets 401 and a non-admin gets 403 before anything else happens.
router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


async def _to_out(user: AppUser, defaults: usage.LimitDefaults) -> AdminUserOut:
    out = AdminUserOut.model_validate(user)
    if user.status == "invited" and user.invited_at is not None:
        out.invite_expires_at = user.invited_at + timedelta(hours=settings.invite_link_hours)
    out.monthly_analysis_limit = usage.effective_limit(user, "analysis_run", defaults)
    out.monthly_chat_limit = usage.effective_limit(user, "chat", defaults)
    out.monthly_analysis_used = await usage.get_usage("analysis_run", str(user.id))
    out.monthly_chat_used = await usage.get_usage("chat", str(user.id))
    return out


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(
    status: Literal["invited", "active", "disabled"] | None = None,
    db: Session = Depends(get_user_db),
    defaults: usage.LimitDefaults = Depends(usage.get_limit_defaults),
) -> list[AdminUserOut]:
    users = await run_in_threadpool(service.list_users, db, status)
    return [await _to_out(u, defaults) for u in users]


@router.post("/users/invite", response_model=AdminUserOut, status_code=201)
async def invite_user(
    payload: InviteIn,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
    defaults: usage.LimitDefaults = Depends(usage.get_limit_defaults),
) -> AdminUserOut:
    user = await run_in_threadpool(
        service.invite_user, db, supabase, payload.email, settings.invite_redirect_url
    )
    return await _to_out(user, defaults)


@router.post("/users/{user_id}/resend", response_model=AdminUserOut)
async def resend_invite(
    user_id: uuid.UUID,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
    defaults: usage.LimitDefaults = Depends(usage.get_limit_defaults),
) -> AdminUserOut:
    user = await run_in_threadpool(
        service.resend_invite, db, supabase, user_id, settings.invite_redirect_url
    )
    return await _to_out(user, defaults)


@router.post("/users/{user_id}/revoke", status_code=204)
def revoke_invite(
    user_id: uuid.UUID,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
) -> Response:
    service.revoke_invite(db, supabase, user_id)
    return Response(status_code=204)


@router.post("/users/{user_id}/disable", response_model=AdminUserOut)
async def disable_user(
    user_id: uuid.UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
    defaults: usage.LimitDefaults = Depends(usage.get_limit_defaults),
) -> AdminUserOut:
    user = await run_in_threadpool(service.disable_user, db, supabase, user_id, admin.id)
    return await _to_out(user, defaults)


@router.post("/users/{user_id}/enable", response_model=AdminUserOut)
async def enable_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
    defaults: usage.LimitDefaults = Depends(usage.get_limit_defaults),
) -> AdminUserOut:
    user = await run_in_threadpool(service.enable_user, db, supabase, user_id)
    return await _to_out(user, defaults)


@router.patch("/users/{user_id}/limits", response_model=AdminUserOut)
async def set_limits(
    user_id: uuid.UUID,
    payload: LimitsIn,
    db: Session = Depends(get_user_db),
    defaults: usage.LimitDefaults = Depends(usage.get_limit_defaults),
) -> AdminUserOut:
    fields = payload.model_dump(exclude_unset=True)
    user = await run_in_threadpool(service.set_limits, db, user_id, fields)
    return await _to_out(user, defaults)


@router.get("/limit-defaults", response_model=LimitDefaults)
def read_limit_defaults(
    defaults: usage.LimitDefaults = Depends(usage.get_limit_defaults),
) -> LimitDefaults:
    return LimitDefaults(analysis_limit=defaults.analysis_runs, chat_limit=defaults.chat_messages)


@router.put("/limit-defaults", response_model=LimitDefaults)
def write_limit_defaults(
    payload: LimitDefaults, db: Session = Depends(get_user_db)
) -> LimitDefaults:
    """The limits for everyone without a personal override (see LimitsIn for those)."""
    service.set_limit_defaults(db, payload.analysis_limit, payload.chat_limit)
    return payload


@router.delete("/users/{user_id}", status_code=204)
async def remove_user(
    user_id: uuid.UUID,
    payload: RemoveIn,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_user_db),
    supabase: SupabaseAdmin = Depends(get_supabase_admin),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> Response:
    chat_ids: list[int] = []
    try:
        await run_in_threadpool(
            service.remove_user,
            db,
            supabase,
            factory,
            user_id,
            payload.confirm_email,
            admin.id,
            chat_ids,
        )
    finally:
        # Also when a later step failed: the link rows are already gone, so a retry would not
        # find the chat id again.
        for chat_id in chat_ids:
            await telegram.forget_chat_quietly(chat_id)
    return Response(status_code=204)
