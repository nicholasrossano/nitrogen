"""Add content_html and page_number to evidence_chunks and corpus_chunks

Revision ID: 025
Revises: 024
Create Date: 2026-03-13

"""
from alembic import op
import sqlalchemy as sa

revision = '025'
down_revision = '024'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('evidence_chunks', sa.Column('content_html', sa.Text(), nullable=True))
    op.add_column('evidence_chunks', sa.Column('page_number', sa.Integer(), nullable=True))
    op.add_column('corpus_chunks', sa.Column('content_html', sa.Text(), nullable=True))
    op.add_column('corpus_chunks', sa.Column('page_number', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('corpus_chunks', 'page_number')
    op.drop_column('corpus_chunks', 'content_html')
    op.drop_column('evidence_chunks', 'page_number')
    op.drop_column('evidence_chunks', 'content_html')
