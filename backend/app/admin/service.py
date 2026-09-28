"""Lifecycle actions on app_users. Services raise AdminError subclasses; main.py maps them to
HTTP responses, so this module never imports FastAPI."""

import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import AppUser

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
