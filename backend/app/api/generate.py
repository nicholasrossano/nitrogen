from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.auth import get_current_user, AuthUser
from app.core.billing_guard import require_ai_access
from app.core.permissions import require_editor, require_viewer
from app.models.initiative import InitiativeStage
from app.models.memo import MemoVersion
from app.models.onboarding import ChatMessage
from app.schemas.memo import MemoGenerateRequest, MemoResponse, MemoContent
from app.services.memo_generator import MemoGeneratorService
from app.assessments import get_assessment_registry
from app.assessments.base import AssessmentAlignment
from app.services import assessment_service

router = APIRouter()


@router.post("/initiatives/{initiative_id}/generate", response_model=MemoResponse)
async def generate_memo(
    initiative_id: str,
    data: MemoGenerateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
):
    """Generate an investment memo using RAG"""
    initiative = await require_editor(db, initiative_id, user)
    
    if not initiative.evidence_ready:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot generate: no evidence uploaded",
        )
    
    # Generate memo
    generator = MemoGeneratorService(db, user_id=user.uid)
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
    await assessment_service.save_deliverable(
        db, initiative.id, "memo_document",
        memo_content.title, "memo", memo_content.model_dump(mode="json"),
        user_id=user.uid,
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
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Get the latest memo for an initiative"""
    initiative = await require_viewer(db, initiative_id, user)
    
    # Get latest memo
    memo_result = await db.execute(
        select(MemoVersion)
        .where(MemoVersion.initiative_id == initiative.id)
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
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
):
    """Generate all selected deliverables for an initiative."""
    initiative = await require_editor(db, initiative_id, user)
    
    if not initiative.selected_tools:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No tools selected",
        )
    
    # Get tool registry
    registry = get_assessment_registry()
    
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
    
    deliverable_widgets = []
    deliverables: dict = {}

    for tool_id in initiative.selected_tools:
        tool = registry.get_assessment(tool_id)
        if not tool:
            continue

        try:
            alignment = None
            alignment_data = await assessment_service.get_alignment(db, initiative.id, tool_id)
            if alignment_data and alignment_data.get("confirmed"):
                alignment = AssessmentAlignment.from_dict(alignment_data)

            output = await tool.execute(
                db=db,
                initiative_id=initiative.id,
                inputs=inputs,
                include_corpus=True,
                alignment=alignment,
            )

            inst = await assessment_service.save_deliverable(
                db, initiative.id, tool_id,
                output.title, output.output_type, output.content,
                user_id=user.uid,
            )
            deliverables[tool_id] = inst.deliverable

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
            await assessment_service.set_instance_error(
                db, initiative.id, tool_id, str(e), user_id=user.uid,
            )

    initiative.stage = InitiativeStage.COMPLETE.value
    await db.commit()
    
    for widget in deliverable_widgets:
        label = widget["tool_name"]
        deliverable_message = ChatMessage(
            initiative_id=initiative.id,
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
