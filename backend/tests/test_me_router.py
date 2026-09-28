from datetime import datetime

from app.models import AppUser
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user, auth_headers


def test_me_returns_the_callers_own_state(client):
    body = client.get("/me").json()

    assert body["id"] == str(USER_ID)
    assert body["email"] == "user@example.com"
    assert body["role"] == "user"
    assert body["status"] == "active"


def test_an_invited_user_can_read_me_but_nothing_else(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited", invited_at=datetime(2026, 9, 28))
    headers = auth_headers(OTHER_USER_ID)

    assert client.get("/me", headers=headers).json()["status"] == "invited"
    assert client.get("/portfolio/holdings", headers=headers).status_code == 403
    assert client.get("/preferences", headers=headers).status_code == 403


def test_a_disabled_user_is_refused_on_me_and_accept(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="disabled")
    headers = auth_headers(OTHER_USER_ID)

    assert client.get("/me", headers=headers).status_code == 403
    assert (
        client.post("/me/accept", json={"accept_terms": True}, headers=headers).status_code == 403
    )


def test_an_unknown_user_is_refused_on_me(client):
    assert client.get("/me", headers=auth_headers(OTHER_USER_ID)).status_code == 403


def test_me_requires_authentication(anon_client):
    assert anon_client.get("/me").status_code == 401
    assert anon_client.post("/me/accept", json={"accept_terms": True}).status_code == 401


def test_accepting_activates_an_invited_user_and_records_the_terms(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited", invited_at=datetime(2026, 9, 28))
    headers = auth_headers(OTHER_USER_ID)

    response = client.post("/me/accept", json={"accept_terms": True}, headers=headers)

    assert response.status_code == 200
    assert response.json()["status"] == "active"
    assert response.json()["accepted_terms_at"] is not None
    # Now a normal active user: regular routes work.
    assert client.get("/portfolio/holdings", headers=headers).status_code == 200


def test_accepting_without_ticking_the_terms_changes_nothing(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    headers = auth_headers(OTHER_USER_ID)

    assert (
        client.post("/me/accept", json={"accept_terms": False}, headers=headers).status_code == 422
    )
    assert client.post("/me/accept", json={}, headers=headers).status_code == 422

    db_session.expire_all()
    stored = db_session.get(AppUser, OTHER_USER_ID)
    assert stored.status == "invited"
    assert stored.accepted_terms_at is None


def test_accepting_twice_is_idempotent(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    headers = auth_headers(OTHER_USER_ID)

    first = client.post("/me/accept", json={"accept_terms": True}, headers=headers).json()
    second = client.post("/me/accept", json={"accept_terms": True}, headers=headers).json()

    assert second["status"] == "active"
    assert second["accepted_terms_at"] == first["accepted_terms_at"]
