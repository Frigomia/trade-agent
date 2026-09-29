import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app import rls
from app.models import AppUser
from tests.auth_support import USER_ID, add_app_user


def _can_update(engine, column: str) -> bool:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT has_column_privilege(:role, 'app_users', :column, 'UPDATE')"),
            {"role": rls.RUNTIME_ROLE, "column": column},
        ).scalar_one()


@pytest.mark.parametrize("column", ["status", "accepted_terms_at", "last_seen_at", "invited_at"])
def test_runtime_role_can_update_the_lifecycle_columns(engine, column):
    assert _can_update(engine, column) is True


@pytest.mark.parametrize("column", ["id", "email", "role", "created_at"])
def test_runtime_role_cannot_update_identity_columns(engine, column):
    assert _can_update(engine, column) is False


def test_runtime_role_cannot_promote_a_user_to_admin(db_session, app_session_local):
    add_app_user(db_session, role="user")

    with app_session_local() as session, pytest.raises(DBAPIError, match="permission denied"):
        session.execute(text("UPDATE app_users SET role = 'admin'"))


def test_runtime_role_can_still_create_update_status_and_delete_users(app_session_local):
    with app_session_local() as session:
        session.add(AppUser(id=USER_ID, email="u@example.com", role="user", status="invited"))
        session.commit()

        user = session.get(AppUser, USER_ID)
        user.status = "active"
        session.commit()
        assert session.get(AppUser, USER_ID).status == "active"

        session.delete(user)
        session.commit()
        assert session.get(AppUser, USER_ID) is None
