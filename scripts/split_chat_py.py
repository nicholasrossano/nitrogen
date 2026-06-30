#!/usr/bin/env python3
"""Split backend/app/services/chat.py into chat/ package."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "backend/app/services/chat.py"
PKG = ROOT / "backend/app/services/chat"

PLANNING_METHODS = [
    "_plan_tool_calls",
    "_build_search_query",
    "_is_coordinate_lookup_field",
    "_should_run_scholarly_search",
    "_extract_location_hint",
    "_fallback_external_search_query",
    "_normalize_external_tool_query",
    "_build_external_search_query",
]

GENERATION_METHODS = [
    "_generate_compare_response",
    "_run_compare_search",
    "_generate_compare_answer",
    "_generate_carbon_answer",
    "_generate_lcoe_answer",
    "_is_investigate_request",
    "_requires_distinct_proposal",
    "_values_match",
    "_proposal_matches_current",
    "_normalize_proposal_unit",
    "_resolve_current_value",
    "_format_active_field_context",
    "_resolve_investigate_hint",
    "_format_active_editor_doc_block",
    "_format_fact_blocks",
    "_synthesize_value_proposal",
    "_extract_value_proposal",
    "_generate_investigate_answer",
    "_generate_template_investigate_answer",
    "_enrich_proposal_from_context",
    "_rank_facts",
    "_generate_answer",
    "_extract_cited_sources",
]


def find_method_block(lines: list[str], method_name: str) -> tuple[int, int] | None:
    pattern = re.compile(rf"^    (async )?def {re.escape(method_name)}\(")
    start = next((i for i, line in enumerate(lines) if pattern.match(line)), None)
    if start is None:
        return None
    block_start = start
    while block_start > 0 and lines[block_start - 1].strip().startswith("@"):
        block_start -= 1
    indent = "    "
    end = start + 1
    while end < len(lines):
        line = lines[end]
        if line.startswith(indent) and not line.startswith(indent * 2) and line.strip() and not line.strip().startswith("#"):
            if re.match(r"^    (async )?def ", line) or re.match(r"^    @", line):
                break
            if line.startswith("    # ="):
                break
        end += 1
    return block_start, end


def extract_methods(lines: list[str], names: list[str]) -> str:
    chunks: list[str] = []
    for name in names:
        span = find_method_block(lines, name)
        if span is None:
            raise SystemExit(f"Missing method {name}")
        start, end = span
        chunks.append("".join(lines[start:end]).rstrip() + "\n\n")
    return "".join(chunks)


def main() -> None:
    text = SOURCE.read_text()
    lines = text.splitlines(keepends=True)

    planning_prompt_start = next(i for i, l in enumerate(lines) if l.startswith("PLANNING_SYSTEM_PROMPT"))
    planning_prompt_end = next(i for i, l in enumerate(lines[planning_prompt_start:], planning_prompt_start) if l.strip() == '"""' and i > planning_prompt_start) + 1
    citation_re_line = next(i for i, l in enumerate(lines) if l.startswith("_CITATION_RE"))
    system_prompt_start = next(i for i, l in enumerate(lines) if l.startswith("SYSTEM_PROMPT"))
    compare_evidence_end = next(i for i, l in enumerate(lines) if l.startswith("# Pattern to extract inline citations"))
    chat_response_start = next(i for i, l in enumerate(lines) if l.startswith("@dataclass"))
    chat_response_end = next(i for i, l in enumerate(lines) if l.startswith("class ChatService:"))

    PKG.mkdir(parents=True, exist_ok=True)

    (PKG / "types.py").write_text(
        "from dataclasses import dataclass\n"
        "from typing import Awaitable, Callable\n\n"
        "from app.services.tiered_retrieval import RetrievedFact\n\n"
        "ThinkingCallback = Callable[[str], Awaitable[None]]\n"
        "ResearchStepCallback = Callable[[str, str, str], Awaitable[None]]  # (id, label, status)\n\n"
        + "".join(lines[chat_response_start:chat_response_end])
    )

    generation_prompts = "".join(lines[system_prompt_start:compare_evidence_end])
    generation_prompts += lines[citation_re_line]

    planning_body = extract_methods(lines, PLANNING_METHODS)
    generation_body = extract_methods(lines, GENERATION_METHODS)

    (PKG / "planning.py").write_text(
        '"""Planning helpers for ChatService."""\n\n'
        "from __future__ import annotations\n\n"
        "import logging\n"
        "import re\n"
        "from typing import Any\n\n"
        "from app.config import get_settings\n"
        "from app.core.llm_client import record_usage_from_response\n\n"
        "settings = get_settings()\n"
        "logger = logging.getLogger(__name__)\n\n"
        + "".join(lines[planning_prompt_start:planning_prompt_end]) + "\n\n"
        "class ChatPlanningMixin:\n"
        + planning_body
    )

    (PKG / "generation.py").write_text(
        '"""Generation and citation helpers for ChatService."""\n\n'
        "from __future__ import annotations\n\n"
        "import json\n"
        "import logging\n"
        "import re\n"
        "import time\n"
        "from typing import Any\n\n"
        "from app.config import get_settings\n"
        "from app.core.llm_client import record_usage_from_response\n"
        "from app.services.tiered_retrieval import RetrievedFact, SourceType\n\n"
        "settings = get_settings()\n"
        "logger = logging.getLogger(__name__)\n\n"
        + generation_prompts + "\n\n"
        "class ChatGenerationMixin:\n"
        + generation_body
    )

    service_lines = lines[:38]  # imports through logger setup
    service_lines.append("\n")
    service_lines.extend(lines[chat_response_end:])  # class ChatService onward

    service_text = "".join(service_lines)
    service_text = service_text.replace(
        "class ChatService:",
        "from app.services.chat.generation import ChatGenerationMixin\n"
        "from app.services.chat.planning import ChatPlanningMixin\n"
        "from app.services.chat.types import ChatResponse, ResearchStepCallback, ThinkingCallback\n\n\n"
        "class ChatService(ChatPlanningMixin, ChatGenerationMixin):",
        1,
    )
    # Remove duplicated type definitions from service
    service_text = re.sub(
        r"@dataclass\nclass ChatResponse:[\s\S]*?\n\n\n# -+\n# Service\n# -+\n\n",
        "",
        service_text,
        count=1,
    )
    service_text = re.sub(
        r"ThinkingCallback = Callable\[\[str\], Awaitable\[None\]\]\n"
        r"ResearchStepCallback = Callable\[\[str, str, str\], Awaitable\[None\]\].*\n\n",
        "",
        service_text,
        count=1,
    )
    # Remove prompt constants now living in submodules
    for marker in (
        "PLANNING_SYSTEM_PROMPT",
        "SYSTEM_PROMPT",
        "EVIDENCE_BLOCK_TEMPLATE",
        "ACTIVE_EDITOR_DOC_BLOCK_TEMPLATE",
        "COMPARE_SYSTEM_PROMPT",
        "COMPARE_EVIDENCE_BLOCK_TEMPLATE",
        "_CITATION_RE",
    ):
        service_text = re.sub(
            rf"^{re.escape(marker)}[\s\S]*?(?=\n(?:[A-Z_#]|class ))",
            "",
            service_text,
            count=1,
            flags=re.MULTILINE,
        )

    # Remove extracted methods from service class
    for name in PLANNING_METHODS + GENERATION_METHODS:
        service_text = re.sub(
            rf"^    (async )?def {re.escape(name)}\([\s\S]*?(?=^    (async )?def |^    @|^    # =|\Z)",
            "",
            service_text,
            count=1,
            flags=re.MULTILINE,
        )

    (PKG / "service.py").write_text(service_text)

    (PKG / "__init__.py").write_text(
        '"""Chat service package."""\n\n'
        "from app.services.chat.generation import (\n"
        "    COMPARE_EVIDENCE_BLOCK_TEMPLATE,\n"
        "    COMPARE_SYSTEM_PROMPT,\n"
        "    EVIDENCE_BLOCK_TEMPLATE,\n"
        "    SYSTEM_PROMPT,\n"
        ")\n"
        "from app.services.chat.planning import PLANNING_SYSTEM_PROMPT\n"
        "from app.services.chat.service import ChatService, _log_proposal_debug\n"
        "from app.services.chat.types import ChatResponse, ResearchStepCallback, ThinkingCallback\n\n"
        "__all__ = [\n"
        '    "ChatResponse",\n'
        '    "ChatService",\n'
        '    "COMPARE_EVIDENCE_BLOCK_TEMPLATE",\n'
        '    "COMPARE_SYSTEM_PROMPT",\n'
        '    "EVIDENCE_BLOCK_TEMPLATE",\n'
        '    "PLANNING_SYSTEM_PROMPT",\n'
        '    "ResearchStepCallback",\n'
        '    "SYSTEM_PROMPT",\n'
        '    "ThinkingCallback",\n'
        '    "_log_proposal_debug",\n'
        "]\n"
    )

    SOURCE.unlink()
    print(f"Created chat package at {PKG}")


if __name__ == "__main__":
    main()
