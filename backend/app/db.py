import uuid
from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import DeclarativeBase, Session, SessionTransaction, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True, hide_parameters=True)
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


class UnsafeRuntimeRoleError(RuntimeError):
    """The runtime database role could bypass RLS. Like InsecureConfigError this is not a
    ValueError, and its message never carries a URL or password."""


def check_runtime_role(conn: Connection) -> None:
    """Refuse a role that would silently skip row-level security: a superuser, a BYPASSRLS role,
    or the owner of the tables, directly or through role membership (owners bypass RLS unless it
    is forced), or a member of Supabase's `postgres` role."""
    rolsuper, rolbypassrls = conn.execute(
        text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
    ).one()
    owned: int = conn.execute(
        text(
            "SELECT count(*) FROM pg_tables "
            "WHERE schemaname = 'public' AND pg_has_role(current_user, tableowner, 'USAGE')"
        )
    ).scalar_one()
    # CASE evaluates pg_has_role only when the role exists (it errors on an unknown role).
    postgres_member: bool = conn.execute(
        text(
            "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') "
            "THEN pg_has_role(current_user, 'postgres', 'MEMBER') ELSE false END"
        )
    ).scalar_one()
    problems: list[str] = []
    if rolsuper:
        problems.append("is a superuser")
    if rolbypassrls:
        problems.append("has BYPASSRLS")
    if owned:
        problems.append("owns tables in schema public")
    if postgres_member:
        problems.append("is a member of postgres")
    if problems:
        raise UnsafeRuntimeRoleError(
            "DATABASE_URL role must not bypass row-level security, but it " + ", ".join(problems)
        )


def get_session_factory() -> sessionmaker[Session]:
    """FastAPI dependency so tests can swap in a factory bound to the restricted test role."""
    return SessionLocal


def lock_user_for_insert(db: Session, user_id: uuid.UUID) -> None:
    """Serialise one user's count-then-insert so two parallel requests cannot both pass the cap.
    The lock is held until the transaction ends (the commit) and is Postgres-only; the tests and
    the app both run on Postgres."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:user_id))"), {"user_id": str(user_id)})


def lock_and_check_active(db: Session, user_id: uuid.UUID) -> bool:
    """For a background writer: take the user's lock, then say whether the account is still active.
    Call it as the first statement of the write transaction. delete_user_data takes the same lock,
    so a writer either finishes before the delete (which then removes its row) or sees the user
    gone or disabled and writes nothing."""
    # Imported here because models.py imports Base from this module.
    from app.models import AppUser

    lock_user_for_insert(db, user_id)
    status = db.scalar(select(AppUser.status).where(AppUser.id == user_id))
    return status == "active"
