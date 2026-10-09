"""add the plan-time target to plan lines and the structured left-out list to plans

Revision ID: b8d4f2a61c93
Revises: e7b2c4d91a35
Create Date: 2026-10-09 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b8d4f2a61c93'
down_revision: Union[str, Sequence[str], None] = 'e7b2c4d91a35'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TARGET_CHECK = "target_weight IS NULL OR (target_weight >= 0 AND target_weight <= 1)"


def upgrade() -> None:
    op.add_column("contribution_plan_lines", sa.Column("target_weight", sa.Numeric(7, 6), nullable=True))
    op.create_check_constraint("ck_plan_lines_target_weight", "contribution_plan_lines", TARGET_CHECK)
    op.add_column("contribution_plans", sa.Column("left_out", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("contribution_plans", "left_out")
    op.drop_constraint("ck_plan_lines_target_weight", "contribution_plan_lines", type_="check")
    op.drop_column("contribution_plan_lines", "target_weight")
