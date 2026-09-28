import uuid
from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import DeclarativeBase, Session, SessionTransaction, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Key in Session.info holding the user id whose rows the session may see (see rls.py).
RLS_USER_KEY = "rls_user_id"


class Base(DeclarativeBase):
    pass


def _apply_rls_user(
    session: Session, transaction: SessionTransaction, connection: Connection
) -> None:
    """Runs at the start of every transaction, so the setting survives commit() and rollback().

    A transaction-local setting (is_local = true) disappears when the transaction ends, and
    handlers commit mid-request; re-applying it per transaction keeps RLS correct without
    session-level state that could leak to the next user of a pooled connection.
    """
    user_id = session.info.get(RLS_USER_KEY)
    if user_id is not None:
        connection.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": str(user_id)},
        )


event.listen(Session, "after_begin", _apply_rls_user)


def open_user_session(factory: sessionmaker[Session], user_id: uuid.UUID) -> Session:
    session = factory()
    session.info[RLS_USER_KEY] = user_id
    return session


@contextmanager
def scoped_session(user_id: uuid.UUID) -> Generator[Session, None, None]:
    """A session for background work: sees only user_id's rows."""
    session = open_user_session(SessionLocal, user_id)
    try:
        yield session
    finally:
        session.close()


def get_session_factory() -> sessionmaker[Session]:
    """FastAPI dependency so tests can swap in a factory bound to the restricted test role."""
    return SessionLocal
