import time

import jwt
import pytest

from app.auth.tokens import AuthError, AuthUnavailable, verify_token
from app.config import settings
from tests.auth_support import (
    OTHER_PRIVATE_KEY,
    TEST_ISSUER,
    USER_ID,
    make_token,
    resolve_test_key,
)


def test_valid_token_yields_user_id_and_email():
    verified = verify_token(make_token(), resolve_test_key)

    assert verified.user_id == USER_ID
    assert verified.email == "user@example.com"


def test_expired_token_is_rejected():
    with pytest.raises(AuthError):
        verify_token(make_token(expires_in=-10), resolve_test_key)


def test_wrong_audience_is_rejected():
    with pytest.raises(AuthError):
        verify_token(make_token(audience="anon"), resolve_test_key)


def test_wrong_issuer_is_rejected():
    with pytest.raises(AuthError):
        verify_token(make_token(issuer="https://evil.example.com/auth/v1"), resolve_test_key)


def test_token_signed_by_another_key_is_rejected():
    with pytest.raises(AuthError):
        verify_token(make_token(key=OTHER_PRIVATE_KEY), resolve_test_key)


def test_hs256_token_is_rejected():
    token = make_token(key="a-shared-secret-that-is-long-enough-32b", algorithm="HS256")
    with pytest.raises(AuthError):
        verify_token(token, resolve_test_key)


def test_alg_none_token_is_rejected():
    # Every required claim is present, so the only thing wrong with this token is alg "none".
    claims = {
        "sub": str(USER_ID),
        "aud": "authenticated",
        "iss": TEST_ISSUER,
        "exp": int(time.time()) + 3600,
    }
    token = jwt.encode(claims, None, algorithm="none")
    with pytest.raises(AuthError):
        verify_token(token, resolve_test_key)


@pytest.mark.parametrize("missing", ["sub", "exp", "aud", "iss"])
def test_token_missing_a_required_claim_is_rejected(missing):
    with pytest.raises(AuthError):
        verify_token(make_token(drop_claims=(missing,)), resolve_test_key)


def test_non_uuid_subject_is_rejected():
    with pytest.raises(AuthError):
        verify_token(make_token(sub="not-a-uuid"), resolve_test_key)


def test_garbage_token_is_rejected():
    with pytest.raises(AuthError):
        verify_token("not-a-token", resolve_test_key)


def test_unconfigured_supabase_url_means_auth_is_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", None)
    with pytest.raises(AuthUnavailable):
        verify_token(make_token(), resolve_test_key)


def test_resolver_unavailable_propagates():
    def _down(token: str) -> object:
        raise AuthUnavailable("JWKS fetch failed")

    with pytest.raises(AuthUnavailable):
        verify_token(make_token(), _down)
