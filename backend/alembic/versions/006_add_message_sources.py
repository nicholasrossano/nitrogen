"""Add sources field to chat_messages for citation tracking

Revision ID: 006
Revises: 005
Create Date: 2026-02-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add sources column to chat_messages for tracking citations
    op.add_column(
        'chat_messages',
        sa.Column('sources', JSONB, nullable=True)
    )


def downgrade() -> None:
    op.drop_column('chat_messages', 'sources')
