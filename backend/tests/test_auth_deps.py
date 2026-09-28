import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, get_current_user, require_admin
from app.auth.tokens import AuthUnavailable, get_key_resolver
from app.db import get_session_factory
from app.models import AppUser
from tests.auth_support import (
    USER_ID,
    add_app_user,
    auth_headers,
    make_token,
    resolve_test_key,
)


@pytest.fixture()
def probe(app_session_local):
    """A tiny app exposing the auth dependencies, wired to the restricted test role."""
    probe_app = FastAPI()

    @probe_app.get("/whoami")
    def whoami(user: CurrentUser = Depends(get_current_user)) -> dict[str, str]:
        return {"id": str(user.id), "email": user.email, "role": user.role}

    @probe_app.get("/admin-only")
    def admin_only(user: CurrentUser = Depends(require_admin)) -> dict[str, str]:
        return {"id": str(user.id)}

    probe_app.dependency_overrides[get_session_factory] = lambda: app_session_local
    probe_app.dependency_overrides[get_key_resolver] = lambda: resolve_test_key
    with TestClient(probe_app) as test_client:
        test_client.app_ref = probe_app  # so tests can re-override the key resolver
        yield test_client


def test_missing_authorization_header_is_401(probe):
    response = probe.get("/whoami")
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


@pytest.mark.parametrize(
    "header",
    ["Bearer", "Bearer ", "Basic abc123", "Bearer not-a-jwt", ""],
)
def test_malformed_authorization_headers_are_401(probe, header):
    response = probe.get("/whoami", headers={"Authorization": header})
    assert response.status_code == 401


def test_lowercase_bearer_scheme_is_accepted(probe, db_session):
    add_app_user(db_session)
    token = make_token()
    response = probe.get("/whoami", headers={"Authorization": f"bearer {token}"})
    assert response.status_code == 200


def test_valid_token_for_known_user_returns_identity_from_app_users(probe, db_session):
    add_app_user(db_session, role="user", email="real@example.com")
    response = probe.get("/whoami", headers=auth_headers())
    assert response.status_code == 200
    # Email and role come from our table, not from the token's claims.
    assert response.json() == {"id": str(USER_ID), "email": "real@example.com", "role": "user"}


def test_valid_token_without_app_users_row_is_403(probe):
    response = probe.get("/whoami", headers=auth_headers())
    assert response.status_code == 403
    assert response.json() == {"detail": "No access to this service"}


def test_disabled_user_with_unexpired_token_is_403(probe, db_session):
    add_app_user(db_session, status="disabled")
    response = probe.get("/whoami", headers=auth_headers())
    assert response.status_code == 403


def test_non_uuid_subject_is_401_not_500(probe):
    token = make_token(sub="not-a-uuid")
    response = probe.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_jwks_outage_is_503(probe):
    def _down(token: str) -> object:
        raise AuthUnavailable("JWKS fetch failed")

    probe.app_ref.dependency_overrides[get_key_resolver] = lambda: _down
    response = probe.get("/whoami", headers=auth_headers())
    assert response.status_code == 503


def test_non_admin_is_403_on_admin_route(probe, db_session):
    add_app_user(db_session, role="user")
    assert probe.get("/admin-only", headers=auth_headers()).status_code == 403


def test_admin_is_allowed_on_admin_route(probe, db_session):
    add_app_user(db_session, role="admin")
    assert probe.get("/admin-only", headers=auth_headers()).status_code == 200


def test_last_seen_is_set_once_and_not_rewritten_within_the_refresh_window(probe, db_session):
    add_app_user(db_session)
    probe.get("/whoami", headers=auth_headers())
    db_session.expire_all()
    first = db_session.get(AppUser, USER_ID).last_seen_at
    assert first is not None

    probe.get("/whoami", headers=auth_headers())
    db_session.expire_all()
    assert db_session.get(AppUser, USER_ID).last_seen_at == first


def test_failed_last_seen_write_does_not_block_the_request(probe, db_session, monkeypatch):
    add_app_user(db_session, email="real@example.com")

    def _fail(self):
        self.rollback()  # like a real failed commit: expires the loaded row
        raise RuntimeError("boom")

    monkeypatch.setattr(Session, "commit", _fail)

    response = probe.get("/whoami", headers=auth_headers())

    assert response.status_code == 200
    assert response.json()["email"] == "real@example.com"
