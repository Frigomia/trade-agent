import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import AppUser


def test_app_user_roundtrip_applies_defaults(db_session):
    user_id = uuid.uuid4()
    db_session.add(AppUser(id=user_id, email="a@example.com", role="user"))
    db_session.commit()

    saved = db_session.get(AppUser, user_id)
    assert saved is not None
    assert saved.status == "active"
    assert saved.created_at is not None
    assert saved.accepted_terms_at is None
    assert saved.last_seen_at is None


def test_app_user_email_is_unique(db_session):
    db_session.add(AppUser(id=uuid.uuid4(), email="a@example.com", role="user"))
    db_session.commit()

    db_session.add(AppUser(id=uuid.uuid4(), email="a@example.com", role="admin"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
