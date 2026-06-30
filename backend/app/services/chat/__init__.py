"""Chat service package."""

from app.core.llm_client import record_usage_from_response
from app.services.chat.generation import (
    COMPARE_EVIDENCE_BLOCK_TEMPLATE,
    COMPARE_SYSTEM_PROMPT,
    EVIDENCE_BLOCK_TEMPLATE,
    SYSTEM_PROMPT,
)
from app.services.chat.planning import PLANNING_SYSTEM_PROMPT
from app.services.chat.service import ChatService, _log_proposal_debug
from app.services.chat.types import ChatResponse, ResearchStepCallback, ThinkingCallback

__all__ = [
    "ChatResponse",
    "ChatService",
    "COMPARE_EVIDENCE_BLOCK_TEMPLATE",
    "COMPARE_SYSTEM_PROMPT",
    "EVIDENCE_BLOCK_TEMPLATE",
    "PLANNING_SYSTEM_PROMPT",
    "ResearchStepCallback",
    "SYSTEM_PROMPT",
    "ThinkingCallback",
    "_log_proposal_debug",
    "record_usage_from_response",
]
