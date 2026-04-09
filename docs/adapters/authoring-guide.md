# Adapter Authoring Guide

Adapters encapsulate execution engines. Modules declare product behavior; adapters do the actual external or compute work.

## When To Create An Adapter

Create an adapter when execution depends on:

- a pure Python engine
- an external API
- a CLI tool
- a file-based processor
- an MCP-backed capability

Do not push product orchestration, stage logic, or UI concerns into adapters.

## Contract

Adapters implement `BaseAdapter` and must provide:

- `definition`
- `execute(ctx, db, inputs)`

`AdapterDefinition` must specify:

- `adapter_id`
- `name`
- `description`
- `provider`
- `adapter_type`
- `input_schema`
- `output_schema`
- `initiative_scope_required`
- `visibility`
- optional `capabilities`

## Design Rules

Adapters should:

- accept plain structured inputs
- return structured `AdapterResult`
- keep side effects explicit
- avoid reaching into module state directly
- avoid UI-specific response shapes

Modules are responsible for turning adapter output into widget/output state.

## Registration

Register adapters in `backend/app/adapters/__init__.py`.

If a module manifest references an adapter that is not registered, the module registry will fail fast in test and development.

## Testing Expectations

Add focused tests when you change:

- adapter registration
- adapter schemas
- adapter output shape expected by a launch module

When adding a new adapter binding for a module, update module manifest contract coverage in the same change.
