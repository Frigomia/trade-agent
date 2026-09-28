"""add invited_at to app_users

Revision ID: bbd35edc6948
Revises: dd035aae788b
Create Date: 2026-09-28 17:59:47.949914

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bbd35edc6948'
down_revision: Union[str, Sequence[str], None] = 'dd035aae788b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('app_users', sa.Column('invited_at', sa.DateTime(), nullable=True))
    # Narrow the runtime role: no UPDATE on id, email, or role.
    op.execute("REVOKE UPDATE ON app_users FROM trading_agent_app")
    op.execute(
        "GRANT UPDATE (status, accepted_terms_at, last_seen_at, invited_at) "
        "ON app_users TO trading_agent_app"
    )


def downgrade() -> None:
    op.execute(
        "REVOKE UPDATE (status, accepted_terms_at, last_seen_at, invited_at) "
        "ON app_users FROM trading_agent_app"
    )
    op.execute("GRANT UPDATE ON app_users TO trading_agent_app")
    op.drop_column('app_users', 'invited_at')
