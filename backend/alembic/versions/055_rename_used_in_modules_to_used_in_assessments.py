"""Rename assumptions usage column to assessment nomenclature.

Revision ID: 055
Revises: 054
Create Date: 2026-05-01
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "055"
down_revision: str | None = "054"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_columns(inspector: sa.Inspector, table_name: str) -> set[str]:
    try:
        return {c["name"] for c in inspector.get_columns(table_name)}
    except Exception:
        return set()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    assumption_cols = _table_columns(inspector, "assumptions")

    if "used_in_modules" in assumption_cols and "used_in_assessments" not in assumption_cols:
        op.alter_column(
            "assumptions",
            "used_in_modules",
            new_column_name="used_in_assessments",
            existing_type=postgresql.JSONB(astext_type=sa.Text()),
            existing_nullable=False,
        )
        return

    if "used_in_assessments" not in assumption_cols:
        op.add_column(
            "assumptions",
            sa.Column(
                "used_in_assessments",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default="[]",
            ),
        )
        op.alter_column("assumptions", "used_in_assessments", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    assumption_cols = _table_columns(inspector, "assumptions")
    if "used_in_assessments" in assumption_cols and "used_in_modules" not in assumption_cols:
        op.alter_column(
            "assumptions",
            "used_in_assessments",
            new_column_name="used_in_modules",
            existing_type=postgresql.JSONB(astext_type=sa.Text()),
            existing_nullable=False,
        )
