# Module Authoring Guide

Use this guide when adding a new Nitrogen module.

## Choose The Right Base Class

Use `BaseModule` when the module has:

- a small setup form
- one widget-backed build surface
- deterministic recompute or a tight generate/edit loop

Use `BaseAssessmentModule` when the module has:

- a setup form plus one or more ordered build layers
- item-level confirmation and revision
- a final synthesized output assembled from confirmed build items

All modules still use the same top-level stages:

1. `setup`
2. `build`
3. `output`

## Required Pieces For Any Module

Every module needs:

- `definition`
- `manifest`
- input metadata or assessment metadata
- execution hooks appropriate for the chosen base class

The `manifest` is not optional. It is the contract the registry validates and the rest of the app reads.

## Widget-Backed Module Checklist

For `BaseModule` implementations:

1. Define `definition`.
2. Define `manifest`.
3. Define `required_inputs` and any `optional_inputs`.
4. Expose `workspace_setup_fields` for the setup stage.
5. Implement `build_workspace_widget_data(known_values)` — converts initiative/setup context into the initial `widget_data` dict stored inside the single `build_stages[0]` entry.
6. Implement `recalculate()` if the widget supports fast user edits (called by the persist-widget-stage endpoint on every change).
7. Implement `execute()` and `export()` as needed.

`build_workspace_widget_data()` is the only place a module should write initial widget state. Do not add `module_id` branches in the workflow service for launch modules.

**Chat role**: chat does not render module widgets. The chat assistant can propose values using the `proposed_value` widget; the user confirms in the editor workspace. Do not add `execute_from_conversation()` hooks for new modules.

## Layered Assessment Module Checklist

For `BaseAssessmentModule` implementations:

1. Define `definition`.
2. Define `manifest`.
3. Return an `AssessmentModuleDef` from `assessment_definition`.
4. Define setup fields and ordered build layers.
5. Implement `generate_setup_defaults()`.
6. Implement `generate_layer()`.
7. Implement `generate_output()`.

Each build layer should represent one user-reviewable step. Prefer a few meaningful layers over many tiny ones.

## Setup Field Guidance

Setup fields should:

- capture only project-level inputs needed before build starts
- be serializable as plain dictionaries
- use stable field names that can also appear in initiative context or `tool_inputs`

For widget-backed modules, keep setup fields small. Most detailed editing belongs inside the build widget, not the setup form.

## Manifest Guidance

Good manifests are specific and operational. They should tell the system:

- what the module is trying to accomplish
- which widget the build stage renders
- which widget the output stage renders
- which adapters are required
- what outputs downstream modules can depend on

If the module exports files, `definition.export_format` and `manifest.export_artifact_types` must agree.

## Testing Expectations

At minimum, add or update:

- manifest contract coverage
- registry completeness coverage
- workflow service coverage for setup/build/output behavior

For widget-backed modules, include a focused test that proves setup defaults feed the initial widget state.

For layered modules, include a focused test that proves setup fields and build layers are present and serializable.

## Templates

Copy one of these starting points:

- `backend/app/modules/_templates/widget_module_template.py`
- `backend/app/modules/_templates/layered_module_template.py`
