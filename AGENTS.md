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

**Disabled button hover states:**
- Whenever a button has both `hover:X` effects and `disabled:opacity-*`, replace `hover:X` with `enabled:hover:X` so hover animations are suppressed when disabled while the `disabled:cursor-not-allowed` cursor still shows. For `btn-primary/secondary/danger` classes in `globals.css`, add `:disabled:hover::before { opacity: 0 }` CSS overrides to suppress the pseudo-element fill animation.

**Post-edit checks (always run):**
- After every substantive edit, call `ReadLints` on the edited file(s) before finalizing.
- Fix any linter errors introduced by the change before responding.
- For JSX in particular: watch for ternary branches with multiple sibling elements — they must be wrapped in a fragment (`<>...</>`).

**Import integrity after deletions (non-trivial changes):**
- After deleting any backend Python file, immediately `grep` the entire backend for imports of the deleted module before finalizing. Key aggregator files to check: `models/__init__.py`, `alembic/env.py`, `app/main.py`, and any API/service file that might lazy-import it.
- After deleting any frontend file, check its barrel exports (`index.ts`) and any files that import it by name.
- If the local servers are running (`localhost:8000`, `localhost:3000`), do a quick `curl http://localhost:8000/health` after backend edits to confirm the reload succeeded cleanly.

**Scope discipline:**
- Make surgical changes only. Do not refactor broadly unless I explicitly ask.
- If you see improvements, list them as optional follow-ups instead of doing them.

**Architecture migration posture:**
- For pre-launch architecture upgrades, prefer full cutover to the target design over long-lived compatibility shims.
- If a temporary shim is unavoidable, mark it clearly with owner + removal trigger in the same PR; do not leave indefinite legacy paths.

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
Follow `docs/style-guide.md` as the source of truth.

**Buttons (non-negotiable):**
- ALWAYS use one of the three global button classes. NEVER build a custom button with raw Tailwind.
  - `btn-primary` — primary / confirming actions (Export, Confirm, Generate, Submit). Accent border, fills with accent on hover.
  - `btn-secondary` — secondary / cancel actions. Neutral border, subtle hover.
  - `btn-danger` — destructive actions only (Delete, Remove).
- Full-width buttons: add `w-full` + size override `!px-4 !py-2` (or `!py-1.5` for compact panels).
- With icon: put the Lucide icon inside the button alongside the label — the class already provides `gap-2`.
- See `docs/style-guide.md § K) Buttons` for the full spec and examples.

**Page layout chrome (non-negotiable):**
- Every top-level page must use the three-part shell: `<div h-screen flex flex-col>` → `<header shrink-0 h-14>` → `<div flex flex-1 min-h-0>` (sidebar + workspace).
- The `<header className="shrink-0 h-14">` must always be present — even if empty — on every page state/branch. What changes is only the content inside it, never its presence. Never omit the header on any conditional render branch (e.g. a selection screen vs. an active workspace screen on the same route).

## Pull Requests
When creating a PR with `gh pr create`, always fill in the `.github/PULL_REQUEST_TEMPLATE.md` fields — never leave placeholder comment text in the final body. The template has two sections:
- **Summary**: 1–3 sentences on what the PR does and why. Include `Closes #N` only if there is a known issue number, otherwise omit that line.
- **Changes**: bullet points listing the key changes (one per logical change area).

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
- **Frontend**: See `.cursor/rules/dev-setup.mdc`. If you see module errors (`Cannot find module './vendor-chunks/...'`), clear the Next.js cache: `cd frontend && rm -rf .next && npm run dev`.

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
