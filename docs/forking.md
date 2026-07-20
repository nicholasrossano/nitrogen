# Forking and staying current with upstream

Nitrogen AI is designed to be forked and self-hosted. Your durable value — uploaded materials, workspace knowledge, and custom assessments — should survive upstream upgrades. This guide covers the git workflow that makes that practical.

For how to run a fork, see [self-hosting](self-hosting.md). For writing assessments, see [assessments/authoring-guide.md](assessments/authoring-guide.md). For naming your fork, see [TRADEMARKS.md](../TRADEMARKS.md).

## Mental model

| Layer | Examples | Upgrade behavior |
|-------|----------|------------------|
| Platform (replaceable) | App code, registries, UI | Replaced when you pull upstream |
| Config / machine state | `.env`, API keys, feature flags | Lives outside git; never overwritten by setup scripts if already present |
| Your data & expertise | Uploads, Postgres rows, workspace knowledge, **new assessment files you add** | Must not be wiped by an upgrade |

Git rebase (or merge) is how you take platform updates. **Filesystem layout** is what keeps your customizations safe: prefer **new files** over editing shared core files.

## One-time setup

After you fork and clone:

```bash
git remote add upstream https://github.com/nicholasrossano/nitrogen.git
git fetch upstream
```

Confirm remotes:

```bash
git remote -v
# origin    → your fork
# upstream  → Nitrogen AI canonical repo
```

## Pulling upstream updates

On a clean working tree:

```bash
git fetch upstream
git checkout main   # or your deploy branch
git rebase upstream/main
# or: git merge upstream/main
```

Then deploy as usual (migrations, restart). Always run:

```bash
cd backend && python3 -m alembic upgrade head
```

**Rebase vs merge:** rebase keeps a linear history and usually produces clearer conflicts; merge preserves exact history. Either works if you resolve conflicts carefully.

## What is safe to customize

**Usually rebase-clean (prefer these):**

- Brand-new assessment modules under `backend/app/domain/<pack>/assessments/` (and matching frontend widgets if needed)
- New adapters or helpers as **new files**
- Your own docs, scripts, or overlays outside shared core paths
- Env / secrets / storage / database contents (not in the install tree)

**Conflict-prone (edit sparingly):**

- Shared registration lists such as [`backend/app/domain/energy/catalog.py`](../backend/app/domain/energy/catalog.py) (today, registering a first-party assessment still touches this file — minimize edits; contribute shared assessments upstream when you can)
- Core chat/orchestration services, auth, billing, and migration history you didn't author
- Branding strings scattered in login/layout if you rename — keep a short personal checklist of those files

**Already durable without git:**

- Uploaded materials and evidence (storage backend + DB)
- Workspace knowledge banks and embeddings (Postgres / pgvector)
- Project and workspace data

## Contribute back

If an assessment or fix would help others:

1. Keep it as a focused commit (or branch) that mostly adds files
2. Open a PR against upstream `main`
3. Sign the [CLA](../CLA.md) when contributing

Private expertise can stay on your fork forever; rebase still works as long as your changes are mostly additive.

## After conflicts

1. Resolve only the overlapping hunks — do not discard your assessment files
2. Re-run targeted tests for anything you touched (`docs/testing.md`)
3. Confirm `alembic upgrade head` and a smoke pass on initiative/chat/evidence if you touched schema-adjacent code

## License reminder

Code remains AGPLv3. Forks and self-hosting are welcome; the Nitrogen AI **name** is reserved — rename your product if it is a separate offering ([TRADEMARKS.md](../TRADEMARKS.md)). Commercial terms outside AGPL are optional ([COMMERCIAL_LICENSE.md](../COMMERCIAL_LICENSE.md)).
