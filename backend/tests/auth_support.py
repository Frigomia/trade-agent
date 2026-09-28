"""Helpers for minting test JWTs and creating app users. Test-only."""

import time
import uuid
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy.orm import Session

from app.models import AppUser

TEST_SUPABASE_URL = "https://test-project.supabase.co"
TEST_ISSUER = f"{TEST_SUPABASE_URL}/auth/v1"

USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
OTHER_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")

_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
PUBLIC_KEY = _PRIVATE_KEY.public_key()
OTHER_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())


def make_token(
    sub: str | uuid.UUID = USER_ID,
    *,
    expires_in: int = 3600,
    audience: str = "authenticated",
    issuer: str = TEST_ISSUER,
    key: Any = None,
    algorithm: str = "ES256",
    email: str = "user@example.com",
    drop_claims: tuple[str, ...] = (),
) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": str(sub),
        "aud": audience,
        "iss": issuer,
        "iat": now,
        "exp": now + expires_in,
        "email": email,
    }
    for name in drop_claims:
        claims.pop(name, None)
    return jwt.encode(claims, key or _PRIVATE_KEY, algorithm=algorithm, headers={"kid": "test-key"})


def auth_headers(sub: str | uuid.UUID = USER_ID) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub)}"}


def resolve_test_key(token: str) -> Any:
    """Stand-in for the JWKS lookup: always returns the test public key."""
    return PUBLIC_KEY


def add_app_user(
    session: Session,
    user_id: uuid.UUID = USER_ID,
    *,
    role: str = "user",
    status: str = "active",
    email: str | None = None,
) -> AppUser:
    user = AppUser(
        id=user_id,
        email=email or f"{user_id}@example.com",
        role=role,
        status=status,
    )
    session.add(user)
    session.commit()
    return user
