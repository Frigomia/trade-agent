import os
import tempfile
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

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
