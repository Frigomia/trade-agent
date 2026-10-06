"""Per-user Claude API keys: encryption at rest, and (later) which client a request uses."""

import asyncio
import base64
import binascii
import os
import uuid

import anthropic
from anthropic import Anthropic
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings

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
    try:
        plain = AESGCM(_master_key()).decrypt(
            blob[:_NONCE_BYTES], blob[_NONCE_BYTES:], user_id.bytes
        )
    except KeyEncryptionError:
        raise
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
