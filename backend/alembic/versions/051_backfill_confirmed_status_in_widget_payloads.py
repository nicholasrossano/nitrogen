"""Backfill legacy confirmed variable statuses in widget payloads.

Revision ID: 051
Revises: 050
Create Date: 2026-05-01
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "051"
down_revision: str | None = "050"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # chat_messages.widget_data.inputs.<field>.status
    op.execute(
        """
        UPDATE chat_messages AS cm
        SET widget_data = jsonb_set(
            cm.widget_data,
            '{inputs}',
            (
                SELECT jsonb_object_agg(
                    input_key,
                    CASE
                        WHEN input_val ->> 'status' = 'confirmed'
                            THEN jsonb_set(input_val, '{status}', '"validated"'::jsonb, false)
                        ELSE input_val
                    END
                )
                FROM jsonb_each(cm.widget_data -> 'inputs') AS i(input_key, input_val)
            ),
            false
        )
        WHERE cm.widget_data IS NOT NULL
          AND jsonb_typeof(cm.widget_data -> 'inputs') = 'object'
          AND cm.widget_data::text LIKE '%"status":"confirmed"%';
        """
    )

    # chat_messages.widget_data.data.inputs.<field>.status
    op.execute(
        """
        UPDATE chat_messages AS cm
        SET widget_data = jsonb_set(
            cm.widget_data,
            '{data,inputs}',
            (
                SELECT jsonb_object_agg(
                    input_key,
                    CASE
                        WHEN input_val ->> 'status' = 'confirmed'
                            THEN jsonb_set(input_val, '{status}', '"validated"'::jsonb, false)
                        ELSE input_val
                    END
                )
                FROM jsonb_each(cm.widget_data -> 'data' -> 'inputs') AS i(input_key, input_val)
            ),
            false
        )
        WHERE cm.widget_data IS NOT NULL
          AND jsonb_typeof(cm.widget_data -> 'data' -> 'inputs') = 'object'
          AND cm.widget_data::text LIKE '%"status":"confirmed"%';
        """
    )

    # assessment_instances.workflow_state.stages.*.data.widget_data.inputs.<field>.status
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
                                WHEN jsonb_typeof(stage_val -> 'data' -> 'widget_data' -> 'inputs') = 'object' THEN jsonb_set(
                                    stage_val,
                                    '{data,widget_data,inputs}',
                                    (
                                        SELECT jsonb_object_agg(
                                            input_key,
                                            CASE
                                                WHEN input_val ->> 'status' = 'confirmed'
                                                    THEN jsonb_set(input_val, '{status}', '"validated"'::jsonb, false)
                                                ELSE input_val
                                            END
                                        )
                                        FROM jsonb_each(stage_val -> 'data' -> 'widget_data' -> 'inputs') AS i(input_key, input_val)
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
              AND mi.workflow_state::text LIKE '%"status":"confirmed"%'
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
        UPDATE chat_messages AS cm
        SET widget_data = jsonb_set(
            cm.widget_data,
            '{inputs}',
            (
                SELECT jsonb_object_agg(
                    input_key,
                    CASE
                        WHEN input_val ->> 'status' = 'validated'
                            THEN jsonb_set(input_val, '{status}', '"confirmed"'::jsonb, false)
                        ELSE input_val
                    END
                )
                FROM jsonb_each(cm.widget_data -> 'inputs') AS i(input_key, input_val)
            ),
            false
        )
        WHERE cm.widget_data IS NOT NULL
          AND jsonb_typeof(cm.widget_data -> 'inputs') = 'object';
        """
    )

    op.execute(
        """
        UPDATE chat_messages AS cm
        SET widget_data = jsonb_set(
            cm.widget_data,
            '{data,inputs}',
            (
                SELECT jsonb_object_agg(
                    input_key,
                    CASE
                        WHEN input_val ->> 'status' = 'validated'
                            THEN jsonb_set(input_val, '{status}', '"confirmed"'::jsonb, false)
                        ELSE input_val
                    END
                )
                FROM jsonb_each(cm.widget_data -> 'data' -> 'inputs') AS i(input_key, input_val)
            ),
            false
        )
        WHERE cm.widget_data IS NOT NULL
          AND jsonb_typeof(cm.widget_data -> 'data' -> 'inputs') = 'object';
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
                                WHEN jsonb_typeof(stage_val -> 'data' -> 'widget_data' -> 'inputs') = 'object' THEN jsonb_set(
                                    stage_val,
                                    '{data,widget_data,inputs}',
                                    (
                                        SELECT jsonb_object_agg(
                                            input_key,
                                            CASE
                                                WHEN input_val ->> 'status' = 'validated'
                                                    THEN jsonb_set(input_val, '{status}', '"confirmed"'::jsonb, false)
                                                ELSE input_val
                                            END
                                        )
                                        FROM jsonb_each(stage_val -> 'data' -> 'widget_data' -> 'inputs') AS i(input_key, input_val)
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
