from dataclasses import dataclass
from typing import Awaitable, Callable

from app.services.tiered_retrieval import RetrievedFact

ThinkingCallback = Callable[[str], Awaitable[None]]
ResearchStepCallback = Callable[[str, str, str], Awaitable[None]]  # (id, label, status)

@dataclass
class ChatResponse:
    content: str
    sources: list[RetrievedFact]
    tiers_used: list[str]
    latency_ms: int
    widget_type: str | None = None
    widget_data: dict | None = None
