# Agent Playbook (On-Demand)

Use this file only when the task needs domain-specific policy not covered by `AGENTS.md`.

## Architecture and Migration

- For pre-launch architecture upgrades, prefer full cutover over long-lived compatibility shims.
- If a temporary shim is unavoidable, annotate owner and removal trigger in the same PR.
- For noteworthy migrations, do not keep dual legacy/new infra paths indefinitely.

## Backend Schema and Deployment Safety

- For schema/ORM renames, use expand/contract: add compatible fields first, remove legacy names later.
- Do not merge backend model changes that assume DB columns/tables absent in production.
- Before finalizing schema-sensitive backend changes, smoke-check project detail, chat history, evidence, and project materials flows.
- If a production hotfix is needed during feature-branch schema work, patch `main` minimally and backport intentionally.

## Documentation Maintenance

- Update docs in the same PR when contracts/patterns change:
  - architecture contracts: `docs/architecture.md`
  - assessments authoring patterns: `docs/assessments/authoring-guide.md`
  - adapter contracts: `docs/adapters/authoring-guide.md`
  - setup/env/dev commands: `docs/setup.md`
  - user-facing product docs (Mintlify): `help/` — see `help/README.md`
- Every new FastAPI route should include a docstring.
- Every new Pydantic field should include `Field(description="...")`.
- Do not maintain static lists of capabilities in docs; prefer live capabilities endpoint references.

## PR and Issue Conventions

- PR bodies must fully populate `.github/PULL_REQUEST_TEMPLATE.md` (no placeholder text).
- Issue titles should be plain-language and easy to scan.
- Issue body default order: `Title`, `Body`, `## Scope`, `## Done when`.
- Use one `type/*` label plus 1-2 `area/*` labels unless explicitly instructed otherwise.

## Environment Rules

- The real env file is repo root `.env`.
- `backend/.env` and `frontend/.env.local` must remain symlinks to root `.env`.
- Never replace those symlinks with standalone files.
- Add new env vars to both `.env` and `.env.example`.

## Local and Cloud Run Notes

- Local emulator standard: backend on `8000`, frontend on `3000`, open app at `http://localhost:3000`.
- If Next dev cache corruption appears (`vendor-chunks`/missing module artifacts), clear `.next` and restart dev.
- For cloud VM usage, check path and service setup details in `.cursor/rules/dev-setup.mdc`.

### Cloud agents — `.env` and auth

Gitignored root `.env` is often absent on cloud VMs. Worktrees do not share `.env` (`CLAUDE.md`).

1. Prefer `bash scripts/dev_daemon.sh start` — persistent tmux + auto-restart (do not use bare `&` background processes).
2. Env resolution (`scripts/materialize_dev_env.sh`): existing `.env` → `NITROGEN_ENV_FILE` symlink → whitelisted Cursor/process secrets. **Never** `cp .env.example .env`.
3. If materialization fails, add Cursor secrets (same names as `.env.example` keys) or ask the user for a real `.env`. **Never** start local dev without Firebase — mock auth was removed.
4. **Firebase required locally:** `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_PROJECT_ID`, and `NITROGEN_FIREBASE_CREDENTIALS` (or `FIREBASE_SERVICE_ACCOUNT_JSON`) must be set.

## UI and Loading Art Guidance

- UI design source of truth is `docs/style-guide.md`.
- For loading art shapes, prefer deterministic math-based generators and keep shared physics logic centralized.
- Keep loading art registry alphabetized by name.
