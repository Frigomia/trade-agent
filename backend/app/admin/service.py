"""Lifecycle actions on app_users. Services raise AdminError subclasses; main.py maps them to
HTTP responses, so this module never imports FastAPI."""

import logging
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy.orm import Session, sessionmaker

from app.auth.supabase_admin import SupabaseAdmin, SupabaseAdminError, SupabaseUserExists
from app.models import AppUser
from app.user_data import delete_user_data

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
        # invite() can return an EXISTING Supabase user (re-send). If we already have a row for
        # that id or address, the account is not ours to delete: report a conflict instead.
        if (
            db.get(AppUser, supabase_id) is not None
            or db.query(AppUser).filter_by(email=email).first() is not None
        ):
            raise Conflict("That address already has access") from None
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
    try:
        supabase_id = supabase.invite(user.email, redirect_to)
    except SupabaseUserExists:
        # Confirmed in Supabase but terms not yet accepted, so app_users still says "invited".
        raise Conflict("That address has already accepted the invitation") from None
    except SupabaseAdminError as exc:
        logger.error("Supabase invite failed: %s", type(exc).__name__)
        raise UpstreamError(UPSTREAM_DETAIL) from None
    if supabase_id != user.id:
        # The Supabase user was deleted out-of-band, so Supabase created a NEW one (and emailed
        # it). Drop that stray user and leave our row alone.
        try:
            supabase.delete(supabase_id)
        except SupabaseAdminError as exc:
            logger.error("Compensating Supabase delete failed: %s", type(exc).__name__)
        raise Conflict("This invitation is out of date; revoke it and invite the address again")
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


def _reject_self(user: AppUser, acting_admin_id: uuid.UUID) -> None:
    # The caller is always an active admin (require_admin), so refusing self-service is also
    # what guarantees at least one active admin always remains.
    if user.id == acting_admin_id:
        raise Conflict("You can't do that to your own account")


def disable_user(
    db: Session, supabase: SupabaseAdmin, user_id: uuid.UUID, acting_admin_id: uuid.UUID
) -> AppUser:
    user = _get_user(db, user_id)
    _reject_self(user, acting_admin_id)
    if user.status != "active":
        raise Conflict("Only active users can be disabled")
    # Supabase first: if it fails, nothing changes on our side.
    _upstream("ban", lambda: supabase.ban(user.id))
    user.status = "disabled"
    db.commit()
    db.refresh(user)
    return user


def enable_user(db: Session, supabase: SupabaseAdmin, user_id: uuid.UUID) -> AppUser:
    user = _get_user(db, user_id)
    if user.status != "disabled":
        raise Conflict("Only disabled users can be enabled")
    _upstream("unban", lambda: supabase.unban(user.id))
    user.status = "active"
    db.commit()
    db.refresh(user)
    return user


def remove_user(
    db: Session,
    supabase: SupabaseAdmin,
    factory: sessionmaker[Session],
    user_id: uuid.UUID,
    confirm_email: str,
    acting_admin_id: uuid.UUID,
) -> None:
    """Permanent removal. Order: cut access, delete data, delete the Supabase user, delete the
    row. A failure after the first step leaves the user disabled; the call can be repeated."""
    user = _get_user(db, user_id)
    _reject_self(user, acting_admin_id)
    if user.email != confirm_email:
        raise Unprocessable("Confirmation email does not match")

    if user.status != "disabled":
        _upstream("ban", lambda: supabase.ban(user.id))
        user.status = "disabled"
        db.commit()

    delete_user_data(factory, user.id)
    _upstream("delete", lambda: supabase.delete(user.id))
    # A running job may have written rows since the first pass. This narrows the window; it does
    # not close it.
    delete_user_data(factory, user.id)
    db.delete(user)
    db.commit()
