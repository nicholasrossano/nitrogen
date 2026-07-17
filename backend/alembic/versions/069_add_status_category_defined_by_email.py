"""Add definition attribution to project status categories.

Revision ID: 069
Revises: 068
Create Date: 2026-07-17

nullable defined_by_email: null means system default definition.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "069"
down_revision: str | None = "068"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "project_status_categories",
        sa.Column("defined_by_email", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("project_status_categories", "defined_by_email")
