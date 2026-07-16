"""Rename assumptions tables/columns to variables.

Revision ID: 067
Revises: 066
Create Date: 2026-07-16

Renames the project-level entity tables and FK columns from assumption*
to variable*. Status value \"assumed\" is unchanged (unconfirmed value).
"""

from collections.abc import Sequence

from alembic import op


revision: str = "067"
down_revision: str | None = "066"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _rename_index(old: str, new: str) -> None:
    op.execute(f'ALTER INDEX IF EXISTS "{old}" RENAME TO "{new}"')


def _rename_constraint(table: str, old: str, new: str) -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{old}') THEN
            ALTER TABLE "{table}" RENAME CONSTRAINT "{old}" TO "{new}";
          END IF;
        END $$;
        """
    )


def upgrade() -> None:
    # Drop core_chats FK so table/column renames can proceed cleanly.
    # if_exists: some DBs already dropped/renamed this constraint during partial runs.
    op.drop_constraint(
        "fk_core_chats_assumption_id",
        "core_chats",
        type_="foreignkey",
        if_exists=True,
    )

    op.rename_table("assumptions", "variables")
    op.rename_table("assumption_comments", "variable_comments")
    op.rename_table("assumption_bindings", "variable_bindings")

    op.alter_column("variable_comments", "assumption_id", new_column_name="variable_id")
    op.alter_column("variable_bindings", "assumption_id", new_column_name="variable_id")
    op.alter_column("core_chats", "assumption_id", new_column_name="variable_id")

    # Primary-key constraint/index names keep the old table prefix.
    _rename_constraint("variables", "assumptions_pkey", "variables_pkey")
    _rename_constraint("variable_comments", "assumption_comments_pkey", "variable_comments_pkey")
    _rename_constraint("variable_bindings", "assumption_bindings_pkey", "variable_bindings_pkey")

    # Indexes keep old names across table/column renames — rename them to match.
    _rename_index("ix_assumptions_project_key", "ix_variables_project_key")
    _rename_index("ix_assumptions_project_status", "ix_variables_project_status")
    _rename_index("ix_assumptions_source_type", "ix_variables_source_type")
    _rename_index("ix_assumptions_project_id", "ix_variables_project_id")

    _rename_index(
        "ix_assumption_comments_assumption_created",
        "ix_variable_comments_variable_created",
    )
    _rename_index(
        "ix_assumption_comments_project_created",
        "ix_variable_comments_project_created",
    )
    _rename_index("ix_assumption_comments_project_id", "ix_variable_comments_project_id")

    _rename_index(
        "ix_assumption_bindings_project_assessment_field",
        "ix_variable_bindings_project_assessment_field",
    )
    _rename_index("ix_assumption_bindings_assumption", "ix_variable_bindings_variable")
    # Historical DBs may still use the pre-assessment rename index name.
    _rename_index(
        "ix_assumption_bindings_assessment_instance",
        "ix_variable_bindings_assessment_instance",
    )
    _rename_index(
        "ix_assumption_bindings_module_instance",
        "ix_variable_bindings_assessment_instance",
    )
    _rename_index("ix_assumption_bindings_project_id", "ix_variable_bindings_project_id")

    _rename_index("ix_core_chats_assumption_id", "ix_core_chats_variable_id")

    _rename_constraint(
        "variable_comments",
        "assumption_comments_assumption_id_fkey",
        "variable_comments_variable_id_fkey",
    )
    _rename_constraint(
        "variable_bindings",
        "assumption_bindings_assumption_id_fkey",
        "variable_bindings_variable_id_fkey",
    )
    _rename_constraint(
        "variables",
        "assumptions_project_id_fkey",
        "variables_project_id_fkey",
    )
    _rename_constraint(
        "variable_comments",
        "assumption_comments_project_id_fkey",
        "variable_comments_project_id_fkey",
    )
    _rename_constraint(
        "variable_bindings",
        "assumption_bindings_project_id_fkey",
        "variable_bindings_project_id_fkey",
    )
    _rename_constraint(
        "variable_bindings",
        "assumption_bindings_module_instance_id_fkey",
        "variable_bindings_assessment_instance_id_fkey",
    )
    _rename_constraint(
        "variable_bindings",
        "assumption_bindings_assessment_instance_id_fkey",
        "variable_bindings_assessment_instance_id_fkey",
    )

    op.create_foreign_key(
        "fk_core_chats_variable_id",
        "core_chats",
        "variables",
        ["variable_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_core_chats_variable_id", "core_chats", type_="foreignkey")

    _rename_constraint("variables", "variables_pkey", "assumptions_pkey")
    _rename_constraint("variable_comments", "variable_comments_pkey", "assumption_comments_pkey")
    _rename_constraint("variable_bindings", "variable_bindings_pkey", "assumption_bindings_pkey")

    _rename_constraint(
        "variable_comments",
        "variable_comments_variable_id_fkey",
        "assumption_comments_assumption_id_fkey",
    )
    _rename_constraint(
        "variable_bindings",
        "variable_bindings_variable_id_fkey",
        "assumption_bindings_assumption_id_fkey",
    )
    _rename_constraint(
        "variables",
        "variables_project_id_fkey",
        "assumptions_project_id_fkey",
    )
    _rename_constraint(
        "variable_comments",
        "variable_comments_project_id_fkey",
        "assumption_comments_project_id_fkey",
    )
    _rename_constraint(
        "variable_bindings",
        "variable_bindings_project_id_fkey",
        "assumption_bindings_project_id_fkey",
    )
    _rename_constraint(
        "variable_bindings",
        "variable_bindings_assessment_instance_id_fkey",
        "assumption_bindings_assessment_instance_id_fkey",
    )

    _rename_index("ix_variables_project_key", "ix_assumptions_project_key")
    _rename_index("ix_variables_project_status", "ix_assumptions_project_status")
    _rename_index("ix_variables_source_type", "ix_assumptions_source_type")
    _rename_index("ix_variables_project_id", "ix_assumptions_project_id")

    _rename_index(
        "ix_variable_comments_variable_created",
        "ix_assumption_comments_assumption_created",
    )
    _rename_index(
        "ix_variable_comments_project_created",
        "ix_assumption_comments_project_created",
    )
    _rename_index("ix_variable_comments_project_id", "ix_assumption_comments_project_id")

    _rename_index(
        "ix_variable_bindings_project_assessment_field",
        "ix_assumption_bindings_project_assessment_field",
    )
    _rename_index("ix_variable_bindings_variable", "ix_assumption_bindings_assumption")
    _rename_index(
        "ix_variable_bindings_assessment_instance",
        "ix_assumption_bindings_assessment_instance",
    )
    _rename_index("ix_variable_bindings_project_id", "ix_assumption_bindings_project_id")

    _rename_index("ix_core_chats_variable_id", "ix_core_chats_assumption_id")

    op.alter_column("variable_comments", "variable_id", new_column_name="assumption_id")
    op.alter_column("variable_bindings", "variable_id", new_column_name="assumption_id")
    op.alter_column("core_chats", "variable_id", new_column_name="assumption_id")

    op.rename_table("variables", "assumptions")
    op.rename_table("variable_comments", "assumption_comments")
    op.rename_table("variable_bindings", "assumption_bindings")

    op.create_foreign_key(
        "fk_core_chats_assumption_id",
        "core_chats",
        "assumptions",
        ["assumption_id"],
        ["id"],
        ondelete="SET NULL",
    )
