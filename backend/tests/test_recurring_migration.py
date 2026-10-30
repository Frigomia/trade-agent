import importlib.util
from io import StringIO
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.rls import grant_table_sql, policy_sql


def test_generated_migration_creates_tables_with_rls_and_grants_together():
    path = next(
        (Path(__file__).resolve().parents[1] / "migrations/versions").glob(
            "*_add_recurring_investments.py"
        )
    )
    spec = importlib.util.spec_from_file_location("recurring_migration", path)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}
    )
    with Operations.context(context):
        migration.upgrade()
    sql = output.getvalue()
    for table in ("recurring_investments", "recurring_occurrences"):
        assert f"CREATE TABLE {table}" in sql
        for statement in policy_sql(table) + grant_table_sql(table):
            assert statement in sql
    assert "CONSTRAINT uq_recurring_date UNIQUE (user_id, plan_id, scheduled_date)" in sql
    assert "CONSTRAINT uq_recurring_trade UNIQUE (trade_id)" in sql
    assert "ck_occurrence_confirmation" in sql
    output.seek(0)
    output.truncate()
    with Operations.context(context):
        migration.downgrade()
    assert "DROP TABLE recurring_occurrences" in output.getvalue()
    assert "DROP TABLE recurring_investments" in output.getvalue()
