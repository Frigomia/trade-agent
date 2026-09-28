import time

import jwt
import pytest

import app.auth.tokens as tokens
from app.auth.tokens import AuthError, AuthUnavailable, verify_token
from app.config import settings
from tests.auth_support import (
    OTHER_PRIVATE_KEY,
    PUBLIC_KEY,
    TEST_ISSUER,
    TEST_SUPABASE_URL,
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


class _FakeSigningKey:
    key = PUBLIC_KEY


class _FakeJWKClient:
    """Records construction args; get_signing_key_from_jwt is driven by `outcome`."""

    instances: list["_FakeJWKClient"] = []
    outcome: Exception | None = None

    def __init__(self, url: str, **kwargs: object) -> None:
        self.url = url
        self.kwargs = kwargs
        _FakeJWKClient.instances.append(self)

    def get_signing_key_from_jwt(self, token: str) -> _FakeSigningKey:
        if _FakeJWKClient.outcome is not None:
            raise _FakeJWKClient.outcome
        return _FakeSigningKey()


@pytest.fixture()
def fake_jwks(monkeypatch):
    _FakeJWKClient.instances = []
    _FakeJWKClient.outcome = None
    monkeypatch.setattr(tokens, "_jwks_client", None)
    monkeypatch.setattr(tokens, "PyJWKClient", _FakeJWKClient)
    return _FakeJWKClient


def test_resolver_returns_the_jwks_signing_key(fake_jwks):
    assert tokens._resolve_signing_key(make_token()) is PUBLIC_KEY


def test_resolver_builds_jwks_url_lazily_and_reuses_the_client(fake_jwks):
    assert fake_jwks.instances == []

    tokens._resolve_signing_key(make_token())
    tokens._resolve_signing_key(make_token())

    assert len(fake_jwks.instances) == 1
    client = fake_jwks.instances[0]
    assert client.url == f"{TEST_SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    assert client.kwargs == {"cache_keys": True}


def test_resolver_connection_failure_means_auth_is_unavailable(fake_jwks):
    fake_jwks.outcome = jwt.PyJWKClientConnectionError("down")
    with pytest.raises(AuthUnavailable):
        tokens._resolve_signing_key(make_token())


def test_resolver_unknown_key_id_is_an_auth_error(fake_jwks):
    fake_jwks.outcome = jwt.PyJWKClientError("Unable to find a signing key that matches")
    with pytest.raises(AuthError):
        tokens._resolve_signing_key(make_token())
