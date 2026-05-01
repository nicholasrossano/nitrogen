"""Standardize assumption/input status label to validated.

Revision ID: 050
Revises: 049
Create Date: 2026-05-01
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "050"
down_revision: str | None = "049"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE assumptions
        SET status = 'validated'
        WHERE status = 'confirmed';
        """
    )

    # Only rewrite item.content.status within workflow_state stage item rows.
    # Do not touch stage lifecycle statuses (pending/draft/confirmed/etc).
    op.execute(
        """
        WITH transformed AS (
            SELECT
                mi.id,
                jsonb_set(
                    mi.workflow_state,
                    '{stages}',
                    (
                        SELECT jsonb_object_agg(
                            stage_key,
                            CASE
                                WHEN jsonb_typeof(stage_val -> 'data' -> 'items') = 'array' THEN jsonb_set(
                                    stage_val,
                                    '{data,items}',
                                    (
                                        SELECT jsonb_agg(
                                            CASE
                                                WHEN item -> 'content' ->> 'status' = 'confirmed'
                                                    THEN jsonb_set(item, '{content,status}', '"validated"'::jsonb, false)
                                                ELSE item
                                            END
                                        )
                                        FROM jsonb_array_elements(stage_val -> 'data' -> 'items') AS item
                                    ),
                                    false
                                )
                                ELSE stage_val
                            END
                        )
                        FROM jsonb_each(mi.workflow_state -> 'stages') AS s(stage_key, stage_val)
                    ),
                    false
                ) AS new_workflow_state
            FROM assessment_instances AS mi
            WHERE mi.workflow_state ? 'stages'
        )
        UPDATE assessment_instances AS mi
        SET workflow_state = transformed.new_workflow_state
        FROM transformed
        WHERE mi.id = transformed.id
          AND mi.workflow_state IS DISTINCT FROM transformed.new_workflow_state;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE assumptions
        SET status = 'confirmed'
        WHERE status = 'validated';
        """
    )

    op.execute(
        """
        WITH transformed AS (
            SELECT
                mi.id,
                jsonb_set(
                    mi.workflow_state,
                    '{stages}',
                    (
                        SELECT jsonb_object_agg(
                            stage_key,
                            CASE
                                WHEN jsonb_typeof(stage_val -> 'data' -> 'items') = 'array' THEN jsonb_set(
                                    stage_val,
                                    '{data,items}',
                                    (
                                        SELECT jsonb_agg(
                                            CASE
                                                WHEN item -> 'content' ->> 'status' = 'validated'
                                                    THEN jsonb_set(item, '{content,status}', '"confirmed"'::jsonb, false)
                                                ELSE item
                                            END
                                        )
                                        FROM jsonb_array_elements(stage_val -> 'data' -> 'items') AS item
                                    ),
                                    false
                                )
                                ELSE stage_val
                            END
                        )
                        FROM jsonb_each(mi.workflow_state -> 'stages') AS s(stage_key, stage_val)
                    ),
                    false
                ) AS new_workflow_state
            FROM assessment_instances AS mi
            WHERE mi.workflow_state ? 'stages'
        )
        UPDATE assessment_instances AS mi
        SET workflow_state = transformed.new_workflow_state
        FROM transformed
        WHERE mi.id = transformed.id
          AND mi.workflow_state IS DISTINCT FROM transformed.new_workflow_state;
        """
    )
