"""Add composite index on usage_records(user_id, created_at)

Revision ID: 031
Revises: 030
Create Date: 2026-03-30

"""
from alembic import op

revision = '031'
down_revision = '030'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_usage_records_user_id_created_at",
        "usage_records",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_usage_records_user_id_created_at", table_name="usage_records")
