import asyncio
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.main as main
from app.config import Settings
from app.db import UnsafeRuntimeRoleError


def test_settings_normalise_app_env():
    assert Settings(_env_file=None, app_env=" Development ").app_env == "development"


def test_docs_are_served_in_development():
    api = FastAPI(**main.docs_kwargs("development"))
    with TestClient(api) as test_client:
        assert test_client.get("/docs").status_code == 200
        assert test_client.get("/openapi.json").status_code == 200


def test_docs_are_not_served_in_production():
    api = FastAPI(**main.docs_kwargs("production"))
    with TestClient(api) as test_client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert test_client.get(path).status_code == 404


def _run_lifespan() -> None:
    async def _go() -> None:
        async with main.lifespan(main.app):
            pass

    asyncio.run(_go())


def test_startup_skips_the_role_check_outside_production(monkeypatch):
    check = MagicMock()
    monkeypatch.setattr(main, "check_runtime_role", check)
    _run_lifespan()
    check.assert_not_called()


def test_startup_runs_the_role_check_in_production(monkeypatch):
    check = MagicMock()
    monkeypatch.setattr(main, "check_runtime_role", check)
    monkeypatch.setattr(main, "check_master_secret", MagicMock())
    monkeypatch.setattr(main.settings, "app_env", "production")
    monkeypatch.setattr(main, "engine", MagicMock())
    _run_lifespan()
    check.assert_called_once()


def test_startup_refuses_an_unsafe_role_in_production(monkeypatch):
    monkeypatch.setattr(main, "check_runtime_role", MagicMock(side_effect=UnsafeRuntimeRoleError))
    monkeypatch.setattr(main.settings, "app_env", "production")
    monkeypatch.setattr(main, "engine", MagicMock())
    with pytest.raises(UnsafeRuntimeRoleError):
        _run_lifespan()


def test_startup_checks_the_key_secret_in_production(monkeypatch):
    check = MagicMock()
    monkeypatch.setattr(main, "check_runtime_role", MagicMock())
    monkeypatch.setattr(main, "check_master_secret", check)
    monkeypatch.setattr(main.settings, "app_env", "production")
    monkeypatch.setattr(main, "engine", MagicMock())
    _run_lifespan()
    check.assert_called_once()


def test_startup_refuses_without_the_key_secret_in_production(monkeypatch):
    monkeypatch.setattr(main, "check_runtime_role", MagicMock())
    monkeypatch.setattr(
        main, "check_master_secret", MagicMock(side_effect=main.KeyEncryptionError("x"))
    )
    monkeypatch.setattr(main.settings, "app_env", "production")
    monkeypatch.setattr(main, "engine", MagicMock())
    with pytest.raises(main.KeyEncryptionError):
        _run_lifespan()


def test_startup_skips_the_key_secret_check_outside_production(monkeypatch):
    check = MagicMock()
    monkeypatch.setattr(main, "check_master_secret", check)
    _run_lifespan()
    check.assert_not_called()
