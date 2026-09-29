"""enable rls and runtime role

Revision ID: dd035aae788b
Revises: c2b68fa02daa
Create Date: 2026-09-28 11:29:13.083516

"""
from typing import Sequence, Union

from alembic import op

from app import rls


# revision identifiers, used by Alembic.
revision: str = 'dd035aae788b'
down_revision: Union[str, Sequence[str], None] = 'c2b68fa02daa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


USER_TABLES = (
    "holdings",
    "watchlist_items",
    "trades",
    "recommendations",
    "chat_messages",
    "backtest_results",
    "investment_preferences",
    "portfolio_snapshots",
)


def upgrade() -> None:
    op.execute(rls.create_role_sql())
    op.execute(rls.grant_schema_sql())
    for table in USER_TABLES:
        for statement in rls.grant_table_sql(table):
            op.execute(statement)
    # Only this one grant is written out literally: it is app_users as it was at this revision
    # (narrowed by a later migration). The user-table grants and policies still call the current
    # rls.py builders.
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON app_users TO {rls.RUNTIME_ROLE}")
    for table in USER_TABLES:
        for statement in rls.policy_sql(table):
            op.execute(statement)


def downgrade() -> None:
    for table in reversed(USER_TABLES):
        op.execute(f"DROP POLICY IF EXISTS {table}_owner ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    # Revoke what upgrade() granted: with RLS off, leftover grants would let the runtime role
    # read every user's rows. The role itself stays: dropping a role that still owns grants or
    # has connections fails, and a NOLOGIN role with no privileges is harmless.
    for table in (*USER_TABLES, "app_users"):
        op.execute(f"REVOKE ALL ON {table} FROM {rls.RUNTIME_ROLE}")
    for table in USER_TABLES:
        op.execute(f"REVOKE ALL ON SEQUENCE {table}_id_seq FROM {rls.RUNTIME_ROLE}")
    op.execute(f"REVOKE USAGE ON SCHEMA public FROM {rls.RUNTIME_ROLE}")
