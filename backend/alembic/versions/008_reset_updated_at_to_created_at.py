"""Reset updated_at to created_at for existing projects

This fixes the issue where all projects show "just now" because their
updated_at timestamps were inadvertently set to recent times.

Revision ID: 008
Revises: 007
Create Date: 2026-02-09
"""
from alembic import op

# revision identifiers
revision = '008'
down_revision = '007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Set updated_at to created_at for all existing initiatives
    # This ensures projects show their true age based on when they were created
    op.execute("""
        UPDATE initiatives 
        SET updated_at = created_at
    """)


def downgrade() -> None:
    # No downgrade - we don't want to revert to incorrect timestamps
    pass
