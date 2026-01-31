"""Add tool_alignments field to initiatives

Revision ID: 003
Revises: 002
Create Date: 2026-01-30

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add tool_alignments column to initiatives table
    op.add_column(
        'initiatives',
        sa.Column('tool_alignments', postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )


def downgrade() -> None:
    # Remove tool_alignments column
    op.drop_column('initiatives', 'tool_alignments')
