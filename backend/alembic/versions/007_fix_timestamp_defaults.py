"""Fix timestamp defaults to use timezone-aware UTC timestamps

Revision ID: 007
Revises: 006
Create Date: 2026-02-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TIMESTAMP

# revision identifiers
revision = '007'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Update created_at and updated_at columns to use server-side timestamp defaults
    # This ensures all timestamps are properly timezone-aware and consistent
    
    # Drop existing defaults
    op.alter_column('initiatives', 'created_at',
                    existing_type=TIMESTAMP(timezone=True),
                    server_default=sa.text('CURRENT_TIMESTAMP'),
                    existing_nullable=False)
    
    op.alter_column('initiatives', 'updated_at',
                    existing_type=TIMESTAMP(timezone=True),
                    server_default=sa.text('CURRENT_TIMESTAMP'),
                    existing_nullable=False)
    
    # Update any NULL timestamps (shouldn't exist, but just in case)
    op.execute("""
        UPDATE initiatives 
        SET created_at = CURRENT_TIMESTAMP 
        WHERE created_at IS NULL
    """)
    
    op.execute("""
        UPDATE initiatives 
        SET updated_at = CURRENT_TIMESTAMP 
        WHERE updated_at IS NULL
    """)


def downgrade() -> None:
    # Revert to previous defaults (none)
    op.alter_column('initiatives', 'created_at',
                    existing_type=TIMESTAMP(timezone=True),
                    server_default=None,
                    existing_nullable=False)
    
    op.alter_column('initiatives', 'updated_at',
                    existing_type=TIMESTAMP(timezone=True),
                    server_default=None,
                    existing_nullable=False)
