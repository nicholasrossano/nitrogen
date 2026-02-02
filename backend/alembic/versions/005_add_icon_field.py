"""add icon field

Revision ID: 005
Revises: 004
Create Date: 2026-02-02

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add icon field to initiatives table
    op.add_column('initiatives', sa.Column('icon', sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column('initiatives', 'icon')
