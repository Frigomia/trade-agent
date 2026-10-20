import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from tests.auth_support import USER_ID


def test_existing_analysis_consent_does_not_enable_discovery_on_migration(engine):
    path = next(
        (Path(__file__).resolve().parent.parent / "migrations" / "versions").glob(
            "*_add_auto_discovery_opt_in.py"
        )
    )
    spec = importlib.util.spec_from_file_location("discovery_consent_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        module.downgrade()
        conn.execute(
            text(
                "INSERT INTO investment_preferences (user_id, sector_avoid_list, auto_analysis) "
                "VALUES (:user_id, '[]', true)"
            ),
            {"user_id": USER_ID},
        )
        module.upgrade()
        assert conn.execute(
            text(
                "SELECT auto_analysis, auto_discovery FROM investment_preferences "
                "WHERE user_id = :user_id"
            ),
            {"user_id": USER_ID},
        ).one() == (True, False)
