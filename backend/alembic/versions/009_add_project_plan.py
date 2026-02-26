"""Add project_plan JSONB column to initiatives

Revision ID: 009
Revises: 008
Create Date: 2026-02-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('initiatives', sa.Column('project_plan', JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column('initiatives', 'project_plan')
