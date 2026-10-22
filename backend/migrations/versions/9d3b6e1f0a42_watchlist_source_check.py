"""watchlist source check

Autogenerate does not detect CHECK constraints, so the rule on the previous revision's `source`
column (added by the person, or saved from Today) is added by hand.

Revision ID: 9d3b6e1f0a42
Revises: 329ccb888eec
Create Date: 2026-10-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '9d3b6e1f0a42'
down_revision: Union[str, Sequence[str], None] = '329ccb888eec'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_check_constraint(
        'ck_watchlist_items_source',
        'watchlist_items',
        "source IN ('manual', 'today')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_watchlist_items_source', 'watchlist_items', type_='check')
