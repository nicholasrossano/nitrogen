"""Execution logic for project chat tool actions."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.services.chat import _log_proposal_debug

if TYPE_CHECKING:
    from app.services.chat import ChatService, ThinkingCallback

logger = logging.getLogger(__name__)


class ProjectToolExecutor:
    """Runs project-chat actions and returns widget/result payloads."""

    def __init__(self, chat_service: "ChatService") -> None:
        self.chat_service = chat_service

    async def execute_project_action(
        self,
        initiative,
        action_result,
        chat_history: list | None = None,
        tool_hint: str | None = None,
        model_inputs_context: str | None = None,
        field_context: dict[str, Any] | None = None,
        on_thinking: "ThinkingCallback | None" = None,
    ) -> tuple[str | None, dict | None, str, list]:
        action = action_result.action
        params = action_result.parameters
        sources = action_result.sources_used

        widget_type: str | None = None
        widget_data: dict | None = None
        assistant_response: str = params.get("message", "")

        logger.info("Executing action: %s", action)

        if action == "send_message":
            project_context = await self.chat_service.build_project_context_with_assumptions(initiative)
            history_dicts = self.chat_service._chat_history_to_dicts(chat_history)
            user_message = self.chat_service._extract_last_user_message(chat_history, params)

            try:
                research_result = await self.chat_service.generate_response(
                    user_message=user_message,
                    history=history_dicts,
                    project_context=project_context or None,
                    model_inputs_context=model_inputs_context,
                    on_thinking=on_thinking,
                )
                assistant_response = research_result.content
                sources = research_result.sources
                if research_result.widget_type:
                    widget_type = research_result.widget_type
                    widget_data = research_result.widget_data
            except Exception as exc:
                logger.error("Research pipeline failed for send_message, falling back: %s", exc)

        elif action == "ask_for_documents":
            widget_type = "document_request"
            widget_data = {
                "allow_multiple": True,
                "suggested_types": params.get("suggested_types", []),
            }

        elif action == "ask_clarifying_questions":
            widget_type = "clarifying_questions"
            widget_data = {"fields_needed": params.get("fields_needed", [])}

        elif action == "generate_project_plan":
            from app.plans.registry import get_plan_registry

            plan_handler = get_plan_registry().default_handler(self.chat_service.db, self.chat_service.user_id)
            try:
                structure = await plan_handler.propose_structure(
                    initiative=initiative,
                    chat_history=chat_history,
                )
                widget_type = plan_handler.definition.structure_widget_type
                widget_data = plan_handler.build_structure_widget_data(structure)
                assistant_response = (
                    "I've outlined the assessments that look most relevant for this project. "
                    "Review them below and confirm the framework plan you want to start with."
                )
            except Exception as exc:
                logger.error("Category proposal failed: %s", exc, exc_info=True)
                assistant_response = (
                    "I wasn't able to analyze the project right now. Could you provide a bit more detail so I can try again?"
                )

        elif action == "update_project_plan":
            from app.plans.registry import get_plan_registry
            from sqlalchemy.orm.attributes import flag_modified

            plan_handler = get_plan_registry().default_handler(self.chat_service.db, self.chat_service.user_id)
            existing_plan = initiative.project_plan
            user_request = params.get("user_request", "")
            try:
                plan_data = await plan_handler.generate_plan(
                    initiative=initiative,
                    existing_plan=existing_plan,
                    user_request=user_request,
                )
                initiative.project_plan = plan_data
                flag_modified(initiative, "project_plan")
                await self.chat_service.db.commit()
                await self.chat_service.db.refresh(initiative)
                widget_type = plan_handler.definition.summary_widget_type
                widget_data = plan_handler.build_summary_widget_data(plan_data)
            except Exception as exc:
                logger.error("Project plan update failed: %s", exc, exc_info=True)
                assistant_response = "I wasn't able to update the project plan right now. Please try again."

        elif action == "run_lcoe":
            from app.domain.energy.assessments.lcoe_assessment import LCOETool
            from app.services import assessment_service

            lcoe_tool = LCOETool()
            try:
                yield_msg = params.get("message", "Building your LCOE model…")
                tool_output = await lcoe_tool.execute(
                    db=self.chat_service.db,
                    project_id=initiative.id,
                    inputs=initiative.tool_inputs or {},
                )
                content = tool_output.content
                computable = content.get("computable", False)

                if computable and content.get("result") and content.get("inputs"):
                    lcoe_val = content["result"]["lcoe"]
                    currency = content["result"].get("currency", "USD")
                    assumption_count = content["result"].get("assumption_count", 0)
                    quality = content["result"].get("quality_label", "moderate")
                    widget_type = "lcoe_output"
                    widget_data = content
                    assistant_response = (
                        f"{yield_msg}\n\n"
                        f"**LCOE: {currency} {lcoe_val:.4f}/kWh** "
                        f"({assumption_count} assumption{'s' if assumption_count != 1 else ''}, "
                        f"{quality} confidence). "
                        "Review the inputs below — you can edit any value and I'll recalculate instantly."
                    )
                    await assessment_service.save_deliverable(
                        self.chat_service.db,
                        initiative.id,
                        "lcoe_model",
                        f"LCOE Model ({currency} {lcoe_val:.4f}/kWh)",
                        "lcoe",
                        content,
                        user_id=self.chat_service.user_id or initiative.user_id,
                        chat_id=self.chat_service.ctx.chat_id,
                    )
                else:
                    missing = content.get("missing_essentials", [])
                    widget_type = "lcoe_inputs"
                    widget_data = content
                    missing_labels = {
                        "net_capacity_kw": "net capacity (kW)",
                        "total_capex": "total CAPEX",
                        "annual_opex": "annual O&M cost",
                    }
                    nice_names = [missing_labels.get(m, m) for m in missing]
                    assistant_response = (
                        f"{yield_msg}\n\n"
                        f"I've pre-filled what I could from our conversation. "
                        f"To calculate the LCOE I still need: **{', '.join(nice_names)}**. "
                        "Can you provide these?"
                    )
            except Exception as exc:
                logger.error("LCOE tool failed: %s", exc, exc_info=True)
                assistant_response = (
                    "I wasn't able to build the LCOE model right now. Could you provide more details about the project costs and capacity?"
                )

        elif action == "run_carbon":
            from app.domain.energy.assessments.carbon_assessment import CarbonTool
            from app.services import assessment_service

            carbon_tool = CarbonTool()
            try:
                yield_msg = params.get("message", "Building your carbon emissions model…")
                tool_output = await carbon_tool.execute(
                    db=self.chat_service.db,
                    project_id=initiative.id,
                    inputs=initiative.tool_inputs or {},
                )
                content = tool_output.content
                computable = content.get("computable", False)

                if computable and content.get("result") and content.get("inputs"):
                    net_er = content["result"]["net_er_tco2e"]
                    assumption_count = content["result"].get("assumption_count", 0)
                    quality = content["result"].get("quality_label", "moderate")
                    widget_type = "carbon_output"
                    widget_data = content
                    assistant_response = (
                        f"{yield_msg}\n\n"
                        f"**Net Emission Reductions: {net_er:,.2f} tCO₂e/year** "
                        f"({assumption_count} assumption{'s' if assumption_count != 1 else ''}, "
                        f"{quality} confidence). "
                        "Review the inputs below — you can edit any value and I'll recalculate instantly."
                    )
                    await assessment_service.save_deliverable(
                        self.chat_service.db,
                        initiative.id,
                        "carbon_model",
                        f"Carbon ER Model ({net_er:,.2f} tCO₂e/yr)",
                        "carbon",
                        content,
                        user_id=self.chat_service.user_id or initiative.user_id,
                        chat_id=self.chat_service.ctx.chat_id,
                    )
                else:
                    missing = content.get("missing_essentials", [])
                    widget_type = "carbon_inputs"
                    widget_data = content
                    missing_labels = {
                        "devices_households": "number of devices/households",
                        "baseline_fuel_consumption_kg_yr": "baseline fuel consumption (kg/yr)",
                    }
                    nice_names = [missing_labels.get(m, m) for m in missing]
                    assistant_response = (
                        f"{yield_msg}\n\n"
                        f"I've pre-filled what I could from our conversation. "
                        f"To calculate emission reductions I still need: **{', '.join(nice_names)}**. "
                        "Can you provide these?"
                    )
            except Exception as exc:
                logger.error("Carbon tool failed: %s", exc, exc_info=True)
                assistant_response = (
                    "I wasn't able to build the carbon emissions model right now. Could you provide more details about the project?"
                )

        elif action == "propose_input_value":
            project_context = await self.chat_service.build_project_context_with_assumptions(initiative)
            history_dicts = self.chat_service._chat_history_to_dicts(chat_history)
            user_message = self.chat_service._extract_last_user_message(chat_history, params)
            active_field_context = field_context or {
                "field_name": params.get("field_name"),
                "label": params.get("label"),
                "current_value": params.get("current_value"),
                "unit": params.get("unit"),
                "model_type": params.get("model_type"),
                "assessment_id": params.get("assessment_id"),
                "status": params.get("status"),
            }
            _log_proposal_debug(
                "execute-project-action",
                action=action,
                field_name=active_field_context.get("field_name"),
                has_model_inputs_context=bool(model_inputs_context),
            )

            try:
                research_result = await self.chat_service.generate_response(
                    user_message=user_message,
                    history=history_dicts,
                    project_context=project_context or None,
                    model_inputs_context=model_inputs_context,
                    field_context=active_field_context,
                    on_thinking=on_thinking,
                )
                assistant_response = research_result.content
                sources = research_result.sources
                if research_result.widget_type == "proposed_value":
                    widget_type = research_result.widget_type
                    widget_data = research_result.widget_data
                    _log_proposal_debug(
                        "execute-project-action-widget",
                        field_name=active_field_context.get("field_name"),
                        source="generate_response",
                        proposed_value=(widget_data or {}).get("proposed_value") if widget_data else None,
                    )
                elif model_inputs_context:
                    proposal = await self.chat_service._extract_value_proposal(
                        answer_text=assistant_response,
                        user_message=user_message,
                        model_inputs_context=model_inputs_context,
                        hint_field_name=params.get("field_name"),
                        hint_model_type=params.get("model_type", "lcoe"),
                        current_value=self.chat_service._resolve_current_value(
                            active_field_context,
                            model_inputs_context,
                        ),
                        require_distinct=self.chat_service._requires_distinct_proposal(
                            user_message,
                            active_field_context,
                        ),
                    )
                    if proposal:
                        widget_type = "proposed_value"
                        widget_data = proposal
                        _log_proposal_debug(
                            "execute-project-action-widget",
                            field_name=active_field_context.get("field_name"),
                            source="extract_value_proposal",
                            proposed_value=proposal.get("proposed_value"),
                        )
            except Exception as exc:
                logger.error("propose_input_value action failed: %s", exc, exc_info=True)
                assistant_response = params.get("message", "I wasn't able to research this value right now.")

        already_saved = {"lcoe_output", "lcoe_inputs", "carbon_output", "carbon_inputs"}
        widget_type_to_tool_id: dict[str, str] = {
            "solar_output": "solar_estimate",
            "solar_inputs": "solar_estimate",
        }
        if (
            widget_type
            and widget_type not in already_saved
            and widget_data
            and isinstance(widget_data, dict)
        ):
            from app.assessments.registry import get_assessment_registry
            from app.services import assessment_service

            registry = get_assessment_registry()
            tool_id = widget_type_to_tool_id.get(widget_type, "")
            tool = registry.get_assessment(tool_id)
            if tool and tool.is_exportable(widget_data):
                title = tool.definition.name
                if widget_type == "solar_output":
                    annual = (widget_data.get("result") or {}).get("annual_kwh")
                    if annual:
                        title = f"Solar Estimate ({annual:,.0f} kWh/yr)"
                await assessment_service.save_deliverable(
                    self.chat_service.db,
                    initiative.id,
                    tool_id,
                    title,
                    tool.definition.output_type,
                    widget_data,
                    user_id=self.chat_service.user_id or initiative.user_id,
                    chat_id=self.chat_service.ctx.chat_id,
                )

        return widget_type, widget_data, assistant_response, sources
