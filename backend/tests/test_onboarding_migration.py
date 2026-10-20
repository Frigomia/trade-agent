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


def test_snapshot_coverage_migration_preserves_legacy_totals(engine):
    path = next(
        (Path(__file__).resolve().parent.parent / "migrations" / "versions").glob(
            "*_record_snapshot_cost_basis_coverage.py"
        )
    )
    spec = importlib.util.spec_from_file_location("snapshot_coverage", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        module.downgrade()
        conn.execute(
            text(
                "INSERT INTO portfolio_snapshots (user_id,total_market_value,total_cost_basis) "
                "VALUES (:uid,1000,800)"
            ),
            {"uid": USER_ID},
        )
        module.upgrade()
        row = conn.execute(
            text(
                "SELECT total_market_value,total_cost_basis,cost_basis_complete "
                "FROM portfolio_snapshots"
            )
        ).one()
        assert row == (1000, 800, True)
        conn.execute(text("UPDATE portfolio_snapshots SET cost_basis_complete=false"))
        assert (
            conn.execute(text("SELECT cost_basis_complete FROM portfolio_snapshots")).scalar_one()
            is False
        )
