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
from app.db import Base, get_db
from app.main import app

ADMIN_DATABASE_URL = "postgresql+psycopg://trading_agent:trading_agent@localhost:5432/postgres"
TEST_DATABASE_URL = (
    "postgresql+psycopg://trading_agent:trading_agent@localhost:5432/trading_agent_test"
)


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


@pytest.fixture()
def engine() -> Generator[Engine, None, None]:
    test_engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.create_all(bind=test_engine)
    yield test_engine
    Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()


@pytest.fixture()
def session_local(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


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


@pytest.fixture()
def client(engine: Engine) -> Generator[TestClient, None, None]:
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
