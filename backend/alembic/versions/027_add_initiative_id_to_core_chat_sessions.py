"""Add initiative_id to core_chat_sessions for project-scoped chat isolation

Revision ID: 027
Revises: 026
Create Date: 2026-03-15

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '027'
down_revision = '026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'core_chat_sessions',
        sa.Column('initiative_id', UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        'ix_core_chat_sessions_initiative_id',
        'core_chat_sessions',
        ['initiative_id'],
    )
    op.create_foreign_key(
        'fk_core_chat_sessions_initiative_id',
        'core_chat_sessions',
        'initiatives',
        ['initiative_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade():
    op.drop_constraint('fk_core_chat_sessions_initiative_id', 'core_chat_sessions', type_='foreignkey')
    op.drop_index('ix_core_chat_sessions_initiative_id', table_name='core_chat_sessions')
    op.drop_column('core_chat_sessions', 'initiative_id')
