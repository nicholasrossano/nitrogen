# AGENTS

Keep this file minimal and always-on. Put specialized guidance in `docs/agent-playbook.md`.

## Core Rules

- Product display name is **Nitrogen AI** — never bare "Nitrogen" in user-facing copy (README, docs, UI chrome, emails). Code identifiers, env keys, paths, and repo URLs may still use `nitrogen`.
- Make surgical changes only; avoid broad refactors unless explicitly requested.
- If a request is high-risk (security/schema/architecture/core flows) or ambiguous, ask 1–3 clarifying questions.
- Start from the narrowest relevant files and symbols; expand scope only when needed.
- Stop and ask before touching more than 3 unrelated files or crossing unrelated domains.
- Prefer extending existing utilities/components before introducing new abstractions.
- Add concise "How to verify" steps with every substantive change.

## Code comments

- Prefer **why**, **invariants**, **business rules**, **edge cases**, and **risks** over narrating the code.
- Do not add comments that only restate obvious control flow or identifiers.
- Keep comments short and aligned with current behavior; fix or delete stale notes.
- Avoid commented-out code and large pasted examples, logs, or payloads in source (point to tests/docs instead).
- Preserve (but tighten) comments on auth, billing, security, migrations, data contracts, and non-obvious product policy.

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
| Dev simulator (start everything) | `bash scripts/setup.sh` |
| Dev simulator status | `bash scripts/setup.sh --status` |

More examples and wrappers: `docs/testing.md`.

## Critical Product Routing

Project work lives on **`/projects/[id]`** (Chat is the default floor; Overview / Variables / Files / Assessments via `?panel=`). Assessments and documents open as **floats**.

- Chat floor / generate flow: `LandingInput.tsx`, `ConversationView.tsx`, `ProjectChatSurface.tsx` (in `ProjectWorkbench.tsx`)
- Personal (no-project) chat: `PersonalChatSurface.tsx` on `/chat`
- Floors / floats: `FloorLayer.tsx`, `FloatLayer.tsx`, `ChatContextStack.tsx`

Landing tiles live in `LandingInput.tsx` (do not look for a separate picker component).

## Session startup (always run first)

At the start of every cloud agent session, run:

```bash
python3 scripts/sync_secrets_to_vercel.py
```

This reads secrets injected by Cursor Secrets, syncs them to Vercel, and writes the local `.env`. If `VERCEL_TOKEN` is not yet injected it skips Vercel sync gracefully and still writes `.env` from whatever is available.

On a laptop with the Railway CLI linked, also keep local Stripe/billing in lockstep with production:

```bash
bash scripts/sync_prod_secrets_to_local.sh
```

`dev_daemon.sh start|restart` and `setup.sh` run this automatically so placeholder `sk_test_local` / `price_local_*` keys cannot stick in `.env` across restarts.

## Local emulator and cloud agents (auth)

**Three dev paths — do not conflate them:**

| Path | Who | How |
|---|---|---|
| **Native dev (default)** | You locally, cloud agents | `bash scripts/dev_daemon.sh start` — Python + Node on host, Neon or local Postgres |
| **Docker (optional)** | OSS self-hosters who want local Postgres in a container | `docker compose up -d` — see README § Docker |
| **Deployed** | Production | Vercel + Railway env dashboards |

Cloud agent VMs **do not have Docker** and **do not use `docker compose`**. Never suggest Docker as a fix on a cloud VM. The default stack is always `dev_daemon.sh`.

**Agents own the dev stack — never ask the user to start servers.** At the start of any task that needs the running app:

```bash
bash scripts/setup.sh --status || bash scripts/setup.sh
```

**Local `.env` does not sync to cloud VMs.** The user's laptop `.env` is gitignored and never cloned. Vercel/Railway dashboard vars apply to deployed apps only. Cloud agents need Cursor secrets (see `docs/self-hosting.md`) or `bootstrap_env_from_production.sh` fallback.

**Verification tiers on cloud VMs (report honestly):**

| Tier | What's running | What you can verify |
|---|---|---|
| Frontend only | `:3000` up, API hits production Railway | UI, routing, Firebase login screen, static flows |
| Full local stack | `:3000` + `:8000` with `DATABASE_URL` + Firebase creds in Cursor secrets | Login with data, chat, uploads, assessments |

If only tier 1 is available, say so — do not claim you verified authenticated data flows. Report missing secrets when the stack is incomplete; Docker is not available on cloud agent VMs.

- **Never** `cp .env.example .env` over a real env file — it breaks Firebase login.
- **Firebase required:** `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_PROJECT_ID`, and a service account must be configured for full stack.
- Art Lab (`/art-lab`) also needs **Developer Mode** in Settings.

## Specialized Guidance (Read Only When Relevant)

For detailed conventions and edge-case policy, consult `docs/agent-playbook.md` sections as needed:

- schema/deployment safety
- documentation maintenance and API docs rules
- PR and issue formatting
- environment symlink rules
- local/cloud run details
- loading art authoring rules

## Cursor Cloud specific instructions

### Known setup gotchas

1. **`mcp` package version**: `requirements.txt` specifies `mcp>=1.28.0` but pip resolves to 2.0+ which removed `mcp.server.fastmcp`. Pin with `pip install "mcp>=1.28.0,<2.0"` after `pip install -r requirements.txt` until `requirements.txt` is updated.
2. **`CORS_ORIGINS` in materialized `.env`**: `materialize_dev_env.sh` uses `printf '%q'` which shell-escapes brackets/quotes in the JSON array. If backend fails with `SettingsError: error parsing value for field "cors_origins"`, manually fix the line in `.env` to raw JSON: `CORS_ORIGINS=["http://localhost:3000","http://localhost:3001"]`.
3. **Docker is available** on this VM (installed during environment setup), contrary to the general cloud agent note above. The `nitrogen-db` pgvector container is available if you need local Postgres instead of Neon.

## Maintenance Rule

- Add new rules only when they prevent a recurring class of mistakes.
- Keep this file concise; migrate niche guidance to `docs/agent-playbook.md`.
