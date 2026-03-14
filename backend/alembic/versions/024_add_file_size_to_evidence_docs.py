"""Add file_size to evidence_docs

Revision ID: 024
Revises: 023
Create Date: 2026-03-13

"""
from alembic import op
import sqlalchemy as sa

revision = '024'
down_revision = '023'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('evidence_docs', sa.Column('file_size', sa.BigInteger(), nullable=True))


def downgrade():
    op.drop_column('evidence_docs', 'file_size')
