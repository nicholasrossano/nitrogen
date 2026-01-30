"""API endpoints for tools."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from pydantic import BaseModel

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.models.initiative import Initiative, InitiativeStage
from app.models.chat import ChatMessage
from app.tools import get_tool_registry
from app.services.sdg_classifier import classify_sdg

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
    user: MockUser = Depends(get_current_user),
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
    user: MockUser = Depends(get_current_user),
):
    """Get tool recommendations for an initiative based on its description."""
    # Get initiative
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found")
    
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
    user: MockUser = Depends(get_current_user),
):
    """Select tools for an initiative."""
    from app.services.chat_agent import ChatAgentService
    
    # Get initiative
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found")
    
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
    
    await db.commit()
    await db.refresh(initiative)
    
    # Check if we already have all required inputs
    missing = initiative.get_missing_tool_inputs()
    
    tool_names = [registry.get_tool(tid).definition.name for tid in valid_tools]
    
    if not missing:
        # All inputs available - go straight to review
        initiative.stage = InitiativeStage.REVIEW.value
        await db.commit()
        
        # Build deliverables overview
        tools_info = []
        for tool_id in valid_tools:
            tool = registry.get_tool(tool_id)
            if tool:
                tools_info.append({
                    "id": tool.definition.id,
                    "name": tool.definition.name,
                    "description": tool.definition.description,
                    "icon": tool.definition.icon,
                    "output_type": tool.definition.output_type,
                })
        
        # Build tool_inputs with SDG classification
        tool_inputs = initiative.tool_inputs or {}
        if initiative.project_description:
            sdg_info = classify_sdg(
                project_description=initiative.project_description,
                project_type=initiative.project_type
            )
            if sdg_info:
                tool_inputs["sdg"] = sdg_info
        
        message = ChatMessage(
            initiative_id=initiative_id,
            role="assistant",
            content=f"I have everything I need to prepare your **{', '.join(tool_names)}**. Here's an overview:",
            widget_type="deliverables_overview",
            widget_data={
                "project_summary": initiative.to_summary_dict(),
                "selected_tools": tools_info,
                "tool_inputs": tool_inputs,
            },
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
    user: MockUser = Depends(get_current_user),
):
    """Get input requirements for selected tools."""
    # Get initiative
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found")
    
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
    user: MockUser = Depends(get_current_user),
):
    """Update tool inputs for an initiative."""
    # Get initiative
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found")
    
    # Merge with existing inputs
    current_inputs = initiative.tool_inputs or {}
    current_inputs.update(inputs)
    initiative.tool_inputs = current_inputs
    
    # Also update legacy fields if present
    if "project_title" in inputs:
        initiative.title = inputs["project_title"]
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
    user: MockUser = Depends(get_current_user),
):
    """Move initiative to review stage."""
    # Get initiative
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found")
    
    # Update stage
    initiative.stage = InitiativeStage.REVIEW.value
    initiative.stage_1_complete = True  # Legacy compatibility
    
    await db.commit()
    
    return {
        "success": True,
        "stage": initiative.stage,
    }
