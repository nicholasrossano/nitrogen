"""API endpoints for tools."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.alignment_helpers import (
    build_alignment_widget_data,
    build_deliverables_overview_data,
    get_alignment_intro_message,
    get_deliverables_overview_message,
    get_or_generate_alignment,
)
from app.core.auth import get_current_user, AuthUser
from app.core.database import get_db
from app.core.permissions import require_editor, require_viewer
from app.models.onboarding import ChatMessage
from app.models.initiative import InitiativeStage
from app.tools import get_tool_registry

_LOWERCASE_WORDS = frozenset(
    ["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet",
     "at", "by", "in", "of", "on", "to", "up", "as", "is", "it"]
)


def _to_title_case(text: str) -> str:
    if not text:
        return text
    words = text.split()
    result = []
    for i, word in enumerate(words):
        if i == 0 or i == len(words) - 1 or word.lower() not in _LOWERCASE_WORDS:
            result.append(word if word.isupper() and len(word) > 1 else word.capitalize())
        else:
            result.append(word.lower())
    return " ".join(result)

router = APIRouter()


class ToolDefinitionResponse(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    output_type: str
    category: str


class RecommendedTool(BaseModel):
    tool: ToolDefinitionResponse
    confidence: float
    recommended: bool = True


class ToolRecommendationsResponse(BaseModel):
    recommendations: list[RecommendedTool]
    project_type: str | None


class SelectToolsRequest(BaseModel):
    tool_ids: list[str]


class ToolInputDefinition(BaseModel):
    name: str
    label: str
    description: str
    input_type: str
    required: bool
    options: list[str] | None = None
    default: str | None = None
    placeholder: str | None = None


class ToolInputsResponse(BaseModel):
    tool_id: str
    tool_name: str
    inputs: list[ToolInputDefinition]
    current_values: dict


@router.get("/tools", response_model=list[ToolDefinitionResponse])
async def list_tools(
    user: AuthUser = Depends(get_current_user),
):
    """List all available tools."""
    registry = get_tool_registry()
    tools = registry.get_all_tools()
    
    return [
        ToolDefinitionResponse(
            id=tool.definition.id,
            name=tool.definition.name,
            description=tool.definition.description,
            icon=tool.definition.icon,
            output_type=tool.definition.output_type,
            category=tool.definition.category,
        )
        for tool in tools
    ]


@router.get("/initiatives/{initiative_id}/recommended-tools", response_model=ToolRecommendationsResponse)
async def get_recommended_tools(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Get tool recommendations for an initiative based on its description."""
    initiative = await require_viewer(db, initiative_id, user)
    if not initiative.project_description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project description required for recommendations"
        )
    
    # Get recommendations
    registry = get_tool_registry()
    recommendations = registry.recommend_tools(
        project_description=initiative.project_description,
        project_type=initiative.project_type,
    )
    
    return ToolRecommendationsResponse(
        recommendations=[
            RecommendedTool(
                tool=ToolDefinitionResponse(
                    id=tool.definition.id,
                    name=tool.definition.name,
                    description=tool.definition.description,
                    icon=tool.definition.icon,
                    output_type=tool.definition.output_type,
                    category=tool.definition.category,
                ),
                confidence=confidence,
                recommended=confidence > 0.3,
            )
            for tool, confidence in recommendations
        ],
        project_type=initiative.project_type,
    )


@router.post("/initiatives/{initiative_id}/select-tools")
async def select_tools(
    initiative_id: UUID,
    data: SelectToolsRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Select tools for an initiative."""

    initiative = await require_editor(db, initiative_id, user)
    # Validate tool IDs
    registry = get_tool_registry()
    valid_tools = []
    for tool_id in data.tool_ids:
        tool = registry.get_tool(tool_id)
        if tool:
            valid_tools.append(tool_id)
    
    if not valid_tools:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid tools selected"
        )
    
    # Update initiative
    initiative.selected_tools = valid_tools
    initiative.stage = InitiativeStage.GATHER_INPUTS.value
    
    # Initialize tool_inputs from existing initiative data
    tool_inputs = initiative.tool_inputs or {}
    if initiative.title:
        tool_inputs.setdefault("project_title", initiative.title)
    if initiative.geography:
        tool_inputs.setdefault("geography", initiative.geography)
    if initiative.target_population:
        tool_inputs.setdefault("target_beneficiaries", initiative.target_population)
    if initiative.goal:
        tool_inputs.setdefault("project_goal", initiative.goal)
    initiative.tool_inputs = tool_inputs
    initiative.touch()  # Update the initiative's updated_at timestamp
    
    await db.commit()
    await db.refresh(initiative)
    
    # Check if we already have all required inputs
    missing = initiative.get_missing_tool_inputs()
    
    tool_names = [registry.get_tool(tid).definition.name for tid in valid_tools]
    
    if not missing:
        # All inputs available - check for pending alignments first
        initiative.stage = InitiativeStage.REVIEW.value
        await db.commit()
        await db.refresh(initiative)
        
        # Check for tools that need alignment
        pending_alignment_tools = initiative.get_pending_alignment_tools()
        
        if pending_alignment_tools:
            # Show alignment widget for the first tool needing alignment
            tool_id = pending_alignment_tools[0]
            tool = registry.get_tool(tool_id)
            
            if tool and tool.requires_alignment:
                alignment_data = await get_or_generate_alignment(db, initiative, tool_id)
                
                if alignment_data:
                    widget_data = build_alignment_widget_data(
                        tool_id=tool_id,
                        alignment_data=alignment_data,
                        pending_tool_ids=pending_alignment_tools[1:],
                    )
                    message = ChatMessage(
                        initiative_id=initiative_id,
                        role="assistant",
                        content=get_alignment_intro_message(tool.definition.name),
                        widget_type="alignment",
                        widget_data=widget_data,
                    )
                    db.add(message)
                    await db.commit()
                else:
                    # Alignment generation failed, fall through to deliverables overview
                    pending_alignment_tools = []
        
        # If no pending alignments (or alignment generation failed), show deliverables overview
        if not pending_alignment_tools:
            widget_data = build_deliverables_overview_data(initiative)
            message = ChatMessage(
                initiative_id=initiative_id,
                role="assistant",
                content=get_deliverables_overview_message(tool_names),
                widget_type="deliverables_overview",
                widget_data=widget_data,
            )
            db.add(message)
            await db.commit()
    else:
        # Need to gather more inputs - ask first question
        # Get the first missing input to ask about
        all_missing_inputs = []
        for tool_id, input_names in missing.items():
            tool = registry.get_tool(tool_id)
            if tool:
                for inp in tool.required_inputs:
                    if inp.name in input_names:
                        all_missing_inputs.append(inp)
        
        if all_missing_inputs:
            first_input = all_missing_inputs[0]
            question = f"Great! I'll help you prepare the **{', '.join(tool_names)}**.\n\nTo get started: {first_input.description}"
        else:
            question = f"Great! I'll help you prepare the **{', '.join(tool_names)}**. Tell me more about your project."
        
        message = ChatMessage(
            initiative_id=initiative_id,
            role="assistant",
            content=question,
        )
        db.add(message)
        await db.commit()
    
    return {
        "success": True,
        "selected_tools": valid_tools,
        "stage": initiative.stage,
    }


@router.get("/initiatives/{initiative_id}/tool-inputs", response_model=list[ToolInputsResponse])
async def get_tool_inputs(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Get input requirements for selected tools."""
    initiative = await require_viewer(db, initiative_id, user)
    if not initiative.selected_tools:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No tools selected"
        )
    
    registry = get_tool_registry()
    tool_inputs = initiative.tool_inputs or {}
    
    responses = []
    for tool_id in initiative.selected_tools:
        tool = registry.get_tool(tool_id)
        if tool:
            responses.append(ToolInputsResponse(
                tool_id=tool_id,
                tool_name=tool.definition.name,
                inputs=[
                    ToolInputDefinition(
                        name=inp.name,
                        label=inp.label,
                        description=inp.description,
                        input_type=inp.input_type,
                        required=inp.required,
                        options=inp.options,
                        default=inp.default,
                        placeholder=inp.placeholder,
                    )
                    for inp in tool.all_inputs
                ],
                current_values={
                    inp.name: tool_inputs.get(inp.name)
                    for inp in tool.all_inputs
                    if inp.name in tool_inputs
                },
            ))
    
    return responses


@router.post("/initiatives/{initiative_id}/update-inputs")
async def update_tool_inputs(
    initiative_id: UUID,
    inputs: dict,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Update tool inputs for an initiative."""
    initiative = await require_editor(db, initiative_id, user)
    # Merge with existing inputs
    current_inputs = initiative.tool_inputs or {}
    current_inputs.update(inputs)
    initiative.tool_inputs = current_inputs
    
    # Also update legacy fields if present
    if "project_title" in inputs:
        initiative.title = _to_title_case(inputs["project_title"])
    if "geography" in inputs:
        initiative.geography = inputs["geography"]
    if "target_beneficiaries" in inputs:
        initiative.target_population = inputs["target_beneficiaries"]
    if "project_goal" in inputs:
        initiative.goal = inputs["project_goal"]
    if "budget_range" in inputs:
        initiative.budget_range = inputs["budget_range"]
    if "timeline" in inputs:
        initiative.timeline = inputs["timeline"]
    
    await db.commit()
    
    # Check if ready to proceed
    missing = initiative.get_missing_tool_inputs()
    
    return {
        "success": True,
        "inputs": initiative.tool_inputs,
        "missing_inputs": missing,
        "ready_to_generate": len(missing) == 0,
    }


@router.post("/initiatives/{initiative_id}/proceed-to-review")
async def proceed_to_review(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Move initiative to review stage."""
    initiative = await require_editor(db, initiative_id, user)
    # Update stage
    initiative.stage = InitiativeStage.REVIEW.value
    initiative.stage_1_complete = True  # Legacy compatibility
    
    await db.commit()
    
    return {
        "success": True,
        "stage": initiative.stage,
    }
