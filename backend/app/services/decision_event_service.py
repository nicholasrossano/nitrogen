"""Helpers for recording append-only decision log events."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.decision_event import DecisionEvent
from app.models.module_instance import ModuleInstance


async def append_decision_event(
    db: AsyncSession,
    *,
    inst: ModuleInstance,
    event_type: str,
    entity_type: str,
    actor_user_id: str | None,
    actor_email: str | None,
    stage_id: str | None = None,
    entity_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> DecisionEvent:
    """Persist an append-only workflow event with a stable sequence number."""
    max_sequence = await db.scalar(
        select(func.max(DecisionEvent.sequence_number)).where(
            DecisionEvent.module_instance_id == inst.id
        )
    )
    event = DecisionEvent(
        initiative_id=inst.initiative_id,
        module_instance_id=inst.id,
        module_id=inst.module_id,
        stage_id=stage_id,
        entity_type=entity_type,
        entity_id=entity_id,
        event_type=event_type,
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        sequence_number=(max_sequence or 0) + 1,
        payload_json=payload or {},
    )
    db.add(event)
    await db.flush()
    return event
