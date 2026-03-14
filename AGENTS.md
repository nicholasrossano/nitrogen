# AGENTS

## General Workflow

**Mode switch:**
- If the change is small and low-risk, implement directly without asking questions.
- If the request is ambiguous or the change is high-risk (architecture/security/perf/schema/core flows), ask 1–3 clarifying questions first.

**Before coding (brief):**
- Identify risks (correctness, performance, security, regression surface).
- Call out any assumptions you are making.

**Testing + verification (solo-dev friendly):**
- If the project already has tests and a standard way to run them, run the relevant tests.
- If tests do not exist for the affected area, do NOT block progress. Instead:
  - Add minimal tests only when changing core logic, and keep them simple.
  - Otherwise provide a concrete manual verification checklist.
- Always include: "How to verify" steps.

**Disabled button hover states:**
- Whenever a button has both `hover:X` effects and `disabled:opacity-*`, replace `hover:X` with `enabled:hover:X` so hover animations are suppressed when disabled while the `disabled:cursor-not-allowed` cursor still shows. For `btn-primary/secondary/danger` classes in `globals.css`, add `:disabled:hover::before { opacity: 0 }` CSS overrides to suppress the pseudo-element fill animation.

**Post-edit checks (always run):**
- After every substantive edit, call `ReadLints` on the edited file(s) before finalizing.
- Fix any linter errors introduced by the change before responding.
- For JSX in particular: watch for ternary branches with multiple sibling elements — they must be wrapped in a fragment (`<>...</>`).

**Scope discipline:**
- Make surgical changes only. Do not refactor broadly unless I explicitly ask.
- If you see improvements, list them as optional follow-ups instead of doing them.

**Learning & iteration:**
- When I receive feedback or correction from you, interpret whether it reflects a reusable pattern or preference.
- If it seems fundamental enough (not just a one-off fix), add it to AGENTS.md automatically.
- Keep additions lightweight and actionable. Avoid overly broad rules.
- Organize new practices under relevant sections (General Workflow, UI/Design, or create domain-specific sections like Backend, Testing, etc.).
- Mention the update briefly: "Added to AGENTS.md: [rule]"

**How to add new practices to this file:**
- Any repeatable check, constraint, or pattern that prevents a class of bug belongs here.
- Write it as a concrete action ("always do X", "never do Y") rather than a vague principle.
- Place it in the most relevant section, or create a new section if none fits.
- Keep each rule to 1–2 lines max.

## App Architecture — Two Chat Surfaces (Critical)

There are **two distinct chat/UI surfaces**. Assume the user is always referring to the **Generate flow (standalone)** unless they explicitly say "project plan" or "side chat".

| Surface | Description | Key files |
|---|---|---|
| **Generate flow (standalone)** | Full-page chat at `/` — landing tiles, history, conversation view. **Default assumption.** | `LandingInput.tsx`, `ConversationView.tsx`, `ProjectStandaloneChatView.tsx` |
| **Project plan side chat** | Narrow chat panel inside a project's editor/plan view, opened via the side panel | `ChatPanel.tsx`, `EditorSidePanel.tsx` |

Never touch `ToolPicker.tsx` (the `+` button dropdown) when the request is about the generate flow tiles in `LandingInput.tsx`.

## UI/Design
Follow `Docs/STYLEGUIDE.md` as the source of truth.

**Page layout chrome (non-negotiable):**
- Every top-level page must use the three-part shell: `<div h-screen flex flex-col>` → `<header shrink-0 h-14>` → `<div flex flex-1 min-h-0>` (sidebar + workspace).
- The `<header className="shrink-0 h-14">` must always be present — even if empty — on every page state/branch. What changes is only the content inside it, never its presence. Never omit the header on any conditional render branch (e.g. a selection screen vs. an active workspace screen on the same route).

## Dev / local run
When starting the "local emulator" or running the app locally, follow `.cursor/rules/dev-setup.mdc`: start **backend** (port 8000), **frontend** (port 3000), and **open** `http://localhost:3000` in the browser. All three are required (e.g. projects won’t load without the backend).
