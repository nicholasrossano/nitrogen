"""Add Google Drive connection tables

Revision ID: 028
Revises: 027
Create Date: 2026-03-26

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '028'
down_revision = '027'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_google_connections',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', sa.String(255), nullable=False),
        sa.Column('refresh_token', sa.Text(), nullable=False),
        sa.Column('access_token', sa.Text(), nullable=True),
        sa.Column('token_expiry', sa.DateTime(timezone=True), nullable=True),
        sa.Column('google_email', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id'),
    )
    op.create_index('ix_user_google_connections_user_id', 'user_google_connections', ['user_id'])

    op.create_table(
        'drive_linked_files',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('initiative_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('evidence_doc_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('user_id', sa.String(255), nullable=False),
        sa.Column('drive_file_id', sa.String(255), nullable=False),
        sa.Column('drive_file_name', sa.String(500), nullable=False),
        sa.Column('drive_mime_type', sa.String(255), nullable=False),
        sa.Column('drive_modified_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['evidence_doc_id'], ['evidence_docs.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['initiative_id'], ['initiatives.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_drive_linked_files_initiative_id', 'drive_linked_files', ['initiative_id'])
    op.create_index('ix_drive_linked_files_user_id', 'drive_linked_files', ['user_id'])
    op.create_index('ix_drive_linked_files_drive_file_id', 'drive_linked_files', ['drive_file_id'])


def downgrade():
    op.drop_index('ix_drive_linked_files_drive_file_id')
    op.drop_index('ix_drive_linked_files_user_id')
    op.drop_index('ix_drive_linked_files_initiative_id')
    op.drop_table('drive_linked_files')
    op.drop_index('ix_user_google_connections_user_id')
    op.drop_table('user_google_connections')
