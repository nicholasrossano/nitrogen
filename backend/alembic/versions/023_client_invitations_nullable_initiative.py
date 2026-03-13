"""Make client_invitations.initiative_id nullable and add project_title

Revision ID: 023
Revises: 022
Create Date: 2026-03-12

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '023'
down_revision = '022'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the NOT NULL constraint and FK (recreate FK as nullable)
    op.drop_constraint('client_invitations_initiative_id_fkey', 'client_invitations', type_='foreignkey')
    op.alter_column('client_invitations', 'initiative_id', nullable=True)
    op.create_foreign_key(
        'client_invitations_initiative_id_fkey',
        'client_invitations', 'initiatives',
        ['initiative_id'], ['id'],
        ondelete='SET NULL',
    )
    # Add project_title column for deferred project creation
    op.add_column('client_invitations', sa.Column('project_title', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('client_invitations', 'project_title')
    op.drop_constraint('client_invitations_initiative_id_fkey', 'client_invitations', type_='foreignkey')
    op.alter_column('client_invitations', 'initiative_id', nullable=False)
    op.create_foreign_key(
        'client_invitations_initiative_id_fkey',
        'client_invitations', 'initiatives',
        ['initiative_id'], ['id'],
        ondelete='CASCADE',
    )
