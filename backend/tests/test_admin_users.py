import uuid
from datetime import datetime

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.auth.supabase_admin import get_supabase_admin
from app.config import settings
from app.main import app
from app.models import AppUser
from tests.auth_support import ADMIN_ID, OTHER_USER_ID, USER_ID, add_app_user

OLD = datetime(2020, 1, 1)


def _row(db_session, user_id) -> AppUser | None:
    db_session.expire_all()
    return db_session.get(AppUser, user_id)


# ---- access control -------------------------------------------------------------------------
def test_admin_routes_require_authentication(anon_client):
    assert anon_client.get("/admin/users").status_code == 401
    assert (
        anon_client.post("/admin/users/invite", json={"email": "a@example.com"}).status_code == 401
    )


def test_a_non_admin_is_refused_on_admin_routes(client):
    assert client.get("/admin/users").status_code == 403
    assert client.post("/admin/users/invite", json={"email": "a@example.com"}).status_code == 403


def test_user_management_is_503_when_the_secret_key_is_not_configured(admin_client, monkeypatch):
    app.dependency_overrides.pop(get_supabase_admin)
    monkeypatch.setattr(settings, "supabase_secret_key", None)

    response = admin_client.post("/admin/users/invite", json={"email": "a@example.com"})

    assert response.status_code == 503
    assert response.json() == {"detail": "User management not configured"}


def test_auth_is_checked_before_the_503(anon_client, client, monkeypatch):
    monkeypatch.setattr(settings, "supabase_secret_key", None)

    assert (
        anon_client.post("/admin/users/invite", json={"email": "a@example.com"}).status_code == 401
    )
    assert client.post("/admin/users/invite", json={"email": "a@example.com"}).status_code == 403


# ---- list ------------------------------------------------------------------------------------
def test_list_shows_users_with_invitation_expiry_hint(admin_client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "invite_link_hours", 24)
    add_app_user(db_session, USER_ID, status="invited", invited_at=datetime(2026, 9, 28, 10, 0))

    users = {u["id"]: u for u in admin_client.get("/admin/users").json()}

    assert users[str(ADMIN_ID)]["role"] == "admin"
    assert users[str(ADMIN_ID)]["invite_expires_at"] is None
    assert users[str(USER_ID)]["status"] == "invited"
    assert users[str(USER_ID)]["invite_expires_at"].startswith("2026-09-29T10:00:00")


def test_list_filters_by_status_and_rejects_an_unknown_status(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="invited")
    add_app_user(db_session, OTHER_USER_ID, status="disabled")

    invited = admin_client.get("/admin/users?status=invited").json()
    assert [u["id"] for u in invited] == [str(USER_ID)]
    assert admin_client.get("/admin/users?status=bogus").status_code == 422


def test_list_never_exposes_financial_fields(admin_client):
    for user in admin_client.get("/admin/users").json():
        assert set(user) == {
            "id", "email", "role", "status", "created_at", "invited_at",
            "invite_expires_at", "accepted_terms_at", "last_seen_at",
        }  # fmt: skip


# ---- invite ----------------------------------------------------------------------------------
def test_invite_creates_an_invited_user_after_supabase_succeeds(
    admin_client, fake_supabase, db_session, monkeypatch
):
    monkeypatch.setattr(settings, "invite_redirect_url", "https://app.example.com/welcome")
    fake_supabase.next_id = USER_ID

    response = admin_client.post("/admin/users/invite", json={"email": "  New@Example.COM "})

    assert response.status_code == 201
    body = response.json()
    assert body["id"] == str(USER_ID)
    assert body["email"] == "new@example.com"
    assert body["status"] == "invited"
    assert body["invite_expires_at"] is not None
    assert fake_supabase.calls == [("invite", "new@example.com")]
    stored = _row(db_session, USER_ID)
    assert stored.role == "user" and stored.invited_at is not None


def test_invite_rejects_an_invalid_email(admin_client):
    assert (
        admin_client.post("/admin/users/invite", json={"email": "not-an-email"}).status_code == 422
    )


def test_invite_of_an_address_that_already_has_access_is_409(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="active", email="a@example.com")

    response = admin_client.post("/admin/users/invite", json={"email": "a@example.com"})

    assert response.status_code == 409
    assert fake_supabase.calls == []


def test_invite_of_a_still_invited_address_acts_as_a_resend(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="invited", email="a@example.com", invited_at=OLD)
    fake_supabase.ids_by_email["a@example.com"] = USER_ID

    response = admin_client.post("/admin/users/invite", json={"email": "a@example.com"})

    assert response.status_code == 201
    assert response.json()["id"] == str(USER_ID)
    assert _row(db_session, USER_ID).invited_at > OLD
    assert fake_supabase.calls == [("invite", "a@example.com")]


def test_invite_address_already_registered_in_supabase_is_409(
    admin_client, fake_supabase, db_session
):
    fake_supabase.existing_emails.add("taken@example.com")

    response = admin_client.post("/admin/users/invite", json={"email": "taken@example.com"})

    assert response.status_code == 409
    assert db_session.query(AppUser).filter_by(email="taken@example.com").count() == 0


def test_invite_supabase_failure_is_502_and_creates_nothing(
    admin_client, fake_supabase, db_session
):
    fake_supabase.fail_on.add("invite")

    response = admin_client.post("/admin/users/invite", json={"email": "a@example.com"})

    assert response.status_code == 502
    assert response.json() == {"detail": "Could not reach the authentication service"}
    assert db_session.query(AppUser).filter_by(email="a@example.com").count() == 0


def test_invite_colliding_with_an_existing_user_is_409_and_deletes_nothing(
    admin_client, fake_supabase, db_session
):
    # The fake hands back an id that already exists in app_users, so the insert fails.
    fake_supabase.next_id = ADMIN_ID

    response = admin_client.post("/admin/users/invite", json={"email": "a@example.com"})

    assert response.status_code == 409
    assert _row(db_session, ADMIN_ID).email == "admin@example.com"
    assert ("delete", ADMIN_ID) not in fake_supabase.calls
    assert db_session.query(AppUser).filter_by(email="a@example.com").count() == 0


def test_invite_database_failure_deletes_the_supabase_user(
    admin_client, fake_supabase, db_session, monkeypatch
):
    fake_supabase.next_id = USER_ID
    original_commit = Session.commit

    def failing_commit(self):
        if any(isinstance(obj, AppUser) for obj in self.new):  # only the invite insert
            raise OperationalError("INSERT", {}, Exception("database down"))
        return original_commit(self)

    monkeypatch.setattr(Session, "commit", failing_commit)

    with pytest.raises(OperationalError):
        admin_client.post("/admin/users/invite", json={"email": "a@example.com"})

    assert ("delete", USER_ID) in fake_supabase.calls
    assert _row(db_session, USER_ID) is None


def test_invite_of_an_invited_address_already_confirmed_in_supabase_is_409(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="invited", email="a@example.com", invited_at=OLD)
    fake_supabase.existing_emails.add("a@example.com")

    response = admin_client.post("/admin/users/invite", json={"email": "a@example.com"})

    assert response.status_code == 409
    assert _row(db_session, USER_ID).invited_at == OLD


# ---- resend ----------------------------------------------------------------------------------
def test_resend_refreshes_the_invitation(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="invited", email="a@example.com", invited_at=OLD)

    response = admin_client.post(f"/admin/users/{USER_ID}/resend")

    assert response.status_code == 200
    assert _row(db_session, USER_ID).invited_at > OLD
    assert fake_supabase.calls == [("invite", "a@example.com")]


def test_resend_is_only_for_invited_users(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="active")

    assert admin_client.post(f"/admin/users/{USER_ID}/resend").status_code == 409


def test_resend_of_an_address_already_confirmed_in_supabase_is_409(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="invited", email="a@example.com", invited_at=OLD)
    fake_supabase.existing_emails.add("a@example.com")

    assert admin_client.post(f"/admin/users/{USER_ID}/resend").status_code == 409
    assert _row(db_session, USER_ID).invited_at == OLD


def test_resend_unknown_user_is_404(admin_client):
    assert admin_client.post(f"/admin/users/{uuid.uuid4()}/resend").status_code == 404


def test_resend_supabase_failure_is_502_and_changes_nothing(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="invited", invited_at=OLD)
    fake_supabase.fail_on.add("invite")

    assert admin_client.post(f"/admin/users/{USER_ID}/resend").status_code == 502
    assert _row(db_session, USER_ID).invited_at == OLD


# ---- revoke ----------------------------------------------------------------------------------
def test_revoke_deletes_the_invited_user_everywhere(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="invited")

    response = admin_client.post(f"/admin/users/{USER_ID}/revoke")

    assert response.status_code == 204
    assert _row(db_session, USER_ID) is None
    assert fake_supabase.calls == [("delete", USER_ID)]


def test_revoke_is_only_for_invited_users(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="active")

    assert admin_client.post(f"/admin/users/{USER_ID}/revoke").status_code == 409


def test_revoke_supabase_failure_keeps_the_row(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="invited")
    fake_supabase.fail_on.add("delete")

    assert admin_client.post(f"/admin/users/{USER_ID}/revoke").status_code == 502
    assert _row(db_session, USER_ID) is not None
