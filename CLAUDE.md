# Claude Instructions (Nitrogen)

Use `AGENTS.md` as the primary operating guide for workflow, testing, scope discipline, and **Terminal Output Safety** (avoid unbounded shell output in chat).

## Worktree Setup

Git worktrees don't share gitignored files (`.env`, `node_modules`).
Run `scripts/worktree_setup.sh` from the worktree root before starting dev servers.
It symlinks `.env` from the main repo and installs frontend deps if missing.

## Schema & Release Guardrails

- Treat `main` as production-compatible at all times.
- For DB/ORM renames, use expand/contract migrations (compatibility first, cleanup later).
- Do not assume new columns/tables on `main` until production migrations are applied.
- Before finalizing schema-related backend changes, smoke-test key initiative flows:
  - initiative detail
  - chat history
  - evidence list
  - project materials/files
  - drive linked files
- Keep large feature-branch schema evolution isolated from production hotfixes.
- If a production hotfix is needed while feature work is in progress, patch `main` minimally and ensure the feature branch already contains (or receives) equivalent safe behavior.
