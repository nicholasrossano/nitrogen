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

**Scope discipline:**
- Make surgical changes only. Do not refactor broadly unless I explicitly ask.
- If you see improvements, list them as optional follow-ups instead of doing them.

**Learning & iteration:**
- When you give feedback or correction (e.g., "don't do X", "prefer Y approach"), I may propose adding it as a best practice to this file.
- Keep additions lightweight and actionable. Avoid overly broad rules.
- Organize new practices under relevant sections (General Workflow, UI/Design, or create domain-specific sections like Backend, Testing, etc.).
- After significant corrections, ask: "Should I capture this as a rule in AGENTS.md?"

## UI/Design
Follow `Docs/STYLEGUIDE.md` and `shared/design/DesignTokens.swift` as the source of truth.

**Codex Guardrails**
- Make surgical UI changes only; avoid sweeping restyles.
- Reuse existing tokens and components before introducing anything new.
- Do not invent new colors, fonts, or radii without explicit request.
- Prefer `DesignTokens` for new UI work; keep legacy values untouched unless scoped.
- No renaming of existing types/files unless explicitly requested.
- No style changes outside the feature being edited.
- Preserve current glass/material usage patterns; do not add new glass effects by default.
- Keep Avenir as the default body font and Didot for hero moments only.
- Respect the existing spacing scale; avoid odd/new padding values.
- Maintain rounded corners (18–25 for cards/pills, 50 for capsules).
- Keep shadows subtle; avoid heavy or colored shadows outside onboarding glow.
- Use SF Symbols for icons; don't add new icon packs.
- Ensure tap targets stay accessible (aim ≥44pt for primary actions).
- Support Dynamic Type where existing views already do.
- Match existing haptic patterns (mostly light; medium/heavy for emphasis).
