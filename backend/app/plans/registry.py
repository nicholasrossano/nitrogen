"""Registry for reusable plan handlers."""

from __future__ import annotations

from typing import Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.plans.base import BasePlanHandler
from app.plans.project_plan_handler import ProjectPlanHandler

PlanHandlerFactory = Callable[[AsyncSession, str | None], BasePlanHandler]


class PlanRegistry:
    """Simple in-process registry for reusable plan handlers."""

    def __init__(self) -> None:
        self._factories: dict[str, PlanHandlerFactory] = {}

    def register(self, plan_id: str, factory: PlanHandlerFactory) -> None:
        self._factories[plan_id] = factory

    def get_handler(
        self,
        plan_id: str,
        db: AsyncSession,
        user_id: str | None = None,
    ) -> BasePlanHandler:
        factory = self._factories.get(plan_id)
        if factory is None:
            raise KeyError(f"Unknown plan handler '{plan_id}'")
        return factory(db, user_id)

    def default_handler(self, db: AsyncSession, user_id: str | None = None) -> BasePlanHandler:
        return self.get_handler("project_plan", db, user_id)

    def list_plan_ids(self) -> list[str]:
        return list(self._factories.keys())


_plan_registry: PlanRegistry | None = None


def get_plan_registry() -> PlanRegistry:
    global _plan_registry
    if _plan_registry is None:
        registry = PlanRegistry()
        registry.register("project_plan", lambda db, user_id=None: ProjectPlanHandler(db, user_id))
        _plan_registry = registry
    return _plan_registry
