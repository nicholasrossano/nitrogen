"""Add tool workflow fields

Revision ID: 002
Revises: 001
Create Date: 2026-01-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns for tool-based workflow
    op.add_column('initiatives', sa.Column('project_description', sa.Text(), nullable=True))
    op.add_column('initiatives', sa.Column('project_type', sa.String(100), nullable=True))
    op.add_column('initiatives', sa.Column('selected_tools', postgresql.ARRAY(sa.Text()), nullable=True))
    op.add_column('initiatives', sa.Column('tool_inputs', postgresql.JSONB(), nullable=True))
    op.add_column('initiatives', sa.Column('deliverables', postgresql.JSONB(), nullable=True))
    
    # Update default stage value for new initiatives
    # Existing initiatives keep their stage, new ones start with 'describe'


def downgrade() -> None:
    op.drop_column('initiatives', 'deliverables')
    op.drop_column('initiatives', 'tool_inputs')
    op.drop_column('initiatives', 'selected_tools')
    op.drop_column('initiatives', 'project_type')
    op.drop_column('initiatives', 'project_description')
