"""Add archived field to initiatives

Revision ID: 004
Revises: 003
Create Date: 2026-01-30

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add archived column to initiatives table with default False
    op.add_column(
        'initiatives',
        sa.Column('archived', sa.Boolean(), nullable=False, server_default='false')
    )
    # Add index for efficient filtering
    op.create_index(
        'ix_initiatives_archived',
        'initiatives',
        ['archived']
    )


def downgrade() -> None:
    # Remove index and column
    op.drop_index('ix_initiatives_archived', 'initiatives')
    op.drop_column('initiatives', 'archived')
