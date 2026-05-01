# Nitrogen Architecture

Nitrogen now exposes one canonical staged assessment workflow driven by `StageDef[]`.

Every workspace assessment is an ordered set of confirmable stages stored on `assessment_instances.workflow_state`. The difference between assessment families is not a separate lifecycle; it is only which stage components and population steps they declare.

## `workflow_state` Shape

All assessments share one canonical `workflow_state` JSON structure:

```json
{
  "assessment_type": "stakeholder_assessment",
  "current_stage_id": "categories",
  "stages": {
    "categories": {
      "status": "confirmed",
      "confirmed_at": "2026-04-17T14:00:00+00:00",
      "confirmed_by": "user-123",
      "data": { "items": [ ... ] }
    },
    "details": {
      "status": "draft",
      "confirmed_at": null,
      "confirmed_by": null,
      "data": { "records": { ... } }
    }
  },
  "final_approval": {
    "status": "approved",
    "approved_at": "2026-04-17T15:00:00+00:00",
    "approved_by": "user-123",
    "approved_by_email": "owner@example.com"
  }
}
```

Stage data shapes are component-driven:

- `table` / `list`: `data.items`
- `record`: `data.source_stage_id` + `data.records`
- `computed_results`: `data.widget_data`

Assessments that export artifacts also require a shared `final_approval` step before export is enabled.

## Decision Log

Decision-log reporting is now shared infrastructure, not per-assessment custom UI:

- live editable truth remains `assessment_instances.workflow_state`
- append-only audit history is stored in `decision_events`
- project-wide current-state and history views are derived from those two sources
- the primary export is `XLSX` with `Current State` and `History` sheets

## Assessment Families

### Widget-backed assessments

Widget-backed assessments use a single interactive build surface. They:

- collect a few setup fields
- open a calculator-style input widget in `build`
- recalculate immediately as the user edits values
- persist a structured output in `output`

Current examples:

- `lcoe_model`
- `carbon_model`
- `solar_estimate`

Implementation contract:

- subclass `BaseAssessment`
- provide a `AssessmentManifest`
- expose `workspace_setup_fields`
- implement `build_workspace_widget_data()` — returns initial `widget_data` for `build.stages[0]`
- optionally implement `recalculate()` for fast edit loops
- implement `export()` to produce the export artifact

### Layered assessment assessments

Assessment assessments still use the same `setup -> build -> output` lifecycle, but their `build.stages` array contains one entry per ordered layer, each holding an `items` list instead of a calculator widget.

Current examples:

- `stakeholder_assessment`
- `landscape_mapping`

Implementation contract:

- subclass `BaseAssessmentAssessment`
- define `AssessmentAssessmentDef`
- define `setup_fields`
- define ordered `build_layers` (converted to `build.stages` entries at init)
- implement `generate_setup_defaults()`
- implement `generate_layer()`
- implement `generate_output()`

## Chat ↔ Assessment Interaction Model

Assessments render exclusively in the editor workspace. The chat assistant does **not** render full assessment widgets.

Chat interactions are limited to lightweight `proposed_value` / `template_proposed_value` widgets:
1. User investigates a assessment value in chat.
2. Chat proposes a new value via `proposed_value` widget.
3. User clicks "Accept" — the value is patched into the assessment's `widget_data` in the editor.

No calculator results are computed or stored in chat messages.

## Runtime Responsibilities

### Assessment class

The assessment owns:

- user-facing metadata
- setup field definitions
- build behavior
- output generation behavior
- manifest wiring to adapters and downstream dependencies

### Workflow service

`assessment_workflow_service.py` owns generic lifecycle orchestration only:

- initialize workflow state
- merge initiative context into setup fields
- persist stage transitions
- persist widget state and deliverables
- route layered vs widget-backed assessments using shared hooks

The workflow service should not branch on specific launch calculator `assessment_id` values.

For staged table stages (`component: "table"` with `widget: "editable_table"`), row extensibility is schema-driven via `StageDef.allow_add_rows`:

- `false` means a fixed variable list (no add-row controls)
- `true` means users can append rows in the workspace UI

## Manifest Contract

`AssessmentManifest` is the canonical exposure contract for launch assessments. It drives registry validation, API exposure, docs, and UI discovery.

Every assessment must define:

- `goal`
- `primary_ui_object`
- `investigate_hint` (optional, for concise field-level investigate guidance)
- `workspace_build_widget`
- `workspace_output_widget`
- `export_artifact_types`
- `adapter_bindings`
- `decision_log_attribution`
- `input_dependencies`
- `produced_outputs`
- `downstream_dependencies`
- `assumptions_behavior`
- `evidence_behavior`

## Adapter Contract

Assessments declare adapter dependencies in `manifest.adapter_bindings`. Adapters are registered separately and validated by the assessment registry at load time.

This lets assessment authoring stay focused on product behavior while adapters encapsulate external engines, APIs, or MCP-backed capability.

## Decision-Log Attribution Contract

Decision-log citation behavior should be schema-driven via `manifest.decision_log_attribution`, not hardcoded in reporting services.

The shared builder uses this manifest metadata to decide whether to include:

- adapter binding citations
- provenance/reference citations already present in stage data
- LLM model names when assessments persist them in widget or provenance metadata
- selected widget metadata fields (for example a method pack) labeled via manifest config

For third-party or open-source assessments, prefer declaring user-facing adapter labels in `decision_log_attribution.adapter_labels` instead of adding service-level `assessment_id` branches.

## Launch Scope

Launch scope is the unified workflow path above. Legacy memo and due diligence demo flows are not part of the active assessment architecture.
