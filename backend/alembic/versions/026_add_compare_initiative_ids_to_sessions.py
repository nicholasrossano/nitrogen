"""Add compare_initiative_ids to core_chat_sessions

Revision ID: 026
Revises: 025
Create Date: 2026-03-13

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '026'
down_revision = '025'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('core_chat_sessions', sa.Column('compare_initiative_ids', JSONB, nullable=True))


def downgrade():
    op.drop_column('core_chat_sessions', 'compare_initiative_ids')
