"""Chat service for research, orchestration, and response composition."""

import asyncio
import json
import logging
import time
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.execution_context import ExecutionContext

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.services.assumptions import (
    AssumptionActor,
    extract_assumptions_from_cited_chat_sources,
    format_assumptions_for_initiative_prompt,
)
from app.services.chat.generation import ChatGenerationMixin
from app.services.chat.planning import ChatPlanningMixin
from app.services.chat.types import ChatResponse, ResearchStepCallback, ThinkingCallback
from app.services.tiered_retrieval import (
    RetrievedFact,
    SourceType,
    TieredRetrievalService,
)

settings = get_settings()
logger = logging.getLogger(__name__)


def _log_proposal_debug(event: str, **fields: Any) -> None:
    serialized = " ".join(f"{key}={value!r}" for key, value in fields.items())
    logger.info("[proposal-debug] %s %s", event, serialized)


class ChatService(ChatPlanningMixin, ChatGenerationMixin):
    """
    Orchestrates compliance chat using a plan-then-retrieve-then-generate loop.

    Step 1  — Plan which retrieval tools to call
    Step 2  — Execute selected retrieval tools in parallel
    Step 3  — Generate final answer using all gathered evidence
    Step 4  — Filter returned sources to only those cited in the answer
    """

    def __init__(
        self,
        db: AsyncSession,
        ctx: "ExecutionContext",
    ):
        self.db = db
        if ctx is None:
            raise ValueError("ChatService requires ExecutionContext")
        self.user_id = ctx.user_id
        self.ctx = ctx
        self._client: AsyncOpenAI | None = None
        self._is_byok: bool = False
        self.retrieval = TieredRetrievalService(db, user_id=self.user_id)
        from app.services.project_chat_router import ProjectChatRouter
        from app.services.project_tool_executor import ProjectToolExecutor

        self.project_router = ProjectChatRouter(self)
        self.project_tool_executor = ProjectToolExecutor(self)

    async def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client, self._is_byok = await get_openai_client(self.user_id, self.db)
        return self._client

    def _build_tool_context(
        self,
        *,
        project_id: str | None = None,
        onboarding_mode: bool = False,
        orchestration_mode: bool = False,
        field_context: dict[str, Any] | None = None,
        assessment_context: dict[str, Any] | None = None,
    ):
        from app.capabilities.registry import CapabilityRoute, CapabilityToolContext

        if orchestration_mode:
            route = CapabilityRoute.PROJECT_ORCHESTRATION
        elif project_id:
            route = CapabilityRoute.PROJECT_CHAT
        else:
            route = CapabilityRoute.STANDALONE_CHAT

        return CapabilityToolContext(
            route=route,
            project_id=project_id,
            onboarding_mode=onboarding_mode,
            has_field_context=bool(field_context),
            has_assessment_context=bool(assessment_context),
        )

    def _get_tool_list(
        self,
        *,
        project_id: str | None = None,
        onboarding_mode: bool = False,
        orchestration_mode: bool = False,
        field_context: dict[str, Any] | None = None,
        assessment_context: dict[str, Any] | None = None,
    ) -> list[dict]:
        """Return OpenAI tool definitions for the current chat turn context."""
        from app.capabilities.registry import get_capability_registry

        return get_capability_registry().tools_for(
            self._build_tool_context(
                project_id=project_id,
                onboarding_mode=onboarding_mode,
                orchestration_mode=orchestration_mode,
                field_context=field_context,
                assessment_context=assessment_context,
            )
        )

    async def generate_response(
        self,
        user_message: str,
        history: list[dict[str, str]],
        on_thinking: ThinkingCallback | None = None,
        *,
        project_context: str | None = None,
        tool_hint: str | None = None,
        model_inputs_context: str | None = None,
        assessment_context: dict[str, Any] | None = None,
        field_context: dict[str, Any] | None = None,
        on_research_step: ResearchStepCallback | None = None,
        project_id: str | None = None,
        initiative: Any | None = None,
        compare_contexts: list[dict] | None = None,
        active_editor_doc: dict[str, Any] | None = None,
    ) -> ChatResponse:
        start = time.time()

        if compare_contexts:
            return await self._generate_compare_response(
                user_message, history, compare_contexts,
                on_thinking=on_thinking, on_research_step=on_research_step,
                start_time=start,
            )

        active_editor_doc_block = (
            self._format_active_editor_doc_block(active_editor_doc)
            if active_editor_doc
            else None
        )

        _log_proposal_debug(
            "generate-response-start",
            chat_scope="project" if project_id else "standalone",
            field_name=(field_context or {}).get("field_name"),
            has_field_context=bool(field_context),
            has_model_inputs_context=bool(model_inputs_context),
            has_assessment_context=bool(assessment_context),
            tool_hint=tool_hint,
            project_id=project_id,
        )

        async def _think(text: str) -> None:
            if on_thinking:
                await on_thinking(text)

        async def _step(step_id: str, label: str, status: str) -> None:
            if on_research_step:
                await on_research_step(step_id, label, status)

        # Step 1: build normalized queries and ask planner which tools to call
        search_query = await self._build_search_query(user_message, history, project_context=project_context)
        external_search_query = await self._build_external_search_query(
            user_message,
            history,
            field_context=field_context,
        )
        should_run_scholarly = self._should_run_scholarly_search(field_context)

        async def _evidence_search() -> list[RetrievedFact]:
            if not project_id:
                return []
            from uuid import UUID as _UUID
            try:
                iid = _UUID(project_id)
            except ValueError:
                return []
            facts = await self.retrieval.search_evidence(search_query, iid, evidence_top_k=12)
            if not facts:
                facts = await self.retrieval.search_project_materials(search_query, iid)
            return facts

        await _step("plan_tools", "Planning evidence retrieval", "running")
        tool_calls = await self._plan_tool_calls(
            user_message,
            history,
            model_inputs_context=model_inputs_context,
            assessment_context=assessment_context,
            project_context=project_context,
            project_id=project_id,
        )
        await _step("plan_tools", "Evidence retrieval plan ready", "done")

        all_facts: list[RetrievedFact] = []
        tiers_used: list[str] = []

        # Step 2: execute requested tools — search tools run in parallel
        widget_type: str | None = None
        widget_data: dict | None = None

        async def _execute_generate_project_plan() -> None:
            nonlocal widget_type, widget_data
            if initiative is None:
                logger.warning("Planner requested generate_project_plan without initiative context")
                return
            from app.plans.registry import get_plan_registry

            plan_handler = get_plan_registry().default_handler(self.db, self.user_id)
            structure = await plan_handler.propose_structure(
                initiative=initiative,
                chat_history=None,
            )
            widget_type = plan_handler.definition.structure_widget_type
            widget_data = plan_handler.build_structure_widget_data(structure)

        async def _execute_update_project_plan(user_request: str) -> None:
            nonlocal widget_type, widget_data
            if initiative is None:
                logger.warning("Planner requested update_project_plan without initiative context")
                return
            from app.plans.registry import get_plan_registry
            from sqlalchemy.orm.attributes import flag_modified

            plan_handler = get_plan_registry().default_handler(self.db, self.user_id)
            existing_plan = initiative.project_plan
            plan_data = await plan_handler.generate_plan(
                initiative=initiative,
                existing_plan=existing_plan,
                user_request=user_request,
            )
            initiative.project_plan = plan_data
            flag_modified(initiative, "project_plan")
            await self.db.commit()
            await self.db.refresh(initiative)
            widget_type = plan_handler.definition.summary_widget_type
            widget_data = plan_handler.build_summary_widget_data(plan_data)

        # Parse all tool calls
        parsed_calls: list[tuple[str, dict]] = []
        for tool_call in tool_calls:
            fn_name = tool_call.function.name
            try:
                args = json.loads(tool_call.function.arguments)
            except Exception:
                args = {}
            reason = args.get("reason", "")
            logger.info(f"Tool called: {fn_name} | query={args.get('query', '')!r} | reason={reason!r}")
            parsed_calls.append((fn_name, args))

        is_investigate_request = bool(field_context) or self._is_investigate_request(user_message)
        _log_proposal_debug(
            "investigate-detected",
            field_name=(field_context or {}).get("field_name"),
            is_investigate_request=is_investigate_request,
            parsed_calls=[fn_name for fn_name, _ in parsed_calls],
        )

        if is_investigate_request:
            existing_tools = {fn_name for fn_name, _ in parsed_calls}
            if "search_project_documents" not in existing_tools:
                parsed_calls.insert(
                    0,
                    (
                        "search_project_documents",
                        {
                            "query": external_search_query,
                            "reason": "Investigate requests should first check project documents for relevant data.",
                        },
                    ),
                )
            if "search_workspace_context" not in existing_tools:
                insert_pos = 1 if parsed_calls and parsed_calls[0][0] == "search_project_documents" else 0
                parsed_calls.insert(
                    insert_pos,
                    (
                        "search_workspace_context",
                        {
                            "query": external_search_query,
                            "reason": "Investigate requests should check workspace knowledge banks for organisational context.",
                        },
                    ),
                )
            if not any(
                fn_name in {"search_scholarly_literature", "search_web_sources"}
                for fn_name in existing_tools
            ):
                if should_run_scholarly:
                    parsed_calls.append(
                        (
                            "search_scholarly_literature",
                            {
                                "query": external_search_query,
                                "reason": "Investigate requests should be grounded in external benchmarks when available.",
                            },
                        )
                    )
                parsed_calls.append(
                    (
                        "search_web_sources",
                        {
                            "query": external_search_query,
                            "reason": "Investigate requests should cite current institutional or industry references when available.",
                        },
                    )
                )

        # Run search tools (scholarly + web) concurrently
        async def _run_scholarly(query: str) -> list[RetrievedFact]:
            await _step("search_scholarly", "Searching scholarly databases", "running")
            await _think("Searching scholarly databases for relevant evidence...")
            facts = await self.retrieval.search_openalex(query)
            if facts:
                await _think(f"Found {len(facts)} scholarly works")
                await _step("search_scholarly", f"Found {len(facts)} scholarly works", "done")
            else:
                await _think("No relevant scholarly works found")
                await _step("search_scholarly", "No scholarly works found", "done")
            return facts

        async def _run_web(query: str) -> list[RetrievedFact]:
            await _step("search_web", "Searching web sources", "running")
            await _think("Searching web sources...")
            facts = await self.retrieval.search_web(query)
            if facts:
                await _think(f"Found {len(facts)} web sources")
                await _step("search_web", f"Found {len(facts)} web sources", "done")
            else:
                await _think("No web sources found")
                await _step("search_web", "No web sources found", "done")
            return facts

        async def _run_project_documents(query: str) -> list[RetrievedFact]:
            await _step("scan_docs", "Scanning project documents", "running")
            await _think("Scanning project documents for relevant sections...")
            doc_facts = await _evidence_search()
            if doc_facts:
                await _think(f"Found {len(doc_facts)} relevant sections in project documents")
                await _step("scan_docs", f"Found {len(doc_facts)} relevant sections", "done")
            else:
                await _think("No matching sections in project documents")
                await _step("scan_docs", "No matching document sections", "done")
            return doc_facts

        async def _run_workspace_context(query: str) -> list[RetrievedFact]:
            if initiative is None or not getattr(initiative, "workspace_id", None):
                return []
            await _step("scan_workspace_context", "Scanning workspace context", "running")
            await _think("Scanning workspace-level guidance and knowledge banks...")
            facts = await self.retrieval.search_workspace_context(
                query=query,
                workspace_id=initiative.workspace_id,
                user_id=self.user_id,
            )
            if facts:
                await _think(f"Found {len(facts)} workspace context sources")
                await _step("scan_workspace_context", f"Found {len(facts)} workspace context sources", "done")
            else:
                await _think("No matching workspace context found")
                await _step("scan_workspace_context", "No matching workspace context", "done")
            return facts

        async def _run_country_indicators(query: str) -> list[RetrievedFact]:
            await _step("search_country_indicators", "Retrieving country indicators", "running")
            await _think("Retrieving World Bank country indicators...")
            facts = await self.retrieval.search_worldbank_indicators(query)
            if facts:
                await _think(f"Found {len(facts)} country indicator records")
                await _step("search_country_indicators", f"Found {len(facts)} country indicator records", "done")
            else:
                await _think("No country indicators found")
                await _step("search_country_indicators", "No country indicators found", "done")
            return facts

        async def _run_institutional_reports(query: str) -> list[RetrievedFact]:
            await _step("search_institutional_reports", "Searching institutional reports", "running")
            await _think("Searching World Bank institutional reports...")
            facts = await self.retrieval.search_worldbank_documents(query)
            if facts:
                await _think(f"Found {len(facts)} institutional reports")
                await _step("search_institutional_reports", f"Found {len(facts)} institutional reports", "done")
            else:
                await _think("No institutional reports found")
                await _step("search_institutional_reports", "No institutional reports found", "done")
            return facts

        async def _run_comparable_projects(query: str) -> list[RetrievedFact]:
            await _step("search_comparable_projects", "Searching comparable projects", "running")
            await _think("Searching World Bank comparable projects...")
            facts = await self.retrieval.search_worldbank_projects(query)
            if facts:
                await _think(f"Found {len(facts)} comparable projects")
                await _step("search_comparable_projects", f"Found {len(facts)} comparable projects", "done")
            else:
                await _think("No comparable projects found")
                await _step("search_comparable_projects", "No comparable projects found", "done")
            return facts

        async def _run_funding_activity(query: str) -> list[RetrievedFact]:
            await _step("search_funding_activity", "Searching funding activity", "running")
            await _think("Searching IATI funding activity...")
            facts = await self.retrieval.search_iati(query)
            if facts:
                await _think(f"Found {len(facts)} funding activity records")
                await _step("search_funding_activity", f"Found {len(facts)} funding activity records", "done")
            else:
                await _think("No funding activity records found")
                await _step("search_funding_activity", "No funding activity records found", "done")
            return facts

        search_tasks = []
        search_labels = []
        for fn_name, args in parsed_calls:
            tool_query = self._normalize_external_tool_query(
                args.get("query"),
                external_search_query,
            )
            if fn_name == "search_scholarly_literature":
                if not should_run_scholarly:
                    continue
                search_tasks.append(_run_scholarly(tool_query))
                search_labels.append("openalex")
            elif fn_name == "search_project_documents":
                search_tasks.append(_run_project_documents(tool_query))
                search_labels.append("evidence")
            elif fn_name == "search_workspace_context":
                search_tasks.append(_run_workspace_context(tool_query))
                search_labels.append("workspace_context")
            elif fn_name == "search_web_sources":
                search_tasks.append(_run_web(tool_query))
                search_labels.append("web")
            elif fn_name == "search_country_indicators":
                search_tasks.append(_run_country_indicators(tool_query))
                search_labels.append("worldbank_indicator")
            elif fn_name == "search_institutional_reports":
                search_tasks.append(_run_institutional_reports(tool_query))
                search_labels.append("worldbank_document")
            elif fn_name == "search_comparable_projects":
                search_tasks.append(_run_comparable_projects(tool_query))
                search_labels.append("worldbank_project")
            elif fn_name == "search_funding_activity":
                search_tasks.append(_run_funding_activity(tool_query))
                search_labels.append("iati_activity")

        if search_tasks:
            search_results = await asyncio.gather(*search_tasks)
            for label, facts in zip(search_labels, search_results):
                if facts:
                    all_facts.extend(facts)
                    tiers_used.append(label)

        requires_distinct_proposal = self._requires_distinct_proposal(user_message, field_context)
        planner_candidate_widget_data: dict[str, Any] | None = None

        # Assessments (LCOE / carbon / solar) live in the editor workspace — not chat.
        # If the planner calls a model tool, acknowledge it but do not execute inline.
        for fn_name, args in parsed_calls:
            if fn_name in ("run_lcoe", "run_carbon", "run_solar"):
                label_map = {
                    "run_lcoe": "LCOE",
                    "run_carbon": "Carbon",
                    "run_solar": "Solar",
                }
                await _think(f"{label_map.get(fn_name, 'Model')} calculation queued — use the editor workspace to interact with the model.")

            elif fn_name == "generate_project_plan":
                await _think("Generating your project plan...")
                try:
                    await _execute_generate_project_plan()
                except Exception as e:
                    logger.error(f"Project plan generation failed: {e}", exc_info=True)

            elif fn_name == "update_project_plan":
                await _think("Updating your project plan...")
                try:
                    await _execute_update_project_plan(args.get("user_request", ""))
                except Exception as e:
                    logger.error(f"Project plan update failed: {e}", exc_info=True)

            elif fn_name == "propose_input_value":
                await _think(f"Proposing value for {args.get('field_name', 'field')}...")
                planner_candidate_widget_data = {
                    "field_name": args.get("field_name", ""),
                    "label": "",
                    "unit": "",
                    "proposed_value": args.get("proposed_value"),
                    "model_type": args.get("model_type", "lcoe"),
                    "confidence": args.get("confidence", "moderate"),
                    "explanation": args.get("reason", ""),
                }
                if model_inputs_context:
                    planner_candidate_widget_data = self._enrich_proposal_from_context(
                        planner_candidate_widget_data,
                        model_inputs_context,
                    )
                if requires_distinct_proposal and self._proposal_matches_current(
                    planner_candidate_widget_data,
                    field_context,
                ):
                    await _think("Looking for an alternative to the current value...")

            elif fn_name == "propose_template_value":
                req_label = args.get("requirement_label", "requirement")
                await _think(f"Researching: {req_label[:60]}...")
                can_determine = args.get("can_be_determined", True)
                proposed = args.get("proposed_value", "")
                widget_type = "template_proposed_value"
                widget_data = {
                    "requirement_label": req_label,
                    "field_type": args.get("field_type", "text"),
                    "proposed_value": proposed,
                    "can_be_determined": can_determine,
                    "confidence": args.get("confidence", "moderate"),
                    "explanation": args.get("reason", ""),
                }

        # Track propose intent (field_name set by planner if it called propose_input_value)
        propose_field_name: str | None = field_context.get("field_name") if field_context else None
        propose_model_type: str = (field_context or {}).get("model_type") or "lcoe"
        for fn_name, args in parsed_calls:
            if fn_name == "propose_input_value":
                propose_field_name = args.get("field_name") or None
                propose_model_type = args.get("model_type", "lcoe")

        # Step 4: generate answer — LLM only sees what was actually retrieved
        ranked_facts = self._rank_facts(all_facts)
        source_count = len([f for f in ranked_facts if f.source_type != SourceType.LLM_ESTIMATE])

        await _step("analyze_sources", f"Analyzing {source_count} sources" if source_count else "Generating response", "running")
        if source_count > 0:
            await _think(f"Generating response from {source_count} sources...")
        else:
            await _think("Generating response...")

        # For propose requests: use the full research context to generate the answer,
        # then extract the concrete proposal from the text afterward.
        is_propose_request = widget_type == "proposed_value" or is_investigate_request
        _log_proposal_debug(
            "proposal-branch",
            field_name=(field_context or {}).get("field_name"),
            is_propose_request=is_propose_request,
            has_model_inputs_context=bool(model_inputs_context),
            planner_candidate=bool(planner_candidate_widget_data),
        )

        if is_propose_request and model_inputs_context:
            synthesized_proposal = await self._synthesize_value_proposal(
                user_message=user_message,
                model_inputs_context=model_inputs_context,
                facts=ranked_facts,
                project_context=project_context,
                field_context=field_context,
                planner_candidate=planner_candidate_widget_data,
            )
            if synthesized_proposal:
                widget_type = "proposed_value"
                widget_data = synthesized_proposal
                _log_proposal_debug(
                    "proposal-synthesized",
                    field_name=(field_context or {}).get("field_name"),
                    proposed_value=synthesized_proposal.get("proposed_value"),
                )
            else:
                _log_proposal_debug(
                    "proposal-synthesized-miss",
                    field_name=(field_context or {}).get("field_name"),
                )

        if widget_type == "template_proposed_value" and widget_data:
            content = await self._generate_template_investigate_answer(
                user_message, history, widget_data, ranked_facts, project_context=project_context,
            )
        elif widget_type and widget_data and widget_type.startswith("carbon_"):
            content = await self._generate_carbon_answer(
                user_message, history, widget_data, ranked_facts
            )
        elif widget_type and widget_data and widget_type.startswith("lcoe_"):
            content = await self._generate_lcoe_answer(
                user_message, history, widget_data, ranked_facts
            )
        elif widget_type == "tool_checklist" and widget_data:
            recommendations = widget_data.get("recommendations") or []
            if isinstance(recommendations, list):
                recommended_count = len([
                    recommendation
                    for recommendation in recommendations
                    if isinstance(recommendation, dict) and recommendation.get("recommended")
                ])
                count_label = recommended_count or len(recommendations)
            else:
                count_label = 0
            if count_label > 0:
                assessment_label = "assessment" if count_label == 1 else "assessments"
                content = (
                    f"I've mapped the {count_label} {assessment_label} that look most relevant for this "
                    "project. Review them below and confirm the framework plan you want to start with."
                )
            else:
                content = (
                    "I've mapped the framework assessments that look most relevant for this project. "
                    "Review them below and confirm the framework plan you want to start with."
                )
        elif is_propose_request:
            content = await self._generate_investigate_answer(
                user_message,
                history,
                ranked_facts,
                project_context=project_context,
                model_inputs_context=model_inputs_context,
                field_context=field_context,
                proposal=widget_data,
                active_editor_doc_block=active_editor_doc_block,
            )
        else:
            combined_context = project_context or ""
            if assessment_context:
                assessment_id = assessment_context.get("assessment_id") or assessment_context.get("assessmentId") or "unknown"
                assessment_title = assessment_context.get("title") or ""
                assessment_instance = assessment_context.get("instance_id") or assessment_context.get("instanceId") or ""
                assessment_lines = [f"- assessment_id: {assessment_id}"]
                if assessment_title:
                    assessment_lines.append(f"- title: {assessment_title}")
                if assessment_instance:
                    assessment_lines.append(f"- instance_id: {assessment_instance}")
                assessment_block = "## Active Assessment Workspace\n" + "\n".join(assessment_lines)
                combined_context = f"{combined_context}\n\n{assessment_block}" if combined_context else assessment_block
            if model_inputs_context:
                combined_context = f"{combined_context}\n\n## Current Model Inputs\n{model_inputs_context}" if combined_context else f"## Current Model Inputs\n{model_inputs_context}"
            content = await self._generate_answer(
                user_message, history, ranked_facts,
                project_context=combined_context or None,
                active_editor_doc_block=active_editor_doc_block,
            )

        # Step 4b: if this was an investigate/propose request, extract a structured
        # proposal from the generated text so we can show a confirm widget.
        if is_propose_request and model_inputs_context and not widget_type:
            proposal = await self._extract_value_proposal(
                answer_text=content,
                user_message=user_message,
                model_inputs_context=model_inputs_context,
                hint_field_name=propose_field_name,
                hint_model_type=propose_model_type,
                current_value=self._resolve_current_value(field_context, model_inputs_context),
                require_distinct=requires_distinct_proposal,
            )
            if proposal:
                widget_type = "proposed_value"
                widget_data = proposal
                _log_proposal_debug(
                    "proposal-extracted",
                    field_name=(field_context or {}).get("field_name"),
                    proposed_value=proposal.get("proposed_value"),
                )
                content = await self._generate_investigate_answer(
                    user_message,
                    history,
                    ranked_facts,
                    project_context=project_context,
                    model_inputs_context=model_inputs_context,
                    field_context=field_context,
                    proposal=widget_data,
                    active_editor_doc_block=active_editor_doc_block,
                )

            else:
                _log_proposal_debug(
                    "proposal-extracted-miss",
                    field_name=(field_context or {}).get("field_name"),
                )

        await _step("analyze_sources", "Analysis complete", "done")

        # Step 5: return only sources that appear cited in the response
        cited_sources = self._extract_cited_sources(content, ranked_facts)
        if initiative is not None and cited_sources:
            try:
                await extract_assumptions_from_cited_chat_sources(
                    self.db,
                    initiative,
                    cited_sources,
                    answer_content=content,
                    actor=AssumptionActor(user_id=self.user_id, email=self.ctx.user_email),
                    user_message=user_message,
                    chat_id=str(self.ctx.chat_id) if self.ctx.chat_id else None,
                )
            except Exception as exc:
                logger.warning("Chat assumption extraction failed: %s", exc, exc_info=True)

        # Step 5b: attach provenance to proposed_value widget data
        if widget_type == "proposed_value" and widget_data:
            from app.schemas.provenance import (
                Derivation,
                ItemProvenance,
                source_attribution_from_retrieved_fact,
            )
            source_attrs = [
                source_attribution_from_retrieved_fact(s).model_dump()
                for s in cited_sources
                if s.source_type != SourceType.LLM_ESTIMATE
            ]
            from app.schemas.provenance import SourceAttribution as _SA
            derivation = Derivation.RESEARCHED if source_attrs else Derivation.INFERRED
            widget_data["provenance"] = ItemProvenance(
                derivation=derivation,
                sources=[_SA(**sa) for sa in source_attrs],
                rationale=widget_data.get("explanation", ""),
            ).model_dump()

        elapsed_ms = int((time.time() - start) * 1000)
        _log_proposal_debug(
            "generate-response-complete",
            field_name=(field_context or {}).get("field_name"),
            widget_type=widget_type,
            has_widget_data=bool(widget_data),
            elapsed_ms=elapsed_ms,
        )
        return ChatResponse(
            content=content,
            sources=cited_sources,
            tiers_used=tiers_used,
            latency_ms=elapsed_ms,
            widget_type=widget_type,
            widget_data=widget_data,
        )

    # -----------------------------------------------------------------------
    # Compare mode
    # -----------------------------------------------------------------------

    @staticmethod
    @classmethod
    @staticmethod
    @classmethod
    @classmethod
    @staticmethod
    @staticmethod
    @staticmethod
    @classmethod
    @staticmethod
    @staticmethod
    @staticmethod
    @staticmethod
    @staticmethod
    @staticmethod
    # ===================================================================
    # PROJECT mode — orchestration logic (migrated from OrchestrationService)
    # ===================================================================

    async def extract_inputs_from_message(
        self,
        message: str,
        initiative,
    ) -> dict[str, Any]:
        """Extract project inputs from a user message using structured extraction."""
        input_schema = {
            "project_title": {"type": "string", "description": "Short descriptive title for the project (3-6 words)"},
            "geography": {"type": "string", "description": "Location/country/region/state"},
            "project_description": {"type": "string", "description": "Brief description of the project"},
            "project_type": {"type": "string", "description": "Type/sector (e.g. solar, wind, reforestation, water treatment, clean cooking)"},
            "technology": {"type": "string", "description": "Specific technology if mentioned (e.g. crystalline silicon PV, biomass gasifier)"},
        }
        try:
            client = await self._get_client()
            response = await client.chat.completions.create(
                model=settings.openai_orchestration_model,
                messages=[
                    {
                        "role": "system",
                        "content": "Extract project information from this message. Only include fields that are clearly stated or can be directly inferred. Leave out fields that aren't mentioned.",
                    },
                    {"role": "user", "content": message},
                ],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "extract_inputs",
                        "description": "Extract inputs from the message",
                        "parameters": {
                            "type": "object",
                            "properties": input_schema,
                        },
                    },
                }],
                tool_choice={"type": "function", "function": {"name": "extract_inputs"}},
            )
            await record_usage_from_response(
                self.user_id, settings.openai_orchestration_model, response,
                self.db, is_byok=self._is_byok,
            )
            tool_call = response.choices[0].message.tool_calls[0]
            extracted = json.loads(tool_call.function.arguments)
            return {k: v for k, v in extracted.items() if v}
        except Exception as e:
            logger.error(f"Input extraction failed: {e}")
            return {}

    # -----------------------------------------------------------------------
    # PROJECT-mode helpers
    # -----------------------------------------------------------------------

    @staticmethod
    def _format_model_inputs_from_messages(
        messages: list,
        field_context: dict[str, Any] | None = None,
    ) -> str:
        """Extract the latest LCOE/carbon/solar widget_data from messages and format for the LLM."""
        latest_lcoe = None
        latest_carbon = None
        latest_solar = None
        for msg in reversed(messages):
            if msg.widget_type in ("lcoe_inputs", "lcoe_output") and msg.widget_data:
                if latest_lcoe is None:
                    latest_lcoe = msg.widget_data
            if msg.widget_type in ("carbon_inputs", "carbon_output") and msg.widget_data:
                if latest_carbon is None:
                    latest_carbon = msg.widget_data
            if msg.widget_type in ("solar_inputs", "solar_output") and msg.widget_data:
                if latest_solar is None:
                    latest_solar = msg.widget_data

        parts: list[str] = []
        active_field_block = ChatService._format_active_field_context(field_context)
        if active_field_block:
            parts.append(active_field_block)

        for label, wd in [
            ("LCOE Model", latest_lcoe),
            ("Carbon Model", latest_carbon),
            ("Solar Model", latest_solar),
        ]:
            if not wd:
                continue
            inputs = wd.get("inputs", {})
            if not inputs:
                continue
            lines = [f"### {label} Inputs"]
            for field_name, inp in inputs.items():
                val = inp.get("value")
                status = inp.get("status", "unknown")
                unit = inp.get("unit", "")
                inp_label = inp.get("label", field_name)
                val_str = f"{val}" if val is not None else "—"
                prov = inp.get("provenance") or {}
                derivation = prov.get("derivation", "")
                rationale = prov.get("rationale", "") or inp.get("rationale", "")
                prov_str = ""
                if derivation:
                    prov_str += f" derivation={derivation}"
                if rationale:
                    prov_str += f' reason="{rationale}"'
                lines.append(
                    f"- {inp_label} (field_name={field_name}): {val_str} {unit} [{status}{prov_str}]"
                )
            missing = wd.get("missing_essentials", [])
            if missing:
                nice = [inputs.get(m, {}).get("label", m) for m in missing]
                lines.append(f"⚠ Missing essentials: {', '.join(nice)}")
            parts.append("\n".join(lines))

        return "\n\n".join(parts)

    @staticmethod
    def _build_project_context(initiative) -> str:
        """Build a project context string to inject into the research assistant."""
        parts: list[str] = []
        if initiative.title:
            parts.append(f"- Title: {initiative.title}")
        if initiative.project_type:
            parts.append(f"- Project type: {initiative.project_type}")
        if initiative.project_description:
            parts.append(f"- Description: {initiative.project_description[:600]}")
        if initiative.geography:
            parts.append(f"- Geography: {initiative.geography}")
        if initiative.selected_tools:
            parts.append(f"- Selected tools/frameworks: {', '.join(initiative.selected_tools)}")
        if initiative.goal:
            parts.append(f"- Goal: {initiative.goal}")
        return "\n".join(parts) if parts else ""

    async def build_project_context_with_assumptions(self, initiative) -> str:
        base = self._build_project_context(initiative)
        assumptions_text = await format_assumptions_for_initiative_prompt(self.db, initiative.id)
        if not assumptions_text:
            return base
        return f"{base}\n{assumptions_text}" if base else assumptions_text

    @staticmethod
    def _chat_history_to_dicts(chat_history: list | None) -> list[dict[str, str]]:
        """Convert ChatMessage list to plain dicts, dropping the last user message."""
        if not chat_history:
            return []
        dicts = [
            {"role": m.role, "content": m.content}
            for m in chat_history[-20:]
            if m.role in ("user", "assistant")
        ]
        if dicts and dicts[-1]["role"] == "user":
            dicts = dicts[:-1]
        return dicts

    @staticmethod
    def _extract_last_user_message(chat_history: list | None, params: dict) -> str:
        """Get the most recent user message from history, falling back to params."""
        if chat_history:
            for m in reversed(chat_history):
                if m.role == "user":
                    return m.content
        return params.get("message", "")
