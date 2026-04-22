"""Register all built-in capabilities into the CapabilityRegistry.

Each entry from ORCHESTRATION_ACTIONS and SEARCH_TOOLS is migrated here.
Modules from ModuleRegistry and prompts from PromptRegistry also get entries.
"""

from app.capabilities.registry import CapabilityEntry, CapabilityKind, CapabilityRegistry


def register_all(registry: CapabilityRegistry) -> None:
    """Called once when the singleton registry is created."""
    _register_orchestration_tools(registry)
    _register_standalone_tools(registry)
    _register_modules(registry)
    _register_prompts(registry)
    _register_adapters(registry)
    _register_resources(registry)
    _register_canonical_aliases(registry)


# ---------------------------------------------------------------------------
# Orchestration-surface tools (project-plan side chat)
# ---------------------------------------------------------------------------

def _register_orchestration_tools(registry: CapabilityRegistry) -> None:
    registry.register(CapabilityEntry(
        id="send_message",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Send Message",
        description="Send a conversational message to the user.",
        surfaces=["orchestration"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "send_message",
                "description": "Send a conversational message to the user. Use for answering questions, acknowledging info, or general conversation. No widget is shown.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "The message to send. Keep it concise (1-3 sentences).",
                        }
                    },
                    "required": ["message"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="ask_for_documents",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Ask for Documents",
        description="Ask the user to upload relevant project documents.",
        surfaces=["orchestration"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "ask_for_documents",
                "description": "Ask the user to upload relevant project documents that will improve the project plan. Use this in the first exchange alongside acknowledging the project.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Message asking for documents. Be specific about what types would help for THIS project (e.g. feasibility study, site assessment, permit applications).",
                        },
                        "suggested_types": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Types of documents that would be helpful",
                        },
                    },
                    "required": ["message"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="ask_clarifying_questions",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Ask Clarifying Questions",
        description="Ask targeted clarifying questions when critical project information is missing.",
        surfaces=["orchestration"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "ask_clarifying_questions",
                "description": "Ask 1-2 targeted clarifying questions when critical project information is missing. Only use when geography OR project type/technology is truly ambiguous.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Message with 1-2 specific questions. Be direct and explain why you need this info.",
                        },
                        "fields_needed": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Names of the missing fields (e.g. 'geography', 'project_type', 'technology')",
                        },
                    },
                    "required": ["message", "fields_needed"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="generate_project_plan",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Generate Project Plan",
        description="Generate the project plan when enough context is available.",
        surfaces=["orchestration", "project"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "generate_project_plan",
                "description": "Generate the project plan. Use this when you have enough information: at minimum a project description with identifiable geography and project type/technology.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Brief message (1 sentence) telling the user you're generating their project plan.",
                        }
                    },
                    "required": ["message"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="update_project_plan",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Update Project Plan",
        description="Update the existing project plan based on user-requested changes.",
        surfaces=["orchestration", "project"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "update_project_plan",
                "description": "Update the existing project plan based on the user's requested changes. Use this when a project plan already exists and the user asks to add, remove, rename, or modify sections, pillars, or items — including adding entirely new sections the user requests.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Brief message (1 sentence) confirming what changes you'll apply.",
                        },
                        "user_request": {
                            "type": "string",
                            "description": "Clear, concise summary of exactly what the user wants changed in the plan.",
                        },
                    },
                    "required": ["message", "user_request"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="run_lcoe_tool",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Run LCOE Tool",
        description="Run the LCOE model to estimate cost per kWh (orchestration variant).",
        surfaces=["orchestration"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "run_lcoe_tool",
                "description": "Run the LCOE (Levelized Cost of Energy) tool to model project economics. Use this when the user asks for LCOE, cost per kWh, project economics, feasibility analysis, or when evaluating whether an energy project is financially viable. Also use when the user mentions capex, opex, discount rate, WACC, or capacity factor in the context of project costing.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Brief message (1-2 sentences) telling the user you're building their LCOE model.",
                        }
                    },
                    "required": ["message"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="run_carbon_tool",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Run Carbon Tool",
        description="Run the Carbon Emissions Calculator (orchestration variant).",
        surfaces=["orchestration"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "run_carbon_tool",
                "description": "Run the Carbon Emissions Calculator to estimate emission reductions (tCO₂e). Use this when the user asks about carbon credits, emission reductions, baseline vs project emissions, cookstove methodology, fNRB, leakage, tCO₂e, or Gold Standard ER calculations. Also use when discussing fuel consumption savings from clean cooking or improved stove programs.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Brief message (1-2 sentences) telling the user you're building their carbon emissions model.",
                        }
                    },
                    "required": ["message"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="propose_input_value:orchestration",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Propose Input Value",
        description="Propose a value for a model input field (orchestration variant).",
        surfaces=["orchestration"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "propose_input_value",
                "description": (
                    "Propose a specific numeric value for a single model input field "
                    "(LCOE, Carbon, or Solar model). Use this when the user asks to investigate, estimate, "
                    "research, or help determine a value for a specific input field. The proposed value "
                    "will be shown in a confirmation widget that the user can accept to update the model. "
                    "ALWAYS include a concrete numeric value — never just explain the field without proposing. "
                    "If the user asks for a better, alternative, or different value, the proposal must differ "
                    "from the current value shown in the model inputs."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "2-4 sentence explanation of the proposed value: why this value, what sources/reasoning support it, and any caveats.",
                        },
                        "field_name": {
                            "type": "string",
                            "description": "The exact field_name from the model inputs (e.g. 'net_capacity_kw', 'total_capex', 'capacity_factor').",
                        },
                        "proposed_value": {
                            "type": "number",
                            "description": "The proposed numeric value for the field.",
                        },
                        "model_type": {
                            "type": "string",
                            "enum": ["lcoe", "carbon", "solar"],
                            "description": "Which model this input belongs to.",
                        },
                        "confidence": {
                            "type": "string",
                            "enum": ["high", "moderate", "low"],
                            "description": "How confident you are in this estimate.",
                        },
                    },
                    "required": ["message", "field_name", "proposed_value", "model_type", "confidence"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="propose_template_value:orchestration",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Propose Template Value",
        description="Propose a value for a template/form requirement (orchestration variant).",
        surfaces=["orchestration"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "propose_template_value",
                "description": (
                    "Propose a value (text, numeric, yes/no, date, or narrative) for a template/form "
                    "requirement field. Use when the user message contains a [TEMPLATE_CONTEXT] block "
                    "indicating they are investigating a template requirement. The response should either: "
                    "(1) propose a concrete value backed by evidence from project docs or research, OR "
                    "(2) explain why this must be gathered offline and provide specific guidance on where/how."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Brief message telling the user you're researching this requirement.",
                        },
                        "requirement_label": {
                            "type": "string",
                            "description": "The full label/question text of the requirement being investigated.",
                        },
                        "field_type": {
                            "type": "string",
                            "description": "The field type: text, number, currency, boolean, yes_no, date, narrative, formula.",
                        },
                        "category": {
                            "type": "string",
                            "description": "The category/section this requirement belongs to.",
                        },
                    },
                    "required": ["message", "requirement_label", "field_type"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="start_gs_certification",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Start GS Certification",
        description="Start the Gold Standard certification workflow.",
        surfaces=["orchestration"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "start_gs_certification",
                "description": "Start the Gold Standard (GS4GG) certification workflow. Use when the user asks about Gold Standard certification, GS4GG submission, cover letter preparation, design review, pre-monitoring requirements, or what documents are needed for Gold Standard project registration.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Brief message (1-2 sentences) telling the user you're loading the GS certification workspace.",
                        }
                    },
                    "required": ["message"],
                },
            },
        },
    ))


# ---------------------------------------------------------------------------
# Standalone-surface tools (generate / research chat)
# ---------------------------------------------------------------------------

def _register_standalone_tools(registry: CapabilityRegistry) -> None:
    registry.register(CapabilityEntry(
        id="search_scholarly_literature",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Search Scholarly Literature",
        description="Search OpenAlex for peer-reviewed academic papers.",
        surfaces=["standalone", "project"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "search_scholarly_literature",
                "description": (
                    "Search OpenAlex for peer-reviewed academic papers, research studies, and published evidence. "
                    "Good for: empirical data, case studies, impact evaluations, published methodology comparisons, "
                    "and peer-reviewed analysis of specific topics or regions."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Focused search query for scholarly literature (max 20 words).",
                        },
                        "reason": {
                            "type": "string",
                            "description": "One sentence explaining why scholarly literature helps here.",
                        },
                    },
                    "required": ["query", "reason"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="search_web_sources",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Search Web Sources",
        description="Search the web for authoritative information.",
        surfaces=["standalone", "project"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "search_web_sources",
                "description": (
                    "Search the web for information from NGOs, governments, standards bodies, news outlets, "
                    "industry reports, and other authoritative sources. Good for: current regulations, policies, "
                    "program requirements, recent developments, market data, country-specific information, "
                    "practical guidance, organizational reports, and real-world project examples."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Focused search query for web sources (max 20 words).",
                        },
                        "reason": {
                            "type": "string",
                            "description": "One sentence explaining why a web search helps here.",
                        },
                    },
                    "required": ["query", "reason"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="run_lcoe_model",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Run LCOE Model",
        description="Build an LCOE model from conversation context (standalone variant).",
        surfaces=["standalone", "project"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "run_lcoe_model",
                "description": (
                    "Build an LCOE (Levelized Cost of Energy) model to estimate cost per kWh. "
                    "ALWAYS use this when the user asks for: LCOE, levelized cost, cost of energy, "
                    "cost per kWh, project economics, financial feasibility of an energy project, "
                    "or when they mention capex/opex/discount rate/WACC/capacity factor in a project costing context. "
                    "Also use when the user says 'build me an LCOE', 'model the economics', or "
                    "'is this project viable/feasible' for an energy project. "
                    "Extract any numbers mentioned in the conversation as inputs."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "technology_type": {
                            "type": "string",
                            "description": "Energy technology: solar_pv, wind, battery, mini_grid, clean_cooking, or other. Infer from conversation.",
                        },
                        "reason": {
                            "type": "string",
                            "description": "One sentence explaining why the LCOE tool is appropriate here.",
                        },
                    },
                    "required": ["reason"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="run_carbon_model",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Run Carbon Model",
        description="Build a carbon emissions model from conversation context (standalone variant).",
        surfaces=["standalone", "project"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "run_carbon_model",
                "description": (
                    "Build a Carbon Emissions model to estimate emission reductions (tCO₂e). "
                    "ALWAYS use this when the user asks about: carbon credits, emission reductions, "
                    "tCO₂e, baseline vs project emissions, cookstove methodology, fNRB, leakage, "
                    "Gold Standard ER calculations, fuel consumption savings from clean cooking, "
                    "or 'how many credits will this project generate'. "
                    "Extract any numbers mentioned in the conversation as inputs."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "method_pack": {
                            "type": "string",
                            "description": "Methodology pack: cookstoves or other. Infer from conversation.",
                        },
                        "reason": {
                            "type": "string",
                            "description": "One sentence explaining why the carbon tool is appropriate here.",
                        },
                    },
                    "required": ["reason"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="run_solar_estimate",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Run Solar Estimate",
        description="Generate a solar PV production estimate using PVWatts.",
        surfaces=["standalone", "project"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "run_solar_estimate",
                "description": (
                    "Generate a solar PV production estimate (annual and monthly kWh) using PVWatts. "
                    "ALWAYS use this when the user asks for: solar production estimate, PV energy yield, "
                    "annual or monthly kWh for a solar installation, solar feasibility, solar output, "
                    "or mentions system capacity/tilt/azimuth/location in a solar energy context. "
                    "Also use when the user says 'estimate solar production', 'how much will this system produce', "
                    "'solar production estimate for this site', or similar. "
                    "Extract any location, capacity, orientation, and system details from the conversation."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "reason": {
                            "type": "string",
                            "description": "One sentence explaining why the solar estimate tool is appropriate here.",
                        },
                    },
                    "required": ["reason"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="propose_input_value:standalone",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Propose Input Value",
        description="Propose a value for a model input field (standalone variant).",
        surfaces=["standalone", "project"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "propose_input_value",
                "description": (
                    "Propose a specific value for a model input field (LCOE, Carbon, or Solar). "
                    "Use when the user asks to investigate, estimate, or determine a value for a "
                    "specific input (e.g. 'what should net capacity be?', 'investigate Total CAPEX', "
                    "'estimate capacity factor', 'change tilt to 20°'). The value is shown in a confirmation widget. "
                    "If the user asks for a better, alternative, or different value, the proposal must differ "
                    "from the current value shown in the model inputs."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "field_name": {
                            "type": "string",
                            "description": "Exact field_name from the model inputs (e.g. 'net_capacity_kw', 'system_capacity', 'tilt').",
                        },
                        "proposed_value": {
                            "type": "number",
                            "description": "The proposed numeric value.",
                        },
                        "model_type": {
                            "type": "string",
                            "enum": ["lcoe", "carbon", "solar"],
                            "description": "Which model this input belongs to.",
                        },
                        "confidence": {
                            "type": "string",
                            "enum": ["high", "moderate", "low"],
                            "description": "Confidence in this estimate.",
                        },
                        "reason": {
                            "type": "string",
                            "description": "One sentence explaining the proposal.",
                        },
                    },
                    "required": ["field_name", "proposed_value", "model_type", "confidence", "reason"],
                },
            },
        },
    ))

    registry.register(CapabilityEntry(
        id="propose_template_value:standalone",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Propose Template Value",
        description="Propose a value for a template/form requirement (standalone variant).",
        surfaces=["standalone", "project"],
        openai_tool_def={
            "type": "function",
            "function": {
                "name": "propose_template_value",
                "description": (
                    "Propose a value for a template/form requirement field. "
                    "Use when the user message contains a [TEMPLATE_CONTEXT] block. "
                    "ALWAYS combine with search_scholarly_literature AND search_web_sources. "
                    "Determine if the value can be researched or must be gathered offline, "
                    "then either propose a concrete value or provide specific guidance."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "requirement_label": {
                            "type": "string",
                            "description": "The full question/label of the template requirement.",
                        },
                        "field_type": {
                            "type": "string",
                            "description": "Field type: text, number, currency, boolean, yes_no, date, narrative, formula.",
                        },
                        "proposed_value": {
                            "type": "string",
                            "description": "The proposed value (as string). Use empty string if this must be gathered offline.",
                        },
                        "can_be_determined": {
                            "type": "boolean",
                            "description": "True if this value can be determined from research/project docs. False if user must gather offline.",
                        },
                        "confidence": {
                            "type": "string",
                            "enum": ["high", "moderate", "low"],
                            "description": "Confidence in the proposal.",
                        },
                        "reason": {
                            "type": "string",
                            "description": "Brief explanation of the proposal or why it must be gathered offline.",
                        },
                    },
                    "required": ["requirement_label", "field_type", "can_be_determined", "confidence", "reason"],
                },
            },
        },
    ))


# ---------------------------------------------------------------------------
# Module entries (from ModuleRegistry)
# ---------------------------------------------------------------------------

def _register_modules(registry: CapabilityRegistry) -> None:
    """Register each BaseModule from the ModuleRegistry as a MODULE capability."""
    try:
        from app.modules.registry import get_module_registry

        mod_registry = get_module_registry()
        for module in mod_registry.get_all_modules():
            defn = module.definition
            registry.register(CapabilityEntry(
                id=f"module:{defn.id}",
                kind=CapabilityKind.MODULE,
                name=defn.name,
                description=defn.description,
                surfaces=["both"],
                visibility="public",
            ))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Prompt entries (from PromptRegistry)
# ---------------------------------------------------------------------------

def _register_prompts(registry: CapabilityRegistry) -> None:
    """Register each PromptDefinition as a PROMPT capability."""
    try:
        from app.prompts.registry import get_prompt_registry

        prompt_registry = get_prompt_registry()
        for defn in prompt_registry.list_all():
            registry.register(CapabilityEntry(
                id=f"prompt:{defn.id}",
                kind=CapabilityKind.PROMPT,
                name=defn.name,
                description=defn.description,
                surfaces=["both"],
                visibility="internal",
            ))
    except Exception:
        pass


def _register_adapters(registry: CapabilityRegistry) -> None:
    """Register adapter definitions from AdapterRegistry."""
    try:
        from app.adapters import get_adapter_registry

        adapter_registry = get_adapter_registry()
        for adapter in adapter_registry.list_all():
            defn = adapter.definition
            registry.register(
                CapabilityEntry(
                    id=f"adapter:{defn.adapter_id}",
                    kind=CapabilityKind.ADAPTER,
                    name=defn.name,
                    description=defn.description,
                    input_schema=defn.input_schema,
                    output_schema=defn.output_schema,
                    surfaces=["both"],
                    visibility=defn.visibility,
                )
            )
    except Exception:
        pass


def _register_resources(registry: CapabilityRegistry) -> None:
    """Register resource definitions from ResourceRegistry."""
    try:
        from app.resources import get_resource_registry

        resource_registry = get_resource_registry()
        for definition in resource_registry.list_definitions():
            registry.register(
                CapabilityEntry(
                    id=definition.uri_pattern,
                    kind=CapabilityKind.RESOURCE,
                    name=definition.name,
                    description=definition.description,
                    input_schema={"type": "object", "properties": {"uri": {"type": "string"}}},
                    output_schema={"type": "object"},
                    surfaces=["both"],
                    visibility="internal" if definition.initiative_scoped else "public",
                )
            )
    except Exception:
        pass


def _register_canonical_aliases(registry: CapabilityRegistry) -> None:
    """Register non-callable canonical IDs for normalized capability lookup.

    These aliases intentionally have no openai_tool_def so current runtime tool
    selection/function-calling behavior remains unchanged.
    """
    registry.register(CapabilityEntry(
        id="run_lcoe",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Run LCOE",
        description="Canonical alias for LCOE tool capabilities across surfaces.",
        surfaces=["both"],
        visibility="internal",
        openai_tool_def=None,
    ))
    registry.register(CapabilityEntry(
        id="run_carbon",
        kind=CapabilityKind.INTERNAL_TOOL,
        name="Run Carbon",
        description="Canonical alias for Carbon tool capabilities across surfaces.",
        surfaces=["both"],
        visibility="internal",
        openai_tool_def=None,
    ))
