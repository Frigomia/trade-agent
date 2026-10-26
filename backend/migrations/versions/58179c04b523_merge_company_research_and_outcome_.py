"""merge company research and outcome tracking

Revision ID: 58179c04b523
Revises: ee25b99dc928, 1bf06b3900a4
Create Date: 2026-10-26 14:55:04.347829

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '58179c04b523'
down_revision: Union[str, Sequence[str], None] = ('ee25b99dc928', '1bf06b3900a4')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
