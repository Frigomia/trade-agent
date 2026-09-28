import uuid

import pytest

from app.auth.bootstrap_admin import bootstrap_admin
from app.models import AppUser


def test_bootstrap_creates_the_first_admin(db_session):
    user_id = uuid.uuid4()

    admin = bootstrap_admin(db_session, "  Owner@Example.com ", user_id)

    assert admin.id == user_id
    assert admin.email == "owner@example.com"  # trimmed and lowercased, like Supabase
    assert admin.role == "admin"
    assert admin.status == "active"


def test_bootstrap_refuses_when_an_admin_already_exists(db_session):
    db_session.add(AppUser(id=uuid.uuid4(), email="first@example.com", role="admin"))
    db_session.commit()

    with pytest.raises(ValueError, match="already exists"):
        bootstrap_admin(db_session, "second@example.com", uuid.uuid4())
