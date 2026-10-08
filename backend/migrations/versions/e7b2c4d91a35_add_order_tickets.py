"""add isin to holdings and watchlist items, placed markers to plan lines

Revision ID: e7b2c4d91a35
Revises: d5f3a9b72e18
Create Date: 2026-10-09 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e7b2c4d91a35'
down_revision: Union[str, Sequence[str], None] = 'd5f3a9b72e18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ISIN_CHECK = "isin IS NULL OR isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'"


def upgrade() -> None:
    for table in ("holdings", "watchlist_items"):
        op.add_column(table, sa.Column("isin", sa.String(length=12), nullable=True))
        op.create_check_constraint(f"ck_{table}_isin", table, ISIN_CHECK)
    op.add_column("contribution_plan_lines", sa.Column("placed_at", sa.DateTime(), nullable=True))
    op.add_column("contribution_plan_lines", sa.Column("placed_trade_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("contribution_plan_lines", "placed_trade_id")
    op.drop_column("contribution_plan_lines", "placed_at")
    for table in ("watchlist_items", "holdings"):
        op.drop_constraint(f"ck_{table}_isin", table, type_="check")
        op.drop_column(table, "isin")
