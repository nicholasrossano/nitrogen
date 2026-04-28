"""Add icon column to workspaces.

Revision ID: 044
Revises: 043
Create Date: 2026-04-28
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "044"
down_revision: str | None = "043"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column("icon", sa.String(length=64), nullable=False, server_default="Building2"),
    )
    op.alter_column("workspaces", "icon", server_default=None)


def downgrade() -> None:
    op.drop_column("workspaces", "icon")
