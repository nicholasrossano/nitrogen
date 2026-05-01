# Assessment Authoring Guide

Use this guide when adding a new Nitrogen assessment.

Nitrogen assessments now author against the shared staged workflow contract:

- declare ordered `stage_defs`
- let the workflow service persist `workflow_state`
- rely on shared confirmation, final approval, and decision-log infrastructure instead of bespoke audit logic

## Choose The Right Base Class

Use `BaseAssessment` when the assessment has:

- a staged workflow made mostly of calculator-style or computed stages
- deterministic recompute or a tight generate/edit loop

Use `BaseAssessmentAssessment` when the assessment has:

- multiple ordered review stages with AI generation and human confirmation
- item-level confirmation and revision
- a final synthesized output assembled from confirmed stages

All assessments still use the same shared workflow envelope:

1. ordered `stage_defs`
2. per-stage confirmation metadata in `workflow_state.stages[*]`
3. shared `final_approval` before export

## Required Pieces For Any Assessment

Every assessment needs:

- `definition`
- `manifest`
- input metadata or assessment metadata
- execution hooks appropriate for the chosen base class

The `manifest` is not optional. It is the contract the registry validates and the rest of the app reads.

## Widget-Backed Assessment Checklist

For `BaseAssessment` implementations:

1. Define `definition`.
2. Define `manifest`.
3. Define ordered `stage_defs`.
4. Implement the stage hooks your workflow uses, such as `get_predefined_rows()`, `generate_items_for_stage()`, `compute_stage()`, or `compute_external()`.
5. Implement `generate_export()` when the assessment exports an artifact.

Do not add `assessment_id` branches in the workflow service for launch assessments. New behavior should come from stage definitions, shared workflow hooks, or shared reporting helpers.

**Chat role**: chat does not render assessment widgets. The chat assistant can propose values using the `proposed_value` widget; the user confirms in the editor workspace. Do not add `execute_from_conversation()` hooks for new assessments.

## Layered Assessment Assessment Checklist

For `BaseAssessmentAssessment` implementations:

1. Define `definition`.
2. Define `manifest`.
3. Define ordered `stage_defs`.
4. Implement `generate_items_for_stage()` and `enrich_record()` as needed.
5. Implement `generate_writeup_content()` when the assessment needs a generated narrative export.
6. Implement `generate_export()` for the final artifact.

Each build layer should represent one user-reviewable step. Prefer a few meaningful layers over many tiny ones.

## Setup Field Guidance

Setup fields should:

- capture only project-level inputs needed before build starts
- be serializable as plain dictionaries
- use stable field names that can also appear in initiative context or `tool_inputs`

For widget-backed assessments, keep setup fields small. Most detailed editing belongs inside the build widget, not the setup form.

## Manifest Guidance

Good manifests are specific and operational. They should tell the system:

- what the assessment is trying to accomplish
- which widget the build stage renders
- which widget the output stage renders
- any optional `investigate_hint` the shared chat flow can use for concise field-level value proposals
- which adapters are required
- how decision-log attribution should label adapters or extra widget metadata
- what outputs downstream assessments can depend on

If the assessment exports files, `definition.export_format` and `manifest.export_artifact_types` must agree. Exportable staged assessments automatically inherit the shared final-approval gate and decision-log tracking.

When a assessment should expose friendly citations in the decision log, configure `manifest.decision_log_attribution` instead of adding reporting heuristics. Common examples:

- `adapter_labels` for human-readable engine or API names
- `widget_detail_labels` for stable widget metadata keys that should appear in citations
- leaving `include_model_name=True` so persisted LLM metadata is surfaced automatically

## Testing Expectations

At minimum, add or update:

- manifest contract coverage
- registry completeness coverage
- workflow service coverage for setup/build/output behavior

For widget-backed assessments, include a focused test that proves setup defaults feed the initial widget state.

For layered assessments, include a focused test that proves setup fields and build layers are present and serializable.

## Templates

Copy one of these starting points:

- `backend/app/assessments/_templates/widget_assessment_template.py`
- `backend/app/assessments/_templates/layered_assessment_template.py`

## Staged Table UX Flags

For staged workflow assessments that use `StageDef(component="table", widget="editable_table")`, declare row-creation behavior explicitly:

- set `allow_add_rows=False` for fixed calculator input lists (for example: LCOE, Carbon, Solar)
- set `allow_add_rows=True` only when the stage is intentionally user-extensible
