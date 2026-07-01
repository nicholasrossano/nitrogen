"""Routing logic for project/onboarding chat actions."""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from app.config import get_settings
from app.core.model_catalog import Complexity, ModelRole
from app.domain.registry import format_assessment_selection_context, get_tool_hint_action
from app.services.project_chat_contract import ORCHESTRATION_SYSTEM_PROMPT, ProjectChatAction
from app.services.assumptions import format_assumptions_for_initiative_prompt
from app.services.tiered_retrieval import RetrievedFact

if TYPE_CHECKING:
    from app.services.chat import ChatService

logger = logging.getLogger(__name__)
settings = get_settings()


class ProjectChatRouter:
    """Typed router for project chat turns."""

    PROJECT_CHAT_DIRECTIVE: str = (
        "IMPORTANT MODE: This is an ongoing project chat inside an existing "
        "project, NOT the initial project onboarding flow. Do NOT ask the user "
        "to upload documents. Do NOT ask clarifying onboarding questions about "
        "geography or project type (those have already been captured). Ignore "
        "Rules 1 and 3 in the decision rules below — they apply only during "
        "initial project onboarding. If the user asks a question, answer it "
        "(send_message). If the user requests model/tool/plan work, use the "
        "appropriate tool.\n\n"
    )

    def __init__(self, chat_service: "ChatService") -> None:
        self.chat_service = chat_service

    async def get_next_action(
        self,
        messages: list,
        initiative,
        tool_hint: str | None = None,
        field_context: dict[str, Any] | None = None,
        onboarding_mode: bool = False,
    ) -> ProjectChatAction:
        if tool_hint and (hint_action := get_tool_hint_action(tool_hint)):
            action, message = hint_action
            return ProjectChatAction(
                action=action,
                parameters={"message": message},
                sources_used=[],
            )

        if field_context and field_context.get("field_name"):
            return ProjectChatAction(
                action="propose_input_value",
                parameters={
                    "field_name": field_context.get("field_name"),
                    "label": field_context.get("label"),
                    "current_value": field_context.get("current_value"),
                    "unit": field_context.get("unit"),
                    "model_type": field_context.get("model_type", "lcoe"),
                    "assessment_id": field_context.get("assessment_id"),
                    "status": field_context.get("status"),
                },
                sources_used=[],
            )

        has_document_request = any(
            m.widget_type == "document_request" for m in messages if m.role == "assistant"
        )
        clarifying_asked = sum(
            1 for m in messages if m.role == "assistant" and m.widget_type == "clarifying_questions"
        )
        user_message_count = sum(1 for m in messages if m.role == "user")

        context_results = await self.chat_service.retrieval.retrieve_for_context(initiative)
        context_str = self.chat_service.retrieval.format_context_for_prompt(context_results)

        sources_used: list[RetrievedFact] = []
        for result in context_results.values():
            sources_used.extend(result.facts)

        model_inputs_context = self.chat_service._format_model_inputs_from_messages(messages, field_context)
        assumptions_context = ""
        if getattr(initiative, "id", None):
            assumptions_context = await format_assumptions_for_initiative_prompt(
                self.chat_service.db,
                initiative.id,
            )
        system_prompt = ORCHESTRATION_SYSTEM_PROMPT.format(
            retrieved_context=context_str if context_str else "No additional context available.",
            title=initiative.title or "Not set",
            project_type=initiative.project_type or "Unknown",
            description=(initiative.project_description or "Not provided")[:500],
            geography=initiative.geography or "Not specified",
            has_documents="Yes" if initiative.evidence_ready else "No",
            has_plan="Yes" if initiative.project_plan else "No",
            documents_requested="Yes" if has_document_request else "No",
            clarifying_asked=clarifying_asked,
            user_message_count=user_message_count,
            model_inputs_context=model_inputs_context or "No model has been run yet.",
            assumptions_context=assumptions_context or "No project assumptions tracked yet.",
        )
        system_prompt = f"{system_prompt}\n\n{format_assessment_selection_context()}"
        if not onboarding_mode:
            system_prompt = self.PROJECT_CHAT_DIRECTIVE + system_prompt

        api_messages: list[dict] = [{"role": "system", "content": system_prompt}]
        recent_messages = messages[-15:] if len(messages) > 15 else messages
        for msg in recent_messages:
            api_messages.append({"role": msg.role, "content": msg.content})

        tools = self.chat_service._get_tool_list(
            project_id=str(initiative.id) if getattr(initiative, "id", None) else None,
            onboarding_mode=onboarding_mode,
            orchestration_mode=True,
            field_context=field_context,
        )

        try:
            response = await self.chat_service._acomplete(
                ModelRole.ORCHESTRATION,
                Complexity.STANDARD,
                messages=api_messages,
                tools=tools,
                tool_choice="required",
                temperature=0.7,
            )
            tool_call = response.choices[0].message.tool_calls[0]
            action = tool_call.function.name
            parameters = json.loads(tool_call.function.arguments)
            logger.info("Orchestration chose action: %s", action)
            return ProjectChatAction(
                action=action,
                parameters=parameters,
                sources_used=sources_used,
            )
        except Exception as exc:
            logger.error("Orchestration failed: %s", exc, exc_info=True)
            return ProjectChatAction(
                action="send_message",
                parameters={"message": "I'm here to help. Could you tell me more about your project?"},
                sources_used=[],
            )
