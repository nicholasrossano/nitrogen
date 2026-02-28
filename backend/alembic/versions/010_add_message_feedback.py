"""Add feedback field to chat_messages for like/dislike tracking

Revision ID: 010
Revises: 009
Create Date: 2026-02-28
"""
from alembic import op
import sqlalchemy as sa

revision = '010'
down_revision = '009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'chat_messages',
        sa.Column('feedback', sa.String(20), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('chat_messages', 'feedback')
