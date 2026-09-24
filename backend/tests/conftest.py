import os
import tempfile
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401  registers tables on Base.metadata
import app.redis_client as redis_client_module
from app.db import Base, get_db
from app.main import app


@pytest.fixture()
def engine() -> Generator[Engine, None, None]:
    db_fd, db_path = tempfile.mkstemp(suffix=".db")
    test_engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=test_engine)
    yield test_engine
    test_engine.dispose()
    os.close(db_fd)
    os.remove(db_path)


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
