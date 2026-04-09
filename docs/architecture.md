# Nitrogen Architecture

Nitrogen now exposes one canonical module workflow:

1. `setup`
2. `build`
3. `output`

Every launch module fits that lifecycle. The difference between module families is not a separate platform or a separate lifecycle. The difference is only how the `build` stage behaves.

## `workflow_state` Shape

All modules share one canonical `workflow_state` JSON structure:

```json
{
  "setup": { "fields": { ... }, "status": "complete" },
  "build": {
    "stages": [
      {
        "id": "main",
        "name": "Build",
        "stage_type": "widget",          // "widget" | "simple_list" | "structured_list"
        "status": "in_progress",         // "not_started" | "in_progress" | "complete" | "confirmed"
        "widget_type": "lcoe_inputs",    // present for stage_type == "widget"
        "widget_data": { ... }           // present for stage_type == "widget"
      }
    ],
    "current_stage_id": "main"
  },
  "output": { ... }
}
```

Widget-backed modules have exactly one entry in `build.stages` with `stage_type: "widget"`.  
Layered assessment modules have one entry per layer, using `stage_type: "simple_list"` or `"structured_list"`.

## Module Families

### Widget-backed modules

Widget-backed modules use a single interactive build surface. They:

- collect a few setup fields
- open a calculator-style input widget in `build`
- recalculate immediately as the user edits values
- persist a structured output in `output`

Current examples:

- `lcoe_model`
- `carbon_model`
- `solar_estimate`

Implementation contract:

- subclass `BaseModule`
- provide a `ModuleManifest`
- expose `workspace_setup_fields`
- implement `build_workspace_widget_data()` — returns initial `widget_data` for `build.stages[0]`
- optionally implement `recalculate()` for fast edit loops
- implement `export()` to produce the export artifact

### Layered assessment modules

Assessment modules still use the same `setup -> build -> output` lifecycle, but their `build.stages` array contains one entry per ordered layer, each holding an `items` list instead of a calculator widget.

Current examples:

- `stakeholder_assessment`
- `landscape_mapping`
- `esmp`
- `mel_plan`

Implementation contract:

- subclass `BaseAssessmentModule`
- define `AssessmentModuleDef`
- define `setup_fields`
- define ordered `build_layers` (converted to `build.stages` entries at init)
- implement `generate_setup_defaults()`
- implement `generate_layer()`
- implement `generate_output()`

## Chat ↔ Module Interaction Model

Modules render exclusively in the editor workspace. The chat assistant does **not** render full module widgets.

Chat interactions are limited to lightweight `proposed_value` / `template_proposed_value` widgets:
1. User investigates a module value in chat.
2. Chat proposes a new value via `proposed_value` widget.
3. User clicks "Accept" — the value is patched into the module's `widget_data` in the editor.

No calculator results are computed or stored in chat messages.

## Runtime Responsibilities

### Module class

The module owns:

- user-facing metadata
- setup field definitions
- build behavior
- output generation behavior
- manifest wiring to adapters and downstream dependencies

### Workflow service

`module_workflow_service.py` owns generic lifecycle orchestration only:

- initialize workflow state
- merge initiative context into setup fields
- persist stage transitions
- persist widget state and deliverables
- route layered vs widget-backed modules using shared hooks

The workflow service should not branch on specific launch calculator `module_id` values.

## Manifest Contract

`ModuleManifest` is the canonical exposure contract for launch modules. It drives registry validation, API exposure, docs, and UI discovery.

Every module must define:

- `goal`
- `primary_ui_object`
- `workspace_build_widget`
- `workspace_output_widget`
- `export_artifact_types`
- `adapter_bindings`
- `input_dependencies`
- `produced_outputs`
- `downstream_dependencies`
- `assumptions_behavior`
- `evidence_behavior`

## Adapter Contract

Modules declare adapter dependencies in `manifest.adapter_bindings`. Adapters are registered separately and validated by the module registry at load time.

This lets module authoring stay focused on product behavior while adapters encapsulate external engines, APIs, or MCP-backed capability.

## Launch Scope

Launch scope is the unified workflow path above. Legacy memo and due diligence demo flows are not part of the active module architecture.
