"""add the contribution planner: targets on the watchlist, planner settings, plan tables

Revision ID: d5f3a9b72e18
Revises: c8e2f6a41d37
Create Date: 2026-10-08 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app import rls

# revision identifiers, used by Alembic.
revision: str = 'd5f3a9b72e18'
down_revision: Union[str, Sequence[str], None] = 'c8e2f6a41d37'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PLANS = "contribution_plans"
LINES = "contribution_plan_lines"


def upgrade() -> None:
    op.add_column(
        "watchlist_items",
        sa.Column("target_weight", sa.Numeric(5, 4), nullable=True),
    )
    op.create_check_constraint(
        "ck_watchlist_target_weight", "watchlist_items", "target_weight >= 0 AND target_weight <= 1"
    )
    op.add_column(
        "investment_preferences",
        sa.Column("monthly_contribution", sa.Numeric(12, 2), nullable=True),
    )
    op.add_column(
        "investment_preferences",
        sa.Column("drift_threshold_pct", sa.Numeric(4, 1), nullable=False, server_default="5.0"),
    )
    op.create_check_constraint(
        "ck_preferences_drift_threshold",
        "investment_preferences",
        "drift_threshold_pct >= 1 AND drift_threshold_pct <= 50",
    )
    op.add_column(
        "telegram_links",
        sa.Column("plan_reminder_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    op.create_table(
        PLANS,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("amount_eur", sa.Numeric(12, 2), nullable=False),
        sa.Column("whole_shares", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("total_before_eur", sa.Numeric(16, 2), nullable=False),
        sa.Column("leftover_eur", sa.Numeric(12, 2), nullable=False),
        sa.Column("notes", sa.JSON(), nullable=False),
    )
    op.create_index(op.f("ix_contribution_plans_user_id"), PLANS, ["user_id"])
    op.create_table(
        LINES,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("plan_id", sa.Integer(), nullable=False),
        sa.Column("ticker", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("amount_eur", sa.Numeric(12, 2), nullable=False),
        sa.Column("shares", sa.Numeric(18, 6), nullable=False),
        sa.Column("price_eur", sa.Numeric(18, 6), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("rate", sa.Numeric(18, 8), nullable=False),
        sa.Column("weight_before", sa.Numeric(7, 6), nullable=True),
        sa.Column("weight_after", sa.Numeric(7, 6), nullable=True),
        sa.Column("reason", sa.String(length=20), nullable=False),
    )
    op.create_index(op.f("ix_contribution_plan_lines_user_id"), LINES, ["user_id"])
    op.create_index(op.f("ix_contribution_plan_lines_plan_id"), LINES, ["plan_id"])
    # No foreign key (like every other user table): the delete route and data deletion remove the
    # lines explicitly.
    for table in (PLANS, LINES):
        for statement in rls.grant_table_sql(table):
            op.execute(statement)
        for statement in rls.policy_sql(table):
            op.execute(statement)


def downgrade() -> None:
    for table in (LINES, PLANS):
        op.execute(f"DROP POLICY IF EXISTS {table}_owner ON {table}")
    op.drop_table(LINES)
    op.drop_table(PLANS)
    op.drop_column("telegram_links", "plan_reminder_enabled")
    op.drop_constraint("ck_preferences_drift_threshold", "investment_preferences", type_="check")
    op.drop_column("investment_preferences", "drift_threshold_pct")
    op.drop_column("investment_preferences", "monthly_contribution")
    op.drop_constraint("ck_watchlist_target_weight", "watchlist_items", type_="check")
    op.drop_column("watchlist_items", "target_weight")
