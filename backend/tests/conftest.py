import asyncio
import contextlib
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401  registers tables on Base.metadata
import app.redis_client as redis_client_module
from app import rls
from app.auth.tokens import get_key_resolver
from app.config import settings
from app.db import Base, get_session_factory
from app.main import app
from app.models import AppUser
from tests.auth_support import TEST_SUPABASE_URL, USER_ID, auth_headers, resolve_test_key

ADMIN_DATABASE_URL = "postgresql+psycopg://trading_agent:trading_agent@localhost:5432/postgres"
TEST_DATABASE_URL = (
    "postgresql+psycopg://trading_agent:trading_agent@localhost:5432/trading_agent_test"
)
APP_TEST_DATABASE_URL = (
    "postgresql+psycopg://trading_agent_app:trading_agent_app@localhost:5432/trading_agent_test"
)


@pytest.fixture(autouse=True)
def _configure_supabase_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "supabase_url", TEST_SUPABASE_URL)


@pytest.fixture(scope="session", autouse=True)
def _ensure_test_database() -> None:
    admin_engine = create_engine(ADMIN_DATABASE_URL, isolation_level="AUTOCOMMIT")
    with (
        admin_engine.connect() as conn,
        contextlib.suppress(ProgrammingError),  # already exists from a previous run
    ):
        conn.execute(text("CREATE DATABASE trading_agent_test"))
    admin_engine.dispose()

    test_engine = create_engine(TEST_DATABASE_URL, isolation_level="AUTOCOMMIT")
    with test_engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    test_engine.dispose()

    # The restricted runtime role is cluster-wide. Give it a login for the local test Docker
    # Postgres only: the migration creates it NOLOGIN so no password is ever committed.
    role_engine = create_engine(ADMIN_DATABASE_URL, isolation_level="AUTOCOMMIT")
    with role_engine.connect() as conn:
        conn.execute(text(rls.create_role_sql()))
        conn.execute(text(f"ALTER ROLE {rls.RUNTIME_ROLE} LOGIN PASSWORD 'trading_agent_app'"))
    role_engine.dispose()


@pytest.fixture()
def engine() -> Generator[Engine, None, None]:
    test_engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.create_all(bind=test_engine)
    with test_engine.begin() as conn:
        for statement in rls.apply_sql():
            conn.execute(text(statement))
    yield test_engine
    Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()


@pytest.fixture()
def app_engine(engine: Engine) -> Generator[Engine, None, None]:
    """Engine connected as the restricted runtime role, so RLS is actually enforced."""
    restricted_engine = create_engine(APP_TEST_DATABASE_URL)
    yield restricted_engine
    restricted_engine.dispose()


@pytest.fixture()
def app_session_local(app_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(autocommit=False, autoflush=False, bind=app_engine)


@pytest.fixture()
def session_local(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def _flush_rate_limit_keys() -> None:
    # Starlette's TestClient reports a fixed fake client IP ("testclient") for
    # every request, so every test hitting a rate-limited route shares the same
    # Redis key. Flush before each test so leftover counts from a previous test
    # don't cause a spurious 429. Uses its own throwaway event loop and resets
    # the client singleton afterward, same reason as _reset_redis_client below.
    async def _flush() -> None:
        redis = redis_client_module.get_redis()
        async for key in redis.scan_iter("ratelimit:*"):
            await redis.delete(key)

    asyncio.run(_flush())
    redis_client_module._redis = None


@pytest.fixture(autouse=True)
def _reset_redis_client() -> Generator[None, None, None]:
    # Each test that hits real Redis via asyncio.run() gets its own event loop;
    # the cached client in app.redis_client is bound to whichever loop created it,
    # so reusing it across tests raises "Event loop is closed" on Windows.
    # Reset the singleton after every test so the next one builds a fresh client.
    yield
    redis_client_module._redis = None


@pytest.fixture()
def db_session(engine: Engine) -> Generator[Session, None, None]:
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = testing_session_local()
    try:
        yield session
    finally:
        session.close()


def _install_overrides(app_engine: Engine) -> None:
    """Route the app to the test database: the restricted-role engine for authenticated
    sessions, and the test JWT key."""
    app_factory = sessionmaker(autocommit=False, autoflush=False, bind=app_engine)
    app.dependency_overrides[get_session_factory] = lambda: app_factory
    app.dependency_overrides[get_key_resolver] = lambda: resolve_test_key


@pytest.fixture()
def client(engine: Engine, app_engine: Engine) -> Generator[TestClient, None, None]:
    """Authenticated as USER_ID (an active AppUser), served through the restricted DB role."""
    with sessionmaker(bind=engine)() as setup:
        setup.add(AppUser(id=USER_ID, email="user@example.com", role="user", status="active"))
        setup.commit()
    _install_overrides(app_engine)
    with TestClient(app, headers=auth_headers(USER_ID)) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def anon_client(engine: Engine, app_engine: Engine) -> Generator[TestClient, None, None]:
    """Same wiring as `client`, but sends no Authorization header."""
    _install_overrides(app_engine)
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
