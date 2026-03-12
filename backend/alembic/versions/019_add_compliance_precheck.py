"""Add compliance_precheck JSONB column to initiatives

Revision ID: 019
Revises: 018
Create Date: 2026-03-12

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '019'
down_revision = '018'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('initiatives', sa.Column('compliance_precheck', JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column('initiatives', 'compliance_precheck')
