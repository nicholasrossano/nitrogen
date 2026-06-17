#!/usr/bin/env bash
# Worktree bootstrap: symlink .env and install frontend deps.
# Run from the worktree root.
set -euo pipefail

WORKTREE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN_ROOT="$(git -C "$WORKTREE_ROOT" worktree list --porcelain | head -1 | sed 's/^worktree //')"

# ── Symlink .env ──────────────────────────────────────────────
link_env_targets() {
  ln -sfn ../.env "$WORKTREE_ROOT/frontend/.env.local"
  ln -sfn ../.env "$WORKTREE_ROOT/backend/.env"
}

if [ -f "$WORKTREE_ROOT/.env" ]; then
  link_env_targets
  echo "✓ .env symlinks created"
elif [ -f "$MAIN_ROOT/.env" ] && [ "$MAIN_ROOT" != "$WORKTREE_ROOT" ]; then
  ln -sfn "$MAIN_ROOT/.env" "$WORKTREE_ROOT/.env"
  link_env_targets
  echo "✓ .env symlinks created from main worktree"
else
  echo "⚠ No .env found — copy .env.example to .env and configure Firebase + DATABASE_URL"
fi

# ── Frontend node_modules ─────────────────────────────────────
if [ ! -d "$WORKTREE_ROOT/frontend/node_modules" ]; then
  echo "Installing frontend dependencies…"
  (cd "$WORKTREE_ROOT/frontend" && npm install --prefer-offline --no-audit --no-fund)
  echo "✓ frontend node_modules installed"
else
  echo "✓ frontend node_modules already present"
fi
