"""Chat complexity heuristics for model tier selection."""

from __future__ import annotations

from app.core.model_catalog import Complexity


def estimate_chat_complexity(
    *,
    message: str = "",
    tool_count: int = 0,
    compare_mode: bool = False,
    onboarding_mode: bool = False,
    assessment_mode: bool = False,
) -> Complexity:
    if compare_mode or onboarding_mode or assessment_mode:
        return Complexity.HEAVY
    if tool_count > 2 or len(message) > 2000:
        return Complexity.HEAVY
    if tool_count > 0 or len(message) > 500:
        return Complexity.STANDARD
    return Complexity.LIGHT
