"""Helper functions for tool alignment flow."""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.initiative import Initiative
from app.tools import get_tool_registry
from app.services.sdg_classifier import classify_sdg


async def get_or_generate_alignment(
    db: AsyncSession,
    initiative: Initiative,
    tool_id: str,
) -> dict | None:
    """
    Get existing alignment or generate a new one for a tool.
    
    Returns alignment data dict or None if generation fails.
    """
    registry = get_tool_registry()
    tool = registry.get_tool(tool_id)
    
    if not tool or not tool.requires_alignment:
        return None
    
    # Check if alignment already exists
    existing_alignment = initiative.get_alignment_for_tool(tool_id)
    
    if existing_alignment:
        return existing_alignment
    
    # Generate new alignment
    try:
        alignment_obj = await tool.generate_alignment(
            db=db,
            initiative_id=initiative.id,
            inputs=initiative.tool_inputs or {},
        )
        alignment_data = alignment_obj.to_dict()
        
        # Save alignment to initiative
        initiative.set_alignment_for_tool(tool_id, alignment_data)
        await db.commit()
        await db.refresh(initiative)
        
        return alignment_data
    except Exception as e:
        logging.error(f"Failed to generate alignment for {tool_id}: {e}")
        return None


def build_alignment_widget_data(
    tool_id: str,
    alignment_data: dict,
    pending_tool_ids: list[str],
) -> dict:
    """
    Build widget data for the alignment widget.
    
    Args:
        tool_id: The tool being aligned
        alignment_data: The alignment configuration dict
        pending_tool_ids: List of remaining tool IDs that need alignment (excluding current)
    
    Returns:
        Widget data dict for the alignment widget
    """
    registry = get_tool_registry()
    tool = registry.get_tool(tool_id)
    
    if not tool:
        return {}
    
    return {
        "alignment": alignment_data,
        "tool": tool.definition.to_dict(),
        "pending_tools": [
            registry.get_tool(tid).definition.to_dict() 
            for tid in pending_tool_ids 
            if registry.get_tool(tid)
        ],
    }


def build_deliverables_overview_data(initiative: Initiative) -> dict:
    """
    Build widget data for the deliverables overview widget.
    
    Args:
        initiative: The initiative with selected tools
    
    Returns:
        Widget data dict for the deliverables_overview widget
    """
    registry = get_tool_registry()
    
    tools_info = []
    for tool_id in (initiative.selected_tools or []):
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
    tool_inputs = dict(initiative.tool_inputs or {})
    
    # Classify SDG based on project description
    if initiative.project_description:
        sdg_info = classify_sdg(
            project_description=initiative.project_description,
            project_type=initiative.project_type
        )
        if sdg_info:
            tool_inputs["sdg"] = sdg_info
    
    return {
        "project_summary": initiative.to_summary_dict(),
        "selected_tools": tools_info,
        "tool_inputs": tool_inputs,
        "alignments": initiative.tool_alignments,
    }


def get_alignment_intro_message(tool_name: str) -> str:
    """Get the assistant message for introducing an alignment widget."""
    return f"Before generating the {tool_name}, let me share the proposed outline. Please review and let me know if you'd like any adjustments."


def get_deliverables_overview_message(tool_names: list[str]) -> str:
    """Get the assistant message for the deliverables overview."""
    return f"I have everything I need to prepare your **{', '.join(tool_names)}**. Here's an overview:"
