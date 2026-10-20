import importlib.util
from datetime import date
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from tests.auth_support import USER_ID


def test_migration_preserves_existing_purchase_details_and_allows_unknown(engine):
    path = next(
        (Path(__file__).resolve().parent.parent / "migrations" / "versions").glob(
            "*_allow_unknown_holding_purchase_details.py"
        )
    )
    spec = importlib.util.spec_from_file_location("nullable_purchase", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        module.downgrade()
        conn.execute(
            text(
                "INSERT INTO holdings "
                "(user_id,ticker,name,asset_type,shares,cost_basis,first_purchase_date) "
                "VALUES (:uid,'MSFT','Microsoft','STOCK',2,100,'2024-01-01')"
            ),
            {"uid": USER_ID},
        )
        module.upgrade()
        row = conn.execute(text("SELECT shares,cost_basis,first_purchase_date FROM holdings")).one()
        assert row == (2, 100, date(2024, 1, 1))
        conn.execute(text("UPDATE holdings SET cost_basis=NULL,first_purchase_date=NULL"))
        assert conn.execute(text("SELECT cost_basis,first_purchase_date FROM holdings")).one() == (
            None,
            None,
        )
