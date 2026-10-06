import uuid
from datetime import datetime

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.auth.supabase_admin import get_supabase_admin
from app.config import settings
from app.main import app
from app.models import AppSettings, AppUser, UserApiKey
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
            "monthly_analysis_limit", "monthly_analysis_used", "claude_key_state",
            "monthly_chat_limit", "monthly_chat_used",
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
    fake_supabase.ids_by_email["a@example.com"] = USER_ID

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


def test_resend_when_supabase_returns_a_different_id_conflicts_and_drops_the_stray_user(
    admin_client, db_session, fake_supabase
):
    invited_at = datetime(2024, 1, 1, 12, 0, 0)
    add_app_user(
        db_session, USER_ID, status="invited", email="stale@example.com", invited_at=invited_at
    )
    new_id = uuid.uuid4()
    fake_supabase.ids_by_email["stale@example.com"] = new_id

    response = admin_client.post(f"/admin/users/{USER_ID}/resend")

    assert response.status_code == 409
    assert ("delete", new_id) in fake_supabase.calls
    db_session.expire_all()
    assert db_session.get(AppUser, USER_ID).invited_at == invited_at


# ---- limits ----------------------------------------------------------------------------------
def test_list_users_includes_usage_fields(admin_client, db_session):
    add_app_user(db_session, USER_ID)

    response = admin_client.get("/admin/users")

    assert response.status_code == 200
    row = next(u for u in response.json() if u["id"] == str(USER_ID))
    assert row["monthly_analysis_limit"] == settings.default_monthly_analysis_limit
    assert row["monthly_analysis_used"] == 0
    assert row["monthly_chat_limit"] == settings.default_monthly_chat_limit
    assert row["monthly_chat_used"] == 0


def test_set_limits_overrides_and_then_clears(admin_client, db_session):
    add_app_user(db_session, USER_ID)

    response = admin_client.patch(f"/admin/users/{USER_ID}/limits", json={"analysis_limit": 7})
    assert response.status_code == 200
    assert response.json()["monthly_analysis_limit"] == 7
    # chat_limit was never mentioned in the body, so it stays at the default.
    assert response.json()["monthly_chat_limit"] == settings.default_monthly_chat_limit

    # Push chat_limit off its default so the next assertion can't pass by coincidence.
    response = admin_client.patch(f"/admin/users/{USER_ID}/limits", json={"chat_limit": 5})
    assert response.status_code == 200
    assert response.json()["monthly_chat_limit"] == 5

    response = admin_client.patch(f"/admin/users/{USER_ID}/limits", json={"analysis_limit": None})
    assert response.status_code == 200
    assert response.json()["monthly_analysis_limit"] == settings.default_monthly_analysis_limit
    # chat_limit was entirely absent from this body, so its override must survive untouched.
    assert response.json()["monthly_chat_limit"] == 5


def test_set_limits_rejects_a_negative_value(admin_client, db_session):
    add_app_user(db_session, USER_ID)

    response = admin_client.patch(f"/admin/users/{USER_ID}/limits", json={"analysis_limit": -1})

    assert response.status_code == 422


def test_set_limits_rejects_a_value_above_the_postgres_integer_column(admin_client, db_session):
    add_app_user(db_session, USER_ID)

    response = admin_client.patch(
        f"/admin/users/{USER_ID}/limits", json={"analysis_limit": 2_147_483_648}
    )

    assert response.status_code == 422


def test_set_limits_rejects_an_unknown_field(admin_client, db_session):
    add_app_user(db_session, USER_ID)

    response = admin_client.patch(f"/admin/users/{USER_ID}/limits", json={"analyiss_limit": 5})

    assert response.status_code == 422


def test_set_limits_unknown_user_is_404(admin_client):
    response = admin_client.patch(f"/admin/users/{uuid.uuid4()}/limits", json={"analysis_limit": 1})
    assert response.status_code == 404


# ---- default limits --------------------------------------------------------------------------
def test_limit_defaults_start_at_the_environment_values(admin_client):
    response = admin_client.get("/admin/limit-defaults")

    assert response.status_code == 200
    assert response.json() == {
        "analysis_limit": settings.default_monthly_analysis_limit,
        "chat_limit": settings.default_monthly_chat_limit,
    }


def test_setting_defaults_changes_everyone_without_an_override(admin_client, db_session):
    add_app_user(db_session, USER_ID)
    add_app_user(db_session, OTHER_USER_ID)
    admin_client.patch(f"/admin/users/{OTHER_USER_ID}/limits", json={"analysis_limit": 4})

    response = admin_client.put(
        "/admin/limit-defaults", json={"analysis_limit": 20, "chat_limit": 60}
    )

    assert response.status_code == 200
    assert response.json() == {"analysis_limit": 20, "chat_limit": 60}
    assert admin_client.get("/admin/limit-defaults").json() == {
        "analysis_limit": 20,
        "chat_limit": 60,
    }
    rows = {u["id"]: u for u in admin_client.get("/admin/users").json()}
    assert rows[str(USER_ID)]["monthly_analysis_limit"] == 20
    assert rows[str(USER_ID)]["monthly_chat_limit"] == 60
    # A personal override survives a change of the default.
    assert rows[str(OTHER_USER_ID)]["monthly_analysis_limit"] == 4
    assert rows[str(OTHER_USER_ID)]["monthly_chat_limit"] == 60


def test_setting_defaults_twice_keeps_a_single_row(admin_client, db_session):
    admin_client.put("/admin/limit-defaults", json={"analysis_limit": 1, "chat_limit": 2})
    admin_client.put("/admin/limit-defaults", json={"analysis_limit": 3, "chat_limit": 4})

    db_session.expire_all()
    rows = db_session.query(AppSettings).all()
    assert [
        (r.id, r.default_monthly_analysis_limit, r.default_monthly_chat_limit) for r in rows
    ] == [(1, 3, 4)]


@pytest.mark.parametrize(
    "body",
    [
        {"analysis_limit": -1, "chat_limit": 5},
        {"analysis_limit": 5},
        {"analysis_limit": 5, "chat_limit": None},
        {"analysis_limit": 5, "chat_limit": 2_147_483_648},
        {"analysis_limit": 5, "chat_limit": 5, "extra": 1},
    ],
)
def test_setting_defaults_rejects_bad_bodies(admin_client, body):
    assert admin_client.put("/admin/limit-defaults", json=body).status_code == 422


def test_an_admin_set_default_applies_to_a_users_own_usage_view(admin_client, client):
    admin_client.put("/admin/limit-defaults", json={"analysis_limit": 9, "chat_limit": 11})

    body = client.get("/me/usage").json()

    assert body["analysis_runs"]["limit"] == 9
    assert body["chat_messages"]["limit"] == 11


def test_the_users_list_shows_who_has_connected_claude(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="active", email="a@example.com")
    add_app_user(db_session, OTHER_USER_ID, status="active", email="b@example.com")
    db_session.query(AppUser).filter_by(id=USER_ID).update({"claude_key_state": "ok"})
    db_session.query(AppUser).filter_by(id=OTHER_USER_ID).update(
        {"claude_key_state": "needs_attention"}
    )
    db_session.commit()

    rows = {row["email"]: row for row in admin_client.get("/admin/users").json()}

    assert rows["a@example.com"]["claude_key_state"] == "ok"
    assert rows["b@example.com"]["claude_key_state"] == "needs_attention"
    assert rows["admin@example.com"]["claude_key_state"] == "none"


def test_the_users_list_exposes_no_key_material(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="active", email="a@example.com")
    db_session.add(
        UserApiKey(
            user_id=USER_ID,
            ciphertext=b"secret-ciphertext-bytes....",
            key_version=1,
            last4="9f3a",
            status="ok",
        )
    )
    db_session.commit()

    body = admin_client.get("/admin/users").text

    assert "9f3a" not in body
    assert "ciphertext" not in body
    assert "last4" not in body
