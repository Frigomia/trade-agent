import importlib.util
from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app import rls
from tests.conftest import ADMIN_DATABASE_URL

BACKEND = Path(__file__).resolve().parent.parent
API_ROLES = ("anon", "authenticated")


def _migration():
    """Load the hand-written migration by file name (its module name is not importable)."""
    path = next((BACKEND / "migrations" / "versions").glob("*_revoke_api_roles_on_public.py"))
    spec = importlib.util.spec_from_file_location("revoke_api_roles", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _can(engine: Engine, role: str, table: str, privilege: str) -> bool:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT has_table_privilege(:role, :table, :priv)"),
            {"role": role, "table": table, "priv": privilege},
        ).scalar_one()


@pytest.fixture()
def api_roles(engine: Engine) -> Generator[None, None, None]:
    """Stand-ins for Supabase's anon/authenticated roles, which exist only on Supabase."""
    admin = create_engine(ADMIN_DATABASE_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        for role in API_ROLES:
            conn.execute(
                text(
                    f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
                    f"THEN CREATE ROLE {role} NOLOGIN; END IF; END $$"
                )
            )
    # What Supabase's default privileges do: new public tables are open to the API roles.
    with engine.begin() as conn:
        conn.execute(text("GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated"))
    yield
    with engine.begin() as conn:
        conn.execute(text("DROP OWNED BY anon, authenticated"))
    with admin.connect() as conn:
        for role in API_ROLES:
            conn.execute(text(f"DROP ROLE IF EXISTS {role}"))
    admin.dispose()


def test_migration_is_in_the_single_chain():
    # Later migrations build on this one, so it is no longer the head; the chain stays linear.
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert len(script.get_heads()) == 1
    assert _migration().revision in {r.revision for r in script.walk_revisions()}


def test_revoke_removes_public_api_access_to_app_tables(engine, api_roles):
    assert _can(engine, "anon", "public.app_users", "UPDATE") is True  # precondition

    with engine.begin() as conn:
        conn.execute(text(_migration().REVOKE_SQL))

    for role in API_ROLES:
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            assert _can(engine, role, "public.app_users", privilege) is False
            assert _can(engine, role, "public.app_settings", privilege) is False


def test_revoke_closes_tables_created_later(engine, api_roles):
    # born_later is not a model table, so the engine fixture's drop_all would leave it behind.
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS public.born_later"))
        conn.execute(text(_migration().REVOKE_SQL))
        conn.execute(text("CREATE TABLE public.born_later (id integer)"))
    try:
        assert _can(engine, "anon", "public.born_later", "SELECT") is False
        assert _can(engine, "authenticated", "public.born_later", "SELECT") is False
    finally:
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE IF EXISTS public.born_later"))


def test_revoke_leaves_the_runtime_role_alone(engine, api_roles):
    with engine.begin() as conn:
        conn.execute(text(_migration().REVOKE_SQL))
    assert _can(engine, rls.RUNTIME_ROLE, "public.holdings", "SELECT") is True


def test_revoke_is_a_no_op_when_the_roles_do_not_exist(engine):
    with engine.begin() as conn:
        conn.execute(text(_migration().REVOKE_SQL))  # must not raise
