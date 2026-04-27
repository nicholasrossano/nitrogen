"""Add stable module instance numbers.

Revision ID: 042
Revises: 041
Create Date: 2026-04-27
"""

from alembic import op
import sqlalchemy as sa


revision = "042"
down_revision = "041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "module_instances",
        sa.Column("instance_number", sa.Integer(), nullable=True),
    )

    op.execute(
        """
        UPDATE module_instances AS mi
        SET instance_number = ranked.instance_number
        FROM (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY initiative_id, module_id
                    ORDER BY started_at ASC, id ASC
                ) AS instance_number
            FROM module_instances
        ) AS ranked
        WHERE mi.id = ranked.id
        """
    )

    op.alter_column("module_instances", "instance_number", nullable=False)
    op.create_index(
        "ix_mi_initiative_module_number",
        "module_instances",
        ["initiative_id", "module_id", "instance_number"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_mi_initiative_module_number", table_name="module_instances")
    op.drop_column("module_instances", "instance_number")
