import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import jwt
from jwt import PyJWKClient

from app.config import settings

logger = logging.getLogger(__name__)

# Asymmetric algorithms only, pinned explicitly: an unpinned decode is how "alg: none" and
# HS256-signed-with-the-public-key attacks work. Legacy shared-secret (HS256) is not accepted.
ALLOWED_ALGORITHMS = ["ES256", "RS256"]
AUDIENCE = "authenticated"

# Given a token, returns the key to verify it with. Production: the JWKS lookup below.
# Tests: FastAPI dependency override returning a fixed test key.
KeyResolver = Callable[[str], Any]


class AuthError(Exception):
    """The token is missing, malformed, expired, or otherwise not acceptable (HTTP 401)."""


class AuthUnavailable(Exception):
    """Tokens cannot be verified right now: JWKS unreachable or SUPABASE_URL unset (HTTP 503)."""


@dataclass(frozen=True)
class VerifiedToken:
    user_id: uuid.UUID
    email: str | None


def _auth_base_url() -> str:
    if not settings.supabase_url:
        raise AuthUnavailable("SUPABASE_URL is not configured")
    return f"{settings.supabase_url.rstrip('/')}/auth/v1"


_jwks_client: PyJWKClient | None = None


def _resolve_signing_key(token: str) -> Any:
    global _jwks_client
    if _jwks_client is None:
        # cache_keys keeps fetched keys in memory, so a short Supabase outage does not lock out
        # users whose signing key is already cached. An unknown key id triggers a refetch.
        _jwks_client = PyJWKClient(f"{_auth_base_url()}/.well-known/jwks.json", cache_keys=True)
    try:
        return _jwks_client.get_signing_key_from_jwt(token).key
    except jwt.PyJWKClientConnectionError as exc:
        raise AuthUnavailable("JWKS fetch failed") from exc
    except jwt.PyJWKClientError as exc:
        raise AuthError("No matching signing key") from exc


def get_key_resolver() -> KeyResolver:
    """FastAPI dependency; tests override it."""
    return _resolve_signing_key


def verify_token(token: str, resolve_key: KeyResolver) -> VerifiedToken:
    issuer = _auth_base_url()
    try:
        key = resolve_key(token)
        claims = jwt.decode(
            token,
            key,
            algorithms=ALLOWED_ALGORITHMS,
            audience=AUDIENCE,
            issuer=issuer,
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
    except jwt.PyJWTError as exc:
        # The class name is enough for the log; the message can echo token contents.
        raise AuthError(type(exc).__name__) from None

    try:
        user_id = uuid.UUID(str(claims["sub"]))
    except ValueError:
        raise AuthError("Subject is not a UUID") from None

    email = claims.get("email")
    return VerifiedToken(user_id=user_id, email=email if isinstance(email, str) else None)
