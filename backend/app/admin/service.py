"""Lifecycle actions on app_users. Services raise AdminError subclasses; main.py maps them to
HTTP responses, so this module never imports FastAPI."""

import logging
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.auth.supabase_admin import SupabaseAdmin, SupabaseAdminError, SupabaseUserExists
from app.models import AppUser

logger = logging.getLogger(__name__)

UPSTREAM_DETAIL = "Could not reach the authentication service"


class AdminError(Exception):
    status_code = 500

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class NotFound(AdminError):
    status_code = 404


class Conflict(AdminError):
    status_code = 409


class Unprocessable(AdminError):
    status_code = 422


class UpstreamError(AdminError):
    status_code = 502


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)  # columns are naive UTC


def _get_user(db: Session, user_id: uuid.UUID) -> AppUser:
    user = db.get(AppUser, user_id)
    if user is None:
        raise NotFound("User not found")
    return user


def accept_terms(db: Session, user_id: uuid.UUID) -> AppUser:
    """Records acceptance and activates an invited user. Idempotent."""
    user = _get_user(db, user_id)
    changed = False
    if user.status == "invited":
        user.status = "active"
        changed = True
    if user.accepted_terms_at is None:
        user.accepted_terms_at = _utcnow()
        changed = True
    if changed:
        db.commit()
        db.refresh(user)
    return user


def _upstream[T](action: str, call: Callable[[], T]) -> T:
    """Runs a Supabase call; any failure becomes a generic 502. Only the class is logged."""
    try:
        return call()
    except SupabaseAdminError as exc:
        logger.error("Supabase %s failed: %s", action, type(exc).__name__)
        raise UpstreamError(UPSTREAM_DETAIL) from None


def list_users(db: Session, status: str | None) -> list[AppUser]:
    query = db.query(AppUser)
    if status is not None:
        query = query.filter_by(status=status)
    return query.order_by(AppUser.created_at, AppUser.email).all()


def invite_user(
    db: Session, supabase: SupabaseAdmin, email: str, redirect_to: str | None
) -> AppUser:
    existing = db.query(AppUser).filter_by(email=email).one_or_none()
    if existing is not None:
        if existing.status != "invited":
            raise Conflict("That address already has access")
        return resend_invite(db, supabase, existing.id, redirect_to)

    try:
        supabase_id = supabase.invite(email, redirect_to)
    except SupabaseUserExists:
        raise Conflict("That address is already registered") from None
    except SupabaseAdminError as exc:
        logger.error("Supabase invite failed: %s", type(exc).__name__)
        raise UpstreamError(UPSTREAM_DETAIL) from None

    user = AppUser(id=supabase_id, email=email, role="user", status="invited", invited_at=_utcnow())
    try:
        db.add(user)
        db.commit()
    except Exception:
        db.rollback()
        # Do not leave a Supabase user (and a sent email) that we have no record of.
        try:
            supabase.delete(supabase_id)
        except SupabaseAdminError as exc:
            logger.error("Compensating Supabase delete failed: %s", type(exc).__name__)
        raise
    db.refresh(user)
    return user


def resend_invite(
    db: Session, supabase: SupabaseAdmin, user_id: uuid.UUID, redirect_to: str | None
) -> AppUser:
    user = _get_user(db, user_id)
    if user.status != "invited":
        raise Conflict("Only pending invitations can be resent")
    _upstream("invite", lambda: supabase.invite(user.email, redirect_to))
    user.invited_at = _utcnow()
    db.commit()
    db.refresh(user)
    return user


def revoke_invite(db: Session, supabase: SupabaseAdmin, user_id: uuid.UUID) -> None:
    user = _get_user(db, user_id)
    if user.status != "invited":
        raise Conflict("Only pending invitations can be revoked")
    _upstream("delete", lambda: supabase.delete(user.id))
    db.delete(user)
    db.commit()
