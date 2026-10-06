"""add user_api_keys and app_users.claude_key_state

Revision ID: f4a1c8d27b90
Revises: a7c3e91d5b20
Create Date: 2026-10-06 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app import rls

# revision identifiers, used by Alembic.
revision: str = 'f4a1c8d27b90'
down_revision: Union[str, Sequence[str], None] = 'a7c3e91d5b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "user_api_keys"
# app_users as it is after this revision: the column the app may update now includes the key state.
UPDATABLE = (
    "status, accepted_terms_at, last_seen_at, invited_at, "
    "monthly_analysis_limit, monthly_chat_limit, claude_key_state"
)
PREVIOUS_UPDATABLE = (
    "status, accepted_terms_at, last_seen_at, invited_at, "
    "monthly_analysis_limit, monthly_chat_limit"
)


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("key_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last4", sa.String(length=4), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="ok"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_user_api_keys_user_id"), TABLE, ["user_id"], unique=True)
    op.add_column(
        "app_users",
        sa.Column("claude_key_state", sa.String(length=20), nullable=False, server_default="none"),
    )
    # Same grants and forced owner-only policy as every other user table.
    for statement in rls.grant_table_sql(TABLE):
        op.execute(statement)
    for statement in rls.policy_sql(TABLE):
        op.execute(statement)
    op.execute(f"REVOKE UPDATE ON app_users FROM {rls.RUNTIME_ROLE}")
    op.execute(f"GRANT UPDATE ({UPDATABLE}) ON app_users TO {rls.RUNTIME_ROLE}")


def downgrade() -> None:
    op.execute(f"REVOKE UPDATE ON app_users FROM {rls.RUNTIME_ROLE}")
    op.execute(f"GRANT UPDATE ({PREVIOUS_UPDATABLE}) ON app_users TO {rls.RUNTIME_ROLE}")
    op.drop_column("app_users", "claude_key_state")
    op.execute(f"DROP POLICY IF EXISTS {TABLE}_owner ON {TABLE}")
    op.drop_index(op.f("ix_user_api_keys_user_id"), table_name=TABLE)
    op.drop_table(TABLE)
