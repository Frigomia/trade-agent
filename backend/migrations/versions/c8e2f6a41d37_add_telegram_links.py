"""add telegram_links

Revision ID: c8e2f6a41d37
Revises: b3d9e5a17c42
Create Date: 2026-10-06 20:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app import rls

# revision identifiers, used by Alembic.
revision: str = 'c8e2f6a41d37'
down_revision: Union[str, Sequence[str], None] = 'b3d9e5a17c42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "telegram_links"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="ok"),
        sa.Column("digest_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("moves_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "move_threshold_pct", sa.Numeric(4, 1), nullable=False, server_default="5.0"
        ),
        sa.Column("linked_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("move_threshold_pct >= 1 AND move_threshold_pct <= 50"),
        sa.CheckConstraint("status IN ('ok', 'blocked')"),
    )
    op.create_index(op.f("ix_telegram_links_user_id"), TABLE, ["user_id"], unique=True)
    # One chat belongs to at most one account, enforced across all users (RLS does not hide rows
    # from a unique index).
    op.create_index(op.f("ix_telegram_links_chat_id"), TABLE, ["chat_id"], unique=True)
    # Same grants and forced owner-only policy as every other user table.
    for statement in rls.grant_table_sql(TABLE):
        op.execute(statement)
    for statement in rls.policy_sql(TABLE):
        op.execute(statement)


def downgrade() -> None:
    op.execute(f"DROP POLICY IF EXISTS {TABLE}_owner ON {TABLE}")
    op.drop_index(op.f("ix_telegram_links_chat_id"), table_name=TABLE)
    op.drop_index(op.f("ix_telegram_links_user_id"), table_name=TABLE)
    op.drop_table(TABLE)
