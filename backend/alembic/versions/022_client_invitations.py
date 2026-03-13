"""Add client_invitations table

Revision ID: 022
Revises: 021
Create Date: 2026-03-12

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '022'
down_revision = '021'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'client_invitations',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('initiative_id', UUID(as_uuid=True), sa.ForeignKey('initiatives.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('token', sa.String(255), unique=True, nullable=False, index=True),
        sa.Column('client_email', sa.String(255), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('invited_by', sa.String(255), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('accepted_by', sa.String(255), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('client_invitations')
