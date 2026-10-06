"""Per-user Claude API keys: encryption at rest, and (later) which client a request uses."""

import asyncio
import base64
import binascii
import logging
import os
import uuid

import anthropic
from anthropic import Anthropic
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.config import settings
from app.db import scoped_session
from app.models import AppUser, UserApiKey

logger = logging.getLogger(__name__)

KEY_VERSION = 1
_NONCE_BYTES = 12
_SECRET_BYTES = 32
# Used outside production only, so local runs and tests need no configuration. Production refuses to
# start without the real secret (check_master_secret), so this value never encrypts a real key.
_DEV_SECRET = base64.b64encode(b"dev-only-secret-not-for-prod-123").decode()


class KeyEncryptionError(Exception):
    """The master secret is missing or malformed, or stored key material cannot be decrypted.
    Messages name the setting and never carry key material or the secret itself."""


def _master_key() -> bytes:
    secret = settings.key_encryption_secret
    if not secret:
        if settings.app_env == "production":
            raise KeyEncryptionError("KEY_ENCRYPTION_SECRET is not set")
        secret = _DEV_SECRET
    try:
        raw = base64.b64decode(secret, validate=True)
    except (binascii.Error, ValueError):
        raise KeyEncryptionError("KEY_ENCRYPTION_SECRET is not valid base64") from None
    if len(raw) != _SECRET_BYTES:
        raise KeyEncryptionError("KEY_ENCRYPTION_SECRET must decode to 32 bytes")
    return raw


def check_master_secret() -> None:
    """Raises KeyEncryptionError if the secret is missing or malformed (production start-up)."""
    _master_key()


def encrypt_key(user_id: uuid.UUID, api_key: str) -> bytes:
    """`nonce || ciphertext+tag`, with the user's id bound in as associated data so a ciphertext
    copied to another user's row fails to decrypt."""
    nonce = os.urandom(_NONCE_BYTES)
    return nonce + AESGCM(_master_key()).encrypt(nonce, api_key.encode(), user_id.bytes)


def decrypt_key(user_id: uuid.UUID, blob: bytes) -> str:
    key = _master_key()
    try:
        plain = AESGCM(key).decrypt(blob[:_NONCE_BYTES], blob[_NONCE_BYTES:], user_id.bytes)
    except Exception:
        # `from None`: the underlying error text must not travel with this one.
        raise KeyEncryptionError("stored key could not be decrypted") from None
    return plain.decode()


class ClaudeKeyRejected(Exception):
    """Anthropic would not accept the key right now. `code` is stable for the frontend; `message`
    is shown to the user; neither carries the key or Anthropic's raw response."""

    def __init__(self, code: str, message: str, http_status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


async def verify_key(api_key: str) -> None:
    """One free call (listing models costs no tokens) with the key; raises ClaudeKeyRejected."""

    def _check() -> None:
        Anthropic(api_key=api_key, max_retries=0, timeout=10.0).models.list(limit=1)

    try:
        await asyncio.to_thread(_check)
    except anthropic.AuthenticationError:
        raise ClaudeKeyRejected(
            "invalid_key", "Anthropic did not accept that key. Check that you copied all of it."
        ) from None
    except (anthropic.PermissionDeniedError, anthropic.BadRequestError):
        raise ClaudeKeyRejected(
            "key_not_usable",
            "That key cannot be used right now. Check that the account has credit and that "
            "the key is allowed to make requests.",
        ) from None
    except anthropic.APIConnectionError:
        raise ClaudeKeyRejected(
            "anthropic_unreachable", "Could not reach Anthropic. Try again in a moment.", 502
        ) from None
    except anthropic.APIStatusError:
        raise ClaudeKeyRejected(
            "anthropic_unavailable", "Anthropic is busy right now. Try again in a moment.", 502
        ) from None


class ClaudeKeyRequired(Exception):
    """The caller has no usable Claude key. Turned into a 409 with the stable code
    `claude_key_required` (see main.py). The message is fixed text: no ids, no key material."""

    def __init__(self, needs_attention: bool = False) -> None:
        self.needs_attention = needs_attention
        super().__init__(
            "Your Claude key needs attention. Reconnect your Claude key to continue."
            if needs_attention
            else "Connect Claude to use this."
        )


def _usable_key_row(db: Session, user_id: uuid.UUID, role: str) -> UserApiKey | None:
    """The user's saved key row, or None for an admin who uses the server key. Raises
    ClaudeKeyRequired for a user with no key, and for a flagged key (never a silent fallback)."""
    row = db.query(UserApiKey).filter_by(user_id=user_id).one_or_none()
    if row is not None:
        if row.status != "ok":
            raise ClaudeKeyRequired(needs_attention=True)
        return row
    if role == "admin":
        return None
    raise ClaudeKeyRequired()


def resolve_client(db: Session, user_id: uuid.UUID, role: str) -> Anthropic | None:
    """The Claude client for a request made by this user.

    A user's own saved key always wins. With none: an admin gets None, meaning "use the server's
    own key"; everyone else must connect one. A key flagged needs_attention (or one that cannot be
    decrypted, for example after the master secret changed) never silently falls back: the person
    is asked to reconnect. The decrypted key lives only inside the returned client.
    """
    row = _usable_key_row(db, user_id, role)
    if row is None:
        return None
    try:
        return Anthropic(api_key=decrypt_key(user_id, row.ciphertext))
    except KeyEncryptionError:
        logger.warning("A saved Claude key for user %s could not be decrypted", user_id)
        # Flag it so the Account page and the admin list show it; this runs in its own session.
        mark_needs_attention(user_id)
        raise ClaudeKeyRequired(needs_attention=True) from None


def mark_needs_attention(user_id: uuid.UUID) -> None:
    """Flags the user's key as rejected by Anthropic (revoked or invalid), in its own session so it
    works from a background job. Does nothing when the user has no saved key."""
    with scoped_session(user_id) as db:
        flagged = (
            db.query(UserApiKey).filter_by(user_id=user_id).update({"status": "needs_attention"})
        )
        if flagged:
            db.query(AppUser).filter_by(id=user_id).update({"claude_key_state": "needs_attention"})
        db.commit()
    if flagged:
        logger.warning("Claude key for user %s was rejected by Anthropic", user_id)


def is_key_problem(exc: Exception) -> bool:
    """True when an Anthropic error means the caller's key itself is unusable: rejected, not
    permitted, or the account is out of credit. Any other BadRequestError (for example one caused
    by our own prompt) is not the key's fault and must not flag it."""
    if isinstance(exc, anthropic.AuthenticationError | anthropic.PermissionDeniedError):
        return True
    return isinstance(exc, anthropic.BadRequestError) and "credit balance" in str(exc).lower()


def require_claude_key(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> None:
    """Dependency for routes that spend Claude money: fails with ClaudeKeyRequired before any
    usage is counted or anything is stored. It only checks that a usable key exists; it builds no
    client and decrypts nothing (the handler does that once, through resolve_client)."""
    _usable_key_row(db, user.id, user.role)


def has_usable_key(db: Session, user_id: uuid.UUID, role: str) -> bool:
    """True when a request for this user could get a Claude client: a saved key that is `ok`, or no
    key at all for an admin (who then uses the server key). Decrypts nothing and builds no client."""
    try:
        _usable_key_row(db, user_id, role)
    except ClaudeKeyRequired:
        return False
    return True
