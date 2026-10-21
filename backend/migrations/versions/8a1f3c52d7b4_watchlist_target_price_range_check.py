"""watchlist target price range check

Autogenerate does not detect CHECK constraints, so the range rule from the previous revision
(both ends or neither, positive, low not above high) is added by hand.

Revision ID: 8a1f3c52d7b4
Revises: 7183ae618ba2
Create Date: 2026-10-21 20:15:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '8a1f3c52d7b4'
down_revision: Union[str, Sequence[str], None] = '7183ae618ba2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_check_constraint(
        'ck_watchlist_items_target_price_range',
        'watchlist_items',
        '(target_price_low IS NULL AND target_price_high IS NULL) OR '
        '(target_price_low IS NOT NULL AND target_price_high IS NOT NULL AND '
        'target_price_low > 0 AND target_price_high >= target_price_low)',
    )


def downgrade() -> None:
    op.drop_constraint('ck_watchlist_items_target_price_range', 'watchlist_items', type_='check')
