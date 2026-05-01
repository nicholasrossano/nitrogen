"""Add stable assessment instance numbers.

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
        "assessment_instances",
        sa.Column("instance_number", sa.Integer(), nullable=True),
    )

    op.execute(
        """
        UPDATE assessment_instances AS mi
        SET instance_number = ranked.instance_number
        FROM (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY initiative_id, assessment_id
                    ORDER BY started_at ASC, id ASC
                ) AS instance_number
            FROM assessment_instances
        ) AS ranked
        WHERE mi.id = ranked.id
        """
    )

    op.alter_column("assessment_instances", "instance_number", nullable=False)
    op.create_index(
        "ix_mi_initiative_assessment_number",
        "assessment_instances",
        ["initiative_id", "assessment_id", "instance_number"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_mi_initiative_assessment_number", table_name="assessment_instances")
    op.drop_column("assessment_instances", "instance_number")
