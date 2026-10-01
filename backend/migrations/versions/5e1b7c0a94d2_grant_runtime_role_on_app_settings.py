"""grant the runtime role access to app_settings

Revision ID: 5e1b7c0a94d2
Revises: 23aa94f7d34e
Create Date: 2026-10-01 09:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '5e1b7c0a94d2'
down_revision: Union[str, Sequence[str], None] = '23aa94f7d34e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# app_settings holds the one row of admin-set defaults. Like app_users it has no user_id and no
# RLS policy, so the runtime role gets plain table access (it never needs DELETE for this row).
RUNTIME_ROLE = "trading_agent_app"


def upgrade() -> None:
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON app_settings TO {RUNTIME_ROLE}")


def downgrade() -> None:
    op.execute(f"REVOKE SELECT, INSERT, UPDATE ON app_settings FROM {RUNTIME_ROLE}")
