"""Contract tests for the unified staged assessment system.

These tests verify the shape and wiring of all registered assessments against
the new StageDef-based contract. They are intentionally subset-style checks
(issubset) so adding new assessments or fields does not require updating this file.
"""

from app.adapters import get_adapter_registry
from app.models.assessment_instance import AssessmentInstanceStatus
from app.assessments import get_assessment_registry
from app.assessments.base import (
    DecisionLogAttribution,
    FieldDef,
    AssessmentManifest,
    PopulationStep,
    StageDef,
)
from app.services.assessment_workflow_service import uses_workspace_flow


# ---------------------------------------------------------------------------
# Manifest contract
# ---------------------------------------------------------------------------

def test_registered_assessments_expose_manifest_contract() -> None:
    assessments = get_assessment_registry().get_all_assessments()
    assert assessments
    for assessment in assessments:
        manifest = assessment.manifest
        assert isinstance(manifest, AssessmentManifest)
        assert manifest.id == assessment.definition.id
        assert manifest.name == assessment.definition.name
        assert isinstance(manifest.adapter_bindings, dict)
        assert isinstance(manifest.decision_log_attribution, DecisionLogAttribution)
        assert isinstance(manifest.decision_log_attribution.adapter_labels, dict)
        assert isinstance(manifest.decision_log_attribution.widget_detail_labels, dict)
        assert isinstance(manifest.input_dependencies, list)
        assert isinstance(manifest.produced_outputs, list)
        assert isinstance(manifest.downstream_dependencies, list)
        assert manifest.assumptions_behavior in {"tracks", "none"}
        assert manifest.evidence_behavior in {"rag_grounded", "user_uploaded", "both", "none"}
        assert manifest.goal
        assert manifest.primary_ui_object
        assert manifest.investigate_hint is None or isinstance(manifest.investigate_hint, str)


def test_manifest_adapter_bindings_resolve_to_registered_adapters() -> None:
    adapter_ids = {
        adapter.definition.adapter_id
        for adapter in get_adapter_registry().list_all()
    }
    for assessment in get_assessment_registry().get_all_assessments():
        for adapter_id in assessment.manifest.adapter_bindings.values():
            assert adapter_id in adapter_ids


def test_assessment_instance_status_enum_values() -> None:
    """AssessmentInstanceStatus must cover the full launch lifecycle."""
    required = {"STARTED", "GENERATING", "READY", "COMPLETED"}
    actual = {member.name for member in AssessmentInstanceStatus}
    assert required.issubset(actual), f"Missing status values: {required - actual}"


# ---------------------------------------------------------------------------
# Stage contract
# ---------------------------------------------------------------------------

VALID_COMPONENTS = {"table", "list", "record", "computed_results"}
VALID_FIELD_TYPES = {"text", "number", "long_text", "select"}
KNOWN_POPULATION_STEPS = {
    "start_from_predefined_rows",
    "seed_from_template",
    "extract_from_project_materials",
    "infer_missing_with_ai",
    "adapt_with_ai_from_project_materials",
    "propose_with_ai",
    "enrich_selected_item_with_ai",
    "read_confirmed_prior_stage",
    "compute_with_assessment_logic",
    "compute_with_external_tool",
    "await_user_confirmation",
}


def test_every_assessment_declares_stage_defs() -> None:
    """Every registered assessment must declare at least one StageDef."""
    for assessment in get_assessment_registry().get_all_assessments():
        stages = assessment.stage_defs
        assert len(stages) > 0, (
            f"Assessment '{assessment.definition.id}' declares no stage_defs"
        )


def test_stage_defs_are_well_formed() -> None:
    """Every StageDef must have valid component, widget, fields, and population."""
    for assessment in get_assessment_registry().get_all_assessments():
        for stage in assessment.stage_defs:
            assert isinstance(stage, StageDef), (
                f"Assessment '{assessment.definition.id}' stage is not a StageDef"
            )
            assert stage.id, f"Stage has no id in '{assessment.definition.id}'"
            assert stage.title, f"Stage has no title in '{assessment.definition.id}'"
            assert stage.component in VALID_COMPONENTS, (
                f"Assessment '{assessment.definition.id}' stage '{stage.id}' has invalid component "
                f"'{stage.component}'"
            )
            assert stage.widget, (
                f"Assessment '{assessment.definition.id}' stage '{stage.id}' has no widget"
            )
            assert isinstance(stage.allow_add_rows, bool), (
                f"Assessment '{assessment.definition.id}' stage '{stage.id}' has non-boolean "
                f"allow_add_rows='{stage.allow_add_rows}'"
            )
            for field in stage.fields:
                assert isinstance(field, FieldDef)
                assert field.field_type in VALID_FIELD_TYPES, (
                    f"Assessment '{assessment.definition.id}' stage '{stage.id}' field '{field.name}' "
                    f"has invalid field_type '{field.field_type}'"
                )
            for step in stage.population:
                assert isinstance(step, PopulationStep)
                assert step.type in KNOWN_POPULATION_STEPS, (
                    f"Assessment '{assessment.definition.id}' stage '{stage.id}' has unknown population "
                    f"step '{step.type}'"
                )


def test_stage_confirmation_semantics() -> None:
    """Non-auto-confirmed stages must end with await_user_confirmation.

    Computed terminal stages may omit it — they auto-confirm after
    computation and rely on final_approval as the deliberate sign-off.
    """
    for assessment in get_assessment_registry().get_all_assessments():
        stage_defs = assessment.stage_defs
        for stage in stage_defs:
            if not stage.population:
                continue
            is_terminal = stage_defs[-1].id == stage.id
            is_computed = stage.component == "computed_results"
            if is_terminal and is_computed:
                continue
            last_step = stage.population[-1]
            assert last_step.type == "await_user_confirmation", (
                f"Assessment '{assessment.definition.id}' stage '{stage.id}' pipeline does not end "
                f"with await_user_confirmation (last step: '{last_step.type}')"
            )


def test_read_confirmed_prior_stage_references_valid_stage() -> None:
    """read_confirmed_prior_stage must reference a stage_id that exists in the assessment."""
    for assessment in get_assessment_registry().get_all_assessments():
        stage_ids = {s.id for s in assessment.stage_defs}
        for stage in assessment.stage_defs:
            for step in stage.population:
                if step.type == "read_confirmed_prior_stage":
                    prior_id = step.config.get("stage_id")
                    assert prior_id, (
                        f"Assessment '{assessment.definition.id}' stage '{stage.id}': "
                        f"read_confirmed_prior_stage has no stage_id in config"
                    )
                    assert prior_id in stage_ids, (
                        f"Assessment '{assessment.definition.id}' stage '{stage.id}': "
                        f"read_confirmed_prior_stage references unknown stage '{prior_id}'"
                    )


def test_every_assessment_uses_workspace_flow() -> None:
    """Every registered assessment must be usable in the workspace flow."""
    for assessment in get_assessment_registry().get_all_assessments():
        assert uses_workspace_flow(assessment), (
            f"Assessment '{assessment.definition.id}' is not configured for workspace flow"
        )


def test_stage_defs_serialise_cleanly() -> None:
    """All stage_defs must serialise to dict without error."""
    for assessment in get_assessment_registry().get_all_assessments():
        for stage in assessment.stage_defs:
            d = stage.to_dict()
            assert isinstance(d, dict)
            assert d["id"] == stage.id
            assert "fields" in d
            assert "population" in d
            assert "allow_add_rows" in d
