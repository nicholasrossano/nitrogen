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
- For adapter/resource/capability registries, prefer scalable contract tests: baseline `issubset` + shape checks, not exact full-set equality.
- When adding/removing a baseline adapter/resource contract, update the corresponding registry contract tests in the same change.
- For phased architecture migrations, add tests in-phase: contract tests immediately, targeted parity/regression tests at each wiring step (do not wait until the final phase).
- For new test suites added during migration phases, include them in the default backend CI pytest path (or document why they are intentionally excluded).

**Post-edit checks (always run):**
- After every substantive edit, call `ReadLints` on the edited file(s) before finalizing.
- Fix any linter errors introduced by the change before responding.
- After adding or changing a backend Alembic migration or ORM column, run `cd backend && python3 -m alembic upgrade head` against the local dev DB before finalizing.
- For JSX in particular: watch for ternary branches with multiple sibling elements — they must be wrapped in a fragment (`<>...</>`).
- After substantial frontend/App Router shell changes, if Next dev shows missing `vendor-chunks/*` or `Cannot find assessment './*.js'` under `.next/server`, treat it as cache corruption first: clear `frontend/.next` and restart with `npm run dev:clean` before debugging code.
- Never run `next build` into the same output dir as an active `next dev` server; keep build output isolated (for this repo, `npm run build` must use `.next-build`) so verification does not corrupt dev chunks.

**Import integrity after deletions (non-trivial changes):**
- After deleting any backend Python file, immediately `grep` the entire backend for imports of the deleted assessment before finalizing. Key aggregator files to check: `models/__init__.py`, `alembic/env.py`, `app/main.py`, and any API/service file that might lazy-import it.
- After deleting any frontend file, check its barrel exports (`index.ts`) and any files that import it by name.
- If the local servers are running (`localhost:8000`, `localhost:3000`), do a quick `curl http://localhost:8000/health` after backend edits to confirm the reload succeeded cleanly.

**Scope discipline:**
- Make surgical changes only. Do not refactor broadly unless I explicitly ask.
- If you see improvements, list them as optional follow-ups instead of doing them.
- For staged `editable_table` inputs, always set `StageDef.allow_add_rows` explicitly (false for fixed variable lists, true only for intentionally extensible tables).

**Architecture migration posture:**
- For pre-launch architecture upgrades, prefer full cutover to the target design over long-lived compatibility shims.
- If a temporary shim is unavoidable, mark it clearly with owner + removal trigger in the same PR; do not leave indefinite legacy paths.
- For noteworthy architecture changes, do not keep dual legacy + new infra paths; complete a migration audit in-phase (all callers moved, legacy path removed, CI/tests green).

## Backend Schema & Deployment Safety

- For schema/ORM renames, use expand/contract: add new column or alias-compatible mapping first, deploy app+migration safely, then remove legacy names in a later change.
- Never merge backend model changes to `main` that assume columns/tables not present in current production DB.
- Before merging schema-sensitive backend work to `main`, run a quick smoke check against a real project: initiative detail, chat history, evidence, materials, and Drive-linked endpoints.
- Keep feature-branch schema upgrades isolated; for production incidents, ship a minimal hotfix on `main` that preserves current prod schema compatibility.
- When hotfixing `main` during a long-lived feature branch, backport intentionally (or verify the feature branch already contains equivalent/future-safe behavior) to avoid regressions at merge time.

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
`docs/style-guide.md` is the UI source of truth for design patterns and visual rules.

- Do not duplicate design guidance here.
- Follow the style guide for all UI decisions (buttons, layout chrome, pillars/nodes, dropdown layering, tooltips, and shared control reuse).
- When a reusable design rule changes, update `docs/style-guide.md` in the same change.

## Loading Art Authoring

- For new loading-art shapes, prefer deterministic math generators over ad-hoc hand-tuned rejection fields: **IFS** for fractal leaves/ferns, **L-system recursion** for branching trees, and **polar/parametric curves** for radial flowers.
- Treat geometry seeding as a reusable package: each piece should only define how it seeds `homeX/homeY/foldX/foldY`; keep breathing/shimmer physics in shared helpers (`physics.ts`) instead of per-piece rewrites.
- When sampling by rejection, use a continuous scalar field (smooth union / weighted field) plus bounded attempts; avoid disconnected lobe-by-lobe samplers that create seam bands or hollow centers.
- For families of related shapes (e.g. many flowers or trees), add small reusable math helpers (spiral sampler, branch generator, polar sampler) before adding the next piece so new variants are mostly parameter changes, not bespoke geometry code.
- Keep `loadingArtRegistry` alphabetized by `name`, and when removing a piece, remove its file plus any index exports/imports in the same change.

## Documentation Maintenance

Nitrogen docs live in `docs/` and are automatically rendered on the public docs site (Mintlify) on every push to `main`. Keep them current by following these rules — the goal is docs that update alongside code, not after.

**When to update docs (update in the same PR, not after):**
- Changing how `adapter_bindings`, `AssessmentManifest`, `AdapterDefinition`, or `ExecutionContext` work → update `docs/architecture.md` and the relevant authoring guide
- Changing the assessment authoring pattern (base classes, registration, manifest fields) → update `docs/assessments/authoring-guide.md`
- Changing the adapter contract or adding a new adapter type → update `docs/adapters/authoring-guide.md`
- Changing the MCP exposure model, transport, or auth → update `docs/mcp/integration-guide.md`
- Changing setup steps, env vars, or dev commands → update `docs/setup.md`

**When NOT to update docs:**
- Adding a new concrete assessment (e.g. a new `DemandAssessmentAssessment`) — the live `GET /api/v1/capabilities` endpoint reflects this automatically; no doc edit needed unless the authoring *pattern* changed
- Adding a new adapter instance — same as above; the capabilities endpoint is the live catalog
- Routine bug fixes, UI tweaks, or refactors that don't change contracts

**API reference (auto-generated — keep code annotations current):**
- Every new FastAPI route function must have a docstring describing what it does
- Every new Pydantic model field must have a `Field(description="...")` annotation
- These become the Mintlify API reference automatically on deploy — no separate doc writing required

**Capabilities endpoint (always live — no maintenance needed):**
- `GET /api/v1/capabilities` is generated from the registries at request time
- Never write a static list of assessments, adapters, or resources in docs — always link to this endpoint instead

## Pull Requests
When creating a PR with `gh pr create`, always fill in the `.github/PULL_REQUEST_TEMPLATE.md` fields — never leave placeholder comment text in the final body. The template has two sections:
- **Summary**: 1–3 sentences on what the PR does and why. Include `Closes #N` only if there is a known issue number, otherwise omit that line.
- **Changes**: bullet points listing the key changes (one per logical change area).

## GitHub Issues
When creating or renaming issues, prefer plain-language titles that are easy to scan quickly; avoid overly technical phrasing unless the user asks for it.

**Issue body format (default):**
- Use this exact structure in order: `Title`, `Body`, `## Scope`, `## Done when`.
- **Title**: short, specific, action-oriented.
- **Body**: one short paragraph of context.
- **Scope**: concise bullets for what the issue should do.
- **Done when**: concise bullets for what completion looks like.

**Epic + child issue format (default):**
- When a feature spans multiple workstreams, create one epic plus child issues.
- In the epic, include a `## Child issues` checklist that links each child issue.
- In each child issue, include a parent reference (for example: `Parent epic: #123`).

**Issue writing guidelines:**
- Keep issues implementation-oriented, not PRD-like.
- Keep issues short unless more detail is necessary.
- Prefer one clear center of gravity per issue.
- Separate core foundation work from connector-specific work.
- Write plainly and avoid filler.

**Issue labels:**
- Use only active repo labels unless the user explicitly asks to add a new one.
- Current type labels are `type/bug`, `type/feature`, and `type/docs` (do not reintroduce removed type labels).
- Apply 1 `type/*` label and 1–2 `area/*` labels; use `contrib/*` only when explicitly contributor-facing.

## Environment Files

There is **one `.env` file** at the repo root. `backend/.env` and `frontend/.env.local` are **symlinks** to it.

- `Nitrogen/.env` — the only real env file; edit this, both services read it automatically.
- `backend/.env` → symlink to `../.env`
- `frontend/.env.local` → symlink to `../.env`
- `.env.example` — committed template for open-source contributors (no secrets).

**Rules:**
- NEVER create, overwrite, or delete `backend/.env` or `frontend/.env.local` — they are symlinks. Edit `Nitrogen/.env` only.
- To add a new env var: add it to `Nitrogen/.env` and `.env.example`.
- If a symlink is missing, recreate it: `ln -sf ../.env backend/.env` or `ln -sf ../.env frontend/.env.local`.

## Dev / local run
When starting the "local emulator" or running the app locally, follow `.cursor/rules/dev-setup.mdc`: start **backend** (port 8000), **frontend** (port 3000), and **open** `http://localhost:3000` in the browser. All three are required (e.g. projects won't load without the backend).

## Cursor Cloud specific instructions

### Services overview

| Service | Port | Command |
|---------|------|---------|
| PostgreSQL (pgvector) | 5432 | `sudo docker start nitrogen-db` (container already exists) |
| Backend (FastAPI) | 8000 | `cd backend && python3 -m uvicorn app.main:app --reload --port 8000` |
| Frontend (Next.js) | 3000 | `cd frontend && npm run dev` |

### Running services
- **Database**: PostgreSQL with pgvector runs in a Docker container named `nitrogen-db`. Start with `sudo docker start nitrogen-db`. Verify with `sudo docker exec nitrogen-db pg_isready -U postgres`.
- **Backend**: See `.cursor/rules/dev-setup.mdc` for standard commands. Ensure `PATH` includes `/home/ubuntu/.local/bin` (pip install location).
- **Frontend**: See `.cursor/rules/dev-setup.mdc`. If you see assessment errors (`Cannot find assessment './vendor-chunks/...'`), clear the Next.js cache: `cd frontend && rm -rf .next && npm run dev`.

### Auth in dev mode
- Firebase is **not configured** in the Cloud VM. The backend automatically falls back to a "shared-user" mock auth when `FIREBASE_PROJECT_ID` is unset.
- The frontend uses an **access code** bypass (code: `REDACTED_ACCESS_CODE`) — enter this on the login page to proceed without Firebase.

### Key commands
- **Lint**: `cd frontend && npx next lint`
- **Tests**: `cd backend && python3 -m pytest tests/ -v`
- **Build**: `cd frontend && npx next build`
- **Migrations**: `cd backend && alembic upgrade head`

### Gotchas
- `OPENAI_API_KEY` is set to a placeholder in `backend/.env`. AI chat replies will fail with an OpenAI error unless a real key is provided via the `OPENAI_API_KEY` secret. Non-chat features (project CRUD, exports template) still work.
- The backend reads `.env` from its own directory (`backend/.env`), not the repo root.
- Python pip installs to `/home/ubuntu/.local/bin`; ensure this is on `PATH`.
