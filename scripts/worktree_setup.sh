#!/usr/bin/env bash
# Worktree bootstrap: symlink .env and install frontend deps.
# Run from the worktree root.
set -euo pipefail

WORKTREE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN_ROOT="$(git -C "$WORKTREE_ROOT" worktree list --porcelain | head -1 | sed 's/^worktree //')"

# ── Symlink .env ──────────────────────────────────────────────
if [ -f "$MAIN_ROOT/.env" ]; then
  ln -sfn "$MAIN_ROOT/.env" "$WORKTREE_ROOT/.env"
  ln -sfn ../.env "$WORKTREE_ROOT/frontend/.env.local"
  ln -sfn ../.env "$WORKTREE_ROOT/backend/.env"
  echo "✓ .env symlinks created"
else
  echo "⚠ No .env in main repo ($MAIN_ROOT) — skipping"
fi

# ── Frontend node_modules ─────────────────────────────────────
if [ ! -d "$WORKTREE_ROOT/frontend/node_modules" ]; then
  echo "Installing frontend dependencies…"
  (cd "$WORKTREE_ROOT/frontend" && npm install --prefer-offline --no-audit --no-fund)
  echo "✓ frontend node_modules installed"
else
  echo "✓ frontend node_modules already present"
fi
