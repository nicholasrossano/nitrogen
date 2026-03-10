from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.models.initiative import Initiative, InitiativeStage
from app.models.memo import MemoVersion
from app.models.chat import ChatMessage
from app.schemas.memo import MemoGenerateRequest, MemoResponse, MemoContent
from app.services.memo_generator import MemoGeneratorService
from app.tools import get_tool_registry
from app.tools.base import ToolAlignment

router = APIRouter()


@router.post("/initiatives/{initiative_id}/generate", response_model=MemoResponse)
async def generate_memo(
    initiative_id: UUID,
    data: MemoGenerateRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Generate an investment memo using RAG"""
    # Get initiative
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Initiative not found",
        )
    
    if not initiative.evidence_ready:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot generate: no evidence uploaded",
        )
    
    # Generate memo
    generator = MemoGeneratorService(db)
    memo_content, citations = await generator.generate(
        initiative=initiative,
        include_corpus=data.include_corpus,
    )
    
    # Save memo version
    memo_version = MemoVersion(
        initiative_id=initiative.id,
        content=memo_content.model_dump(mode="json"),
    )
    db.add(memo_version)
    await db.commit()
    await db.refresh(memo_version)
    
    # Save citations
    for citation in citations:
        citation.memo_version_id = memo_version.id
        db.add(citation)
    await db.commit()
    
    initiative.stage = "complete"
    initiative.save_deliverable(
        "investment_memo",
        memo_content.title,
        "memo",
        memo_content.model_dump(mode="json"),
    )
    await db.commit()
    
    # Add memo viewer message
    memo_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content="Here's your investment memo based on the evidence provided.",
        widget_type="memo_viewer",
        widget_data={
            "memo_id": str(memo_version.id),
            "content": memo_content.model_dump(mode="json"),
        },
    )
    db.add(memo_message)
    await db.commit()
    
    return MemoResponse(
        id=memo_version.id,
        initiative_id=initiative.id,
        content=memo_content,
        created_at=memo_version.created_at,
    )


@router.get("/initiatives/{initiative_id}/memo", response_model=MemoResponse)
async def get_latest_memo(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Get the latest memo for an initiative"""
    # Verify access
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Initiative not found",
        )
    
    # Get latest memo
    memo_result = await db.execute(
        select(MemoVersion)
        .where(MemoVersion.initiative_id == initiative_id)
        .order_by(MemoVersion.created_at.desc())
        .limit(1)
    )
    memo = memo_result.scalar_one_or_none()
    
    if not memo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No memo found for this initiative",
        )
    
    return MemoResponse(
        id=memo.id,
        initiative_id=initiative.id,
        content=MemoContent(**memo.content),
        created_at=memo.created_at,
    )


@router.post("/initiatives/{initiative_id}/generate-all")
async def generate_all_deliverables(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Generate all selected deliverables for an initiative."""
    # Get initiative
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Initiative not found",
        )
    
    if not initiative.selected_tools:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No tools selected",
        )
    
    # Get tool registry
    registry = get_tool_registry()
    
    # Prepare inputs from initiative
    inputs = initiative.tool_inputs or {}
    # Add legacy field mappings
    if initiative.title:
        inputs.setdefault("project_title", initiative.title)
    if initiative.geography:
        inputs.setdefault("geography", initiative.geography)
    if initiative.target_population:
        inputs.setdefault("target_beneficiaries", initiative.target_population)
    if initiative.goal:
        inputs.setdefault("project_goal", initiative.goal)
    if initiative.budget_range:
        inputs.setdefault("budget_range", initiative.budget_range)
    if initiative.timeline:
        inputs.setdefault("timeline", initiative.timeline)
    
    # Get tool alignments
    tool_alignments = initiative.tool_alignments or {}
    
    deliverable_widgets = []

    for tool_id in initiative.selected_tools:
        tool = registry.get_tool(tool_id)
        if not tool:
            continue

        try:
            alignment = None
            if tool_id in tool_alignments:
                alignment_data = tool_alignments[tool_id]
                if alignment_data.get("confirmed"):
                    alignment = ToolAlignment.from_dict(alignment_data)

            output = await tool.execute(
                db=db,
                initiative_id=initiative_id,
                inputs=inputs,
                include_corpus=True,
                alignment=alignment,
            )

            initiative.save_deliverable(
                tool_id, output.title, output.output_type, output.content,
            )

            if output.output_type == "memo":
                widget_type = "memo_viewer"
            elif output.output_type == "checklist":
                widget_type = "checklist_viewer"
            else:
                widget_type = "document_viewer"

            deliverable_widgets.append({
                "tool_id": tool_id,
                "tool_name": tool.definition.name,
                "widget_type": widget_type,
                "content": output.content,
            })

        except Exception as e:
            deliverables = dict(initiative.deliverables or {})
            deliverables[tool_id] = {"error": str(e)}
            initiative.deliverables = deliverables

    initiative.stage = InitiativeStage.COMPLETE.value
    await db.commit()
    
    # Create individual chat messages per deliverable so each opens in EditorSidePanel
    WIDGET_LABELS = {
        "memo_viewer": "Investment Memo",
        "checklist_viewer": "Due Diligence Checklist",
    }
    for widget in deliverable_widgets:
        label = WIDGET_LABELS.get(widget["widget_type"], widget["tool_name"])
        deliverable_message = ChatMessage(
            initiative_id=initiative_id,
            role="assistant",
            content=f"Here's your **{label}** for review and export.",
            widget_type=widget["widget_type"],
            widget_data={"content": widget["content"]},
        )
        db.add(deliverable_message)
    await db.commit()
    
    return {
        "success": True,
        "deliverables": deliverables,
    }
