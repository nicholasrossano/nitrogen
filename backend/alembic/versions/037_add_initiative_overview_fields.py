"""Add initiative overview fields

Revision ID: 037
Revises: 036
Create Date: 2026-04-15

"""

from alembic import op
import sqlalchemy as sa


revision = "037"
down_revision = "036"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("initiatives", sa.Column("overview_description", sa.Text(), nullable=True))
    op.add_column("initiatives", sa.Column("overview_generated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("initiatives", "overview_generated_at")
    op.drop_column("initiatives", "overview_description")
