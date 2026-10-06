"""add investment_preferences.auto_analysis and recommendations.source

Revision ID: b3d9e5a17c42
Revises: f4a1c8d27b90
Create Date: 2026-10-06 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b3d9e5a17c42'
down_revision: Union[str, Sequence[str], None] = 'f4a1c8d27b90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing rows get the defaults, so nothing changes for anyone until they opt in.
    op.add_column(
        "investment_preferences",
        sa.Column("auto_analysis", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "recommendations",
        sa.Column("source", sa.String(length=10), nullable=False, server_default="manual"),
    )


def downgrade() -> None:
    op.drop_column("recommendations", "source")
    op.drop_column("investment_preferences", "auto_analysis")
