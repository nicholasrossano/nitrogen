"""Centralized service for ModuleInstance CRUD.

All module lifecycle writes go through here — this is the single source
of truth.  The old Initiative JSONB fields (deliverables, tool_alignments)
are no longer written to by application code.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.module_instance import ModuleInstance, ModuleInstanceStatus
from app.models.initiative import Initiative
from app.services.assumptions import AssumptionActor, ensure_expected_assumptions, sync_widget_assumptions


# ── Instance resolution ────────────────────────────────────────────

async def _next_instance_number(
    db: AsyncSession,
    initiative_id: uuid.UUID,
    module_id: str,
) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(ModuleInstance.instance_number), 0))
        .where(
            ModuleInstance.initiative_id == initiative_id,
            ModuleInstance.module_id == module_id,
        )
    )
    return int(result.scalar_one()) + 1


async def _resolve_instance(
    db: AsyncSession,
    initiative_id: uuid.UUID,
    tool_id: str,
    *,
    instance_id: uuid.UUID | None = None,
    chat_id: uuid.UUID | None = None,
    user_id: str | None = None,
) -> ModuleInstance:
    """Find or create the target instance for a write operation.

    Resolution order:
    1. Explicit instance_id → fetch that row.
    2. chat_id → find by (initiative_id, chat_id, tool_id), or create.
    3. Otherwise → create a brand-new instance.
    """
    if instance_id:
        inst = await db.get(ModuleInstance, instance_id)
        if inst is None:
            raise ValueError(f"ModuleInstance {instance_id} not found")
        return inst

    if chat_id:
        stmt = (
            select(ModuleInstance)
            .where(
                ModuleInstance.initiative_id == initiative_id,
                ModuleInstance.chat_id == chat_id,
                ModuleInstance.module_id == tool_id,
            )
            .limit(1)
        )
        result = await db.execute(stmt)
        inst = result.scalar_one_or_none()
        if inst:
            return inst

    if not user_id:
        raise ValueError("user_id is required when creating a new ModuleInstance")

    inst = ModuleInstance(
        initiative_id=initiative_id,
        module_id=tool_id,
        instance_number=await _next_instance_number(db, initiative_id, tool_id),
        status="draft",
        started_by=user_id,
        chat_id=chat_id,
    )
    db.add(inst)
    await db.flush()
    return inst


# ── Public API ─────────────────────────────────────────────────────

async def get_or_create_instance(
    db: AsyncSession,
    initiative_id: uuid.UUID,
    tool_id: str,
    user_id: str,
    chat_id: uuid.UUID | None = None,
) -> ModuleInstance:
    """Ensure a module instance exists for this (initiative, tool, chat)."""
    inst = await _resolve_instance(
        db, initiative_id, tool_id,
        chat_id=chat_id, user_id=user_id,
    )
    initiative = await db.get(Initiative, initiative_id)
    if initiative is not None:
        await ensure_expected_assumptions(
            db,
            initiative,
            module_ids=[tool_id],
            actor=AssumptionActor(user_id=user_id, email=user_id),
        )
    return inst


async def save_deliverable(
    db: AsyncSession,
    initiative_id: uuid.UUID,
    tool_id: str,
    title: str,
    output_type: str,
    content,
    user_id: str,
    *,
    chat_id: uuid.UUID | None = None,
    instance_id: uuid.UUID | None = None,
) -> ModuleInstance:
    """Write deliverable output to an instance and mark complete."""
    inst = await _resolve_instance(
        db, initiative_id, tool_id,
        instance_id=instance_id, chat_id=chat_id, user_id=user_id,
    )
    inst.deliverable = {
        "title": title,
        "output_type": output_type,
        "content": content,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    inst.title = title
    inst.status = ModuleInstanceStatus.READY
    inst.updated_at = datetime.now(timezone.utc)
    if isinstance(content, dict):
        await sync_widget_assumptions(
            db,
            initiative_id=initiative_id,
            module_id=tool_id,
            widget_data=content,
            actor=AssumptionActor(user_id=user_id, email=user_id),
        )
    await db.flush()
    return inst


async def set_instance_error(
    db: AsyncSession,
    initiative_id: uuid.UUID,
    tool_id: str,
    error_message: str,
    user_id: str,
    *,
    chat_id: uuid.UUID | None = None,
    instance_id: uuid.UUID | None = None,
) -> ModuleInstance:
    """Mark an instance as errored."""
    inst = await _resolve_instance(
        db, initiative_id, tool_id,
        instance_id=instance_id, chat_id=chat_id, user_id=user_id,
    )
    inst.status = "error"
    inst.deliverable = {"error": error_message}
    inst.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return inst


async def remove_instance(
    db: AsyncSession,
    instance_id: uuid.UUID,
) -> bool:
    """Delete an instance by ID. Returns True if it existed."""
    inst = await db.get(ModuleInstance, instance_id)
    if inst is None:
        return False
    await db.delete(inst)
    await db.flush()
    return True


async def remove_instance_by_tool(
    db: AsyncSession,
    initiative_id: uuid.UUID,
    tool_id: str,
) -> bool:
    """Delete the latest instance for a tool_id. Returns True if it existed."""
    stmt = (
        select(ModuleInstance)
        .where(
            ModuleInstance.initiative_id == initiative_id,
            ModuleInstance.module_id == tool_id,
        )
        .order_by(ModuleInstance.updated_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    inst = result.scalar_one_or_none()
    if inst is None:
        return False
    await db.delete(inst)
    await db.flush()
    return True


async def list_instances(
    db: AsyncSession,
    initiative_id: uuid.UUID,
    *,
    archived: bool = False,
) -> list[ModuleInstance]:
    """All instances for a project, newest first.

    Pass ``archived=True`` to list soft-deleted (trashed) instances instead.
    """
    stmt = (
        select(ModuleInstance)
        .where(
            ModuleInstance.initiative_id == initiative_id,
            ModuleInstance.archived == archived,
        )
        .order_by(ModuleInstance.started_at.desc())
    )
    if not archived:
        stmt = stmt.where(ModuleInstance.status != "draft")
    result = await db.execute(stmt)
    return list(result.scalars().all())
