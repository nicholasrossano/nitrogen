"""Unified execution context for chat and capability dispatch."""

from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser


@dataclass
class ExecutionContext:
    """All ambient state a capability needs to run."""

    user_id: str
    user_email: str | None
    project_id: UUID | None
    initiative_role: str | None  # "owner" | "editor" | "viewer"
    ai_access_granted: bool
    is_byok: bool
    request_id: str
    chat_id: UUID | None = None


async def build_context(
    db: AsyncSession,
    user: AuthUser,
    project_id: UUID | None = None,
) -> ExecutionContext:
    """Build an ExecutionContext from the current request state.

    Sources:
    - AuthUser → uid, email
    - get_project_with_role → role
    - check_usage_budget → ai_access_granted, is_byok
    """
    from app.core.llm_client import check_usage_budget

    role: str | None = None
    if project_id:
        from app.core.permissions import get_project_with_role

        try:
            _initiative, role = await get_project_with_role(
                db, project_id, user
            )
        except Exception:
            pass

    budget = await check_usage_budget(user.uid, db)
    ai_access_granted = budget.get("allowed", True)
    is_byok = budget.get("tier") == "byok"

    return ExecutionContext(
        user_id=user.uid,
        user_email=user.email,
        project_id=project_id,
        initiative_role=role,
        ai_access_granted=ai_access_granted,
        is_byok=is_byok,
        request_id=str(uuid4()),
    )
