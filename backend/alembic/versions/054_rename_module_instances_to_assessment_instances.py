"""Rename legacy module instance schema objects to assessment naming.

Revision ID: 054
Revises: 053
Create Date: 2026-05-01
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "054"
down_revision: str | None = "053"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_columns(inspector: sa.Inspector, table_name: str) -> set[str]:
    try:
        return {c["name"] for c in inspector.get_columns(table_name)}
    except Exception:
        return set()


def _table_indexes(inspector: sa.Inspector, table_name: str) -> set[str]:
    try:
        return {i["name"] for i in inspector.get_indexes(table_name)}
    except Exception:
        return set()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # module_instances -> assessment_instances
    if "module_instances" in tables and "assessment_instances" not in tables:
        op.rename_table("module_instances", "assessment_instances")
        inspector = sa.inspect(bind)

    ai_cols = _table_columns(inspector, "assessment_instances")
    if "module_id" in ai_cols and "assessment_id" not in ai_cols:
        op.alter_column(
            "assessment_instances",
            "module_id",
            new_column_name="assessment_id",
            existing_type=sa.String(length=100),
            existing_nullable=False,
        )

    # decision_events: module_* -> assessment_*
    de_cols = _table_columns(inspector, "decision_events")
    if "module_instance_id" in de_cols and "assessment_instance_id" not in de_cols:
        op.alter_column(
            "decision_events",
            "module_instance_id",
            new_column_name="assessment_instance_id",
            existing_type=sa.UUID(),
            existing_nullable=False,
        )
    if "module_id" in de_cols and "assessment_id" not in de_cols:
        op.alter_column(
            "decision_events",
            "module_id",
            new_column_name="assessment_id",
            existing_type=sa.String(length=100),
            existing_nullable=False,
        )

    # assumption_bindings: module_* -> assessment_*
    ab_cols = _table_columns(inspector, "assumption_bindings")
    if "module_id" in ab_cols and "assessment_id" not in ab_cols:
        op.alter_column(
            "assumption_bindings",
            "module_id",
            new_column_name="assessment_id",
            existing_type=sa.String(length=160),
            existing_nullable=False,
        )
    if "module_instance_id" in ab_cols and "assessment_instance_id" not in ab_cols:
        op.alter_column(
            "assumption_bindings",
            "module_instance_id",
            new_column_name="assessment_instance_id",
            existing_type=sa.UUID(),
            existing_nullable=True,
        )

    inspector = sa.inspect(bind)
    ai_indexes = _table_indexes(inspector, "assessment_instances")
    if "ix_mi_initiative_module_number" in ai_indexes:
        op.drop_index("ix_mi_initiative_module_number", table_name="assessment_instances")
    if "ix_mi_initiative_assessment_number" not in ai_indexes:
        op.create_index(
            "ix_mi_initiative_assessment_number",
            "assessment_instances",
            ["initiative_id", "assessment_id", "instance_number"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "assessment_instances" in tables and "module_instances" not in tables:
        op.rename_table("assessment_instances", "module_instances")
