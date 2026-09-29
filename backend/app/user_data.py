"""Deletes a user's rows in every user-data table, through a session scoped to that user.

Used by both the admin's "remove user" flow and the user's own self-service delete — one
implementation, so the filtered-delete logic only needs to be correct in one place.
"""

import uuid

from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker

from app import rls
from app.db import Base, open_user_session


def delete_user_data(factory: sessionmaker[Session], user_id: uuid.UUID) -> None:
    """Two layers of protection: the explicit user_id filter (holds even if DATABASE_URL is a
    role that bypasses RLS) and RLS on the scoped session. Nothing is read."""
    with open_user_session(factory, user_id) as session:
        for table_name in rls.USER_TABLES:
            table = Base.metadata.tables[table_name]
            session.execute(delete(table).where(table.c.user_id == user_id))
        session.commit()
