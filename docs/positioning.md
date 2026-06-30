# Nitrogen positioning

Nitrogen is a **domain-agnostic, chat-first diligence reference architecture** with **climate-impact investment** as the worked example. The repo is meant to be cloned, self-hosted, and extended — not a single-vendor SaaS lock-in.

## What changed (contract cutover)

The legacy **initiative** model, onboarding chat table, and `/initiatives/*` UI paths are retired (permanent redirect to `/projects/*`). **`projects`** is the canonical deal record; child tables scope to `project_id`. Personal work happens in **core chat**; shared curation crosses a single **promotion boundary** into project **findings** and structured **variables** (API: assumptions).

Energy-specific calculators (carbon, LCOE, solar) remain as **signal providers** and assessment tooling inside the example domain pack — they are not the core abstraction.

## Core primitives

| Primitive | Role |
|-----------|------|
| **Company workspace** | Singleton tenant: members, company library, rubric templates (future), flows (future) |
| **Project** | Lightweight shared deal: documents, findings, variables, health |
| **Personal chat** | Private research; optional project scope for retrieval |
| **Finding** | Promoted, cited markdown shared on a project |
| **Variable** | Structured deal parameter (validated fact or working value); new rows often created at promotion time |
| **Files** | Company library vs project data room (single UI, scope toggle) |

## UX spine

- Default home: `/chat` with Cursor-style drawer (projects → chats)
- Landing project selector scopes retrieval; right pane shows project context until the first message
- Promote assistant output → team findings feed → teammates open in new chat

## What we deliberately deferred

- Declarative rubric schema (Phase 5) — health still uses the existing engine
- Generalized Flow definitions (Phase 6) — assessments unchanged
- MIT relicense — **AGPLv3 retained** until a separate licensing decision

## For contributors

Read [architecture.md](architecture.md) for workflow_state, decision log, and assessment families. Smoke-test after schema changes: chat history, evidence list, project materials, drive-linked files, promotion flow.
