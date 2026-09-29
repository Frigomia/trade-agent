"""add monthly limits to app_users

Revision ID: 73809764e6a1
Revises: bbd35edc6948
Create Date: 2026-09-29 11:03:50.142191

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '73809764e6a1'
down_revision: Union[str, Sequence[str], None] = 'bbd35edc6948'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('app_users', sa.Column('monthly_analysis_limit', sa.Integer(), nullable=True))
    op.add_column('app_users', sa.Column('monthly_chat_limit', sa.Integer(), nullable=True))
    op.execute("REVOKE UPDATE ON app_users FROM trading_agent_app")
    op.execute(
        "GRANT UPDATE (status, accepted_terms_at, last_seen_at, invited_at, "
        "monthly_analysis_limit, monthly_chat_limit) ON app_users TO trading_agent_app"
    )


def downgrade() -> None:
    op.execute(
        "REVOKE UPDATE (status, accepted_terms_at, last_seen_at, invited_at, "
        "monthly_analysis_limit, monthly_chat_limit) ON app_users FROM trading_agent_app"
    )
    op.execute(
        "GRANT UPDATE (status, accepted_terms_at, last_seen_at, invited_at) "
        "ON app_users TO trading_agent_app"
    )
    op.drop_column('app_users', 'monthly_chat_limit')
    op.drop_column('app_users', 'monthly_analysis_limit')
