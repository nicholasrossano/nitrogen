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
- When I receive feedback or correction from you, interpret whether it reflects a reusable pattern or preference.
- If it seems fundamental enough (not just a one-off fix), add it to AGENTS.md automatically.
- Keep additions lightweight and actionable. Avoid overly broad rules.
- Organize new practices under relevant sections (General Workflow, UI/Design, or create domain-specific sections like Backend, Testing, etc.).
- Mention the update briefly: "Added to AGENTS.md: [rule]"

## UI/Design
Follow `Docs/STYLEGUIDE.md` as the source of truth.

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
