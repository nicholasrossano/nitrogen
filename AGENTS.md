# AGENTS

Keep this file minimal and always-on. Put specialized guidance in `docs/agent-playbook.md`.

## Core Rules

- Make surgical changes only; avoid broad refactors unless explicitly requested.
- If a request is high-risk (security/schema/architecture/core flows) or ambiguous, ask 1–3 clarifying questions.
- Start from the narrowest relevant files and symbols; expand scope only when needed.
- Stop and ask before touching more than 3 unrelated files or crossing unrelated domains.
- Prefer extending existing utilities/components before introducing new abstractions.
- Add concise "How to verify" steps with every substantive change.

## Routine response length

- Keep routine replies short and direct; do not narrate obvious tool use or restate the full task unless it clarifies something.
- Prefer a tight paragraph or a few bullets over long explanations; use normal, complete sentences (not cryptic shorthand).
- Preserve full precision for code, commands, file paths, errors, API names, and validation results.
- Go longer only for high-risk topics (security, payments, auth, schema/architecture), meaningful tradeoffs, or when the user asks for depth.
- Final handoffs should cover what changed, what was validated, and real risks; no fixed template required.

## Token Budget Protocol

- Use scoped search first (`rg` with path/glob, targeted file reads); avoid broad repo scans by default.
- Do not read large docs/files end-to-end unless directly required.
- Use narrow tests while iterating (single case/file/unit subset), then full regression only at final validation.
- Use quiet/fail-fast commands (`pytest -q -x`, Jest `--silent --bail`, or `npm run test:*:quiet`).
- On failure, inspect only the first relevant failure block; open full logs only if still inconclusive.

### Terminal Output Safety

Chat transcripts absorb **unbounded shell output** as model input. A single huge `find`, recursive `grep`, full log paste, or `cat` of a lockfile/build artifact can blow past **millions of tokens**.

- Never print unbounded repository output into the chat. Cap stdout (`head`/`tail`/`wc`), or write full output to **ignored** `.test-output/` and paste only a short summary.
- Avoid by default: `find .`, `ls -R`, `du -ah .`, `grep -R`, root-level `rg .` without `--glob` excludes, and `cat` on large logs, lockfiles, generated files, dependency trees, source maps, build artifacts, or binary-ish files—unless the task explicitly requires it.
- Prefer `git ls-files`, scoped `rg` with path + `--glob` excludes, targeted reads, and `npm run cursor:audit` / `scripts/safe_search.sh` for audits.
- Broad scans must exclude at minimum: `**/node_modules/**`, `.git`, `**/.next/**`, `dist`, `build`, `coverage`, `htmlcov`, `.test-output`, caches, logs, and generated/binary artifacts.
- Full regression (whole-suite tests, full CI-equivalent runs) is **final validation**, not the default iteration loop.

## Validation Workflow

1. Run the narrowest meaningful check for the edited area.
2. Fix issues and re-run the same narrow check.
3. Run broader regression only if changes affect shared contracts or before final handoff.

Always run lints on changed files before finalizing. If migration or ORM schema changes are made, run:

```bash
cd backend && python3 -m alembic upgrade head
```

## Fast Command Matrix

| Goal | Command |
|---|---|
| Backend targeted test | `cd backend && python3 -m pytest -q -x <path-or-nodeid>` |
| Backend lint | `cd backend && ruff check .` |
| Backend format check | `cd backend && ruff format --check .` |
| Frontend targeted test | `cd frontend && npm test -- --runInBand --silent --bail <path> -t "<name>"` |
| Frontend typecheck | `cd frontend && npm run typecheck` |
| Frontend lint | `cd frontend && npm run lint` |
| Quiet backend wrapper | `npm run test:backend:quiet -- <path-or-nodeid>` |
| Quiet frontend wrapper | `npm run test:frontend:quiet -- <path>` |
| Safe token/repo audit | `npm run cursor:audit` |
| Full backend regression | `cd backend && python3 -m pytest tests/ -q` |
| Full frontend regression (final) | `cd frontend && npm run typecheck && npm run lint && npm run test:coverage && npm run build` |

More examples and wrappers: `docs/testing.md`.

## Critical Product Routing

There are two chat surfaces. Default to **Generate flow (standalone)** unless the user explicitly says "project plan" or "side chat":

- Generate flow: `LandingInput.tsx`, `ConversationView.tsx`, `ProjectStandaloneChatView.tsx`
- Project plan side chat: `ChatPanel.tsx`, `EditorSidePanel.tsx`

Do not modify `ToolPicker.tsx` when the request is about generate-flow landing tiles.

## Session startup (always run first)

At the start of every cloud agent session, run:

```bash
python3 scripts/sync_secrets_to_vercel.py
```

This reads secrets injected by Cursor Secrets, syncs them to Vercel, and writes the local `.env`. If `VERCEL_TOKEN` is not yet injected it skips Vercel sync gracefully and still writes `.env` from whatever is available.

## Local emulator and cloud agents (auth)

Recurring failure mode: overwriting root `.env` from `.env.example` (empty Firebase → login broken).

- **Never** run `cp .env.example .env` over an existing `.env` or invent secrets.
- Before starting: `bash scripts/worktree_setup.sh` then `bash scripts/check_dev_env.sh`.
- Start both servers: `bash scripts/start_emulator.sh` (requires root `.env` with Firebase + DATABASE_URL).
- **Firebase mode (required locally):** `NEXT_PUBLIC_FIREBASE_*` + `FIREBASE_PROJECT_ID` + service account credentials must all be set.
- **Never** start local dev without Firebase — mock auth was removed to avoid signing in as the wrong user.
- Art Lab (`/art-lab`) also needs **Developer Mode** in Settings.

## Specialized Guidance (Read Only When Relevant)

For detailed conventions and edge-case policy, consult `docs/agent-playbook.md` sections as needed:

- schema/deployment safety
- documentation maintenance and API docs rules
- PR and issue formatting
- environment symlink rules
- local/cloud run details
- loading art authoring rules

## Maintenance Rule

- Add new rules only when they prevent a recurring class of mistakes.
- Keep this file concise; migrate niche guidance to `docs/agent-playbook.md`.
