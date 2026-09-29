import logging
import uuid
from collections.abc import Generator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session, sessionmaker

from app.auth.tokens import (
    AuthError,
    AuthUnavailable,
    KeyResolver,
    get_key_resolver,
    verify_token,
)
from app.db import get_session_factory, open_user_session
from app.models import AppUser

logger = logging.getLogger(__name__)

# last_seen_at is refreshed at most this often, so it is not a write on every request.
LAST_SEEN_REFRESH = timedelta(minutes=5)

# auto_error=False: a missing header returns None here and we answer 401 ourselves, with the
# same body as every other rejection.
bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    email: str
    role: str
    monthly_analysis_limit: int | None = None
    monthly_chat_limit: int | None = None


def _not_authenticated() -> HTTPException:
    return HTTPException(
        status_code=401, detail="Not authenticated", headers={"WWW-Authenticate": "Bearer"}
    )


def _touch_last_seen(db: Session, row: AppUser) -> None:
    now = datetime.now(UTC).replace(tzinfo=None)  # column is naive UTC, like created_at
    if row.last_seen_at is not None and now - row.last_seen_at < LAST_SEEN_REFRESH:
        return
    try:
        row.last_seen_at = now
        db.commit()
    except Exception as exc:
        # Never block a request over a bookkeeping write. Log the class only: driver messages
        # can carry SQL and bound parameters.
        logger.warning("Failed to update last_seen_at: %s", type(exc).__name__)
        db.rollback()


_ACTIVE = frozenset({"active"})
_INVITED_OR_ACTIVE = frozenset({"invited", "active"})


def _authenticate(
    credentials: HTTPAuthorizationCredentials | None,
    resolve_key: KeyResolver,
    factory: sessionmaker[Session],
    allowed_statuses: frozenset[str],
) -> CurrentUser:
    if credentials is None:
        raise _not_authenticated()

    try:
        verified = verify_token(credentials.credentials, resolve_key)
    except AuthUnavailable:
        logger.error("Token verification is unavailable")
        raise HTTPException(
            status_code=503, detail="Authentication temporarily unavailable"
        ) from None
    except AuthError as exc:
        logger.info("Rejected token: %s", exc)
        raise _not_authenticated() from None

    with factory() as db:
        row = db.get(AppUser, verified.user_id)
        # Role and status come from our own table on every request, so disabling a user takes
        # effect immediately rather than when their token expires. A user with a valid
        # Supabase token but no row here (for example a self-registered account) is refused.
        if row is None or row.status not in allowed_statuses:
            logger.info("Refused user without allowed access: %s", verified.user_id)
            raise HTTPException(status_code=403, detail="No access to this service")
        # Build the result first: a failed bookkeeping commit expires the row's attributes.
        current = CurrentUser(
            id=row.id,
            email=row.email,
            role=row.role,
            monthly_analysis_limit=row.monthly_analysis_limit,
            monthly_chat_limit=row.monthly_chat_limit,
        )
        _touch_last_seen(db, row)
        return current


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    resolve_key: KeyResolver = Depends(get_key_resolver),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> CurrentUser:
    """Active users only: every data route uses this."""
    return _authenticate(credentials, resolve_key, factory, _ACTIVE)


def get_known_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    resolve_key: KeyResolver = Depends(get_key_resolver),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> CurrentUser:
    """Invited or active users: only /me and /me/accept, so an invitee can finish signing up."""
    return _authenticate(credentials, resolve_key, factory, _INVITED_OR_ACTIVE)


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="No access to this service")
    return user


def get_user_db(
    user: CurrentUser = Depends(get_current_user),
    factory: sessionmaker[Session] = Depends(get_session_factory),
) -> Generator[Session, None, None]:
    """One session per request whose every transaction is scoped to the caller (see app.db)."""
    session = open_user_session(factory, user.id)
    try:
        yield session
    finally:
        session.close()
