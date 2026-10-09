"""Deletes a user's rows in every user-data table, through a session scoped to that user.

Used by both the admin's "remove user" flow and the user's own self-service delete — one
implementation, so the filtered-delete logic only needs to be correct in one place.
"""

import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from app import rls
from app.db import Base, lock_user_for_insert, open_user_session
from app.models import AppUser, TelegramLink


def delete_user_data(factory: sessionmaker[Session], user_id: uuid.UUID) -> int | None:
    """Two layers of protection: the explicit user_id filter (holds even if DATABASE_URL is a
    role that bypasses RLS) and RLS on the scoped session.

    Returns the Telegram chat id the user was linked to (None when there was none), read before the
    delete, so the caller can remove the Redis chat-to-user mapping too."""
    with open_user_session(factory, user_id) as session:
        # Waits for any background writer holding this user's lock, so none lands after the delete.
        # Self-service DELETE /me/data leaves the account active, so a late row there belongs to a
        # live user and is intended; the admin remove_user flow disables the account first.
        lock_user_for_insert(session, user_id)
        chat_id = session.scalar(
            select(TelegramLink.chat_id).where(TelegramLink.user_id == user_id)
        )
        for table_name in rls.USER_TABLES:
            table = Base.metadata.tables[table_name]
            session.execute(delete(table).where(table.c.user_id == user_id))
        # The key row is gone (it is in USER_TABLES), so the admin-visible state must say so too.
        session.execute(
            update(AppUser).where(AppUser.id == user_id).values(claude_key_state="none")
        )
        session.commit()
    return chat_id
