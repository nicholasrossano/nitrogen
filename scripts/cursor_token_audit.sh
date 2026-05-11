#!/usr/bin/env bash
# Safe broad audit for Cursor token risks. Detailed log under .test-output/; stdout is a short summary only.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/.test-output"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d%H%M%S)"
LOG="$OUT_DIR/cursor-token-audit-${STAMP}.log"

{
  echo "cursor_token_audit.sh — $STAMP"
  echo ""
  echo "=== Top 40 tracked files (bytes) ==="
  git -C "$ROOT_DIR" ls-files -z 2>/dev/null | xargs -0 du -b 2>/dev/null | sort -nr | head -40 || true
  echo ""
  echo "=== Lockfile line counts ==="
  wc -l "$ROOT_DIR/frontend/package-lock.json" "$ROOT_DIR/package-lock.json" 2>/dev/null || true
  echo ""
  echo "=== backend/app / frontend/src / docs sizes ==="
  du -sh "$ROOT_DIR/backend/app" "$ROOT_DIR/frontend/src" "$ROOT_DIR/docs" 2>/dev/null || true
  echo ""
  echo "=== pytest / jest / coverage hints in CI + package.json (first 80 lines) ==="
  rg -n 'pytest|jest|coverage|cov-report|term-missing|npm run test' \
    "$ROOT_DIR/.github/workflows" "$ROOT_DIR/package.json" "$ROOT_DIR/frontend/package.json" \
    2>/dev/null | head -80 || true
  echo ""
  echo "=== scripts: scan-prone commands in *.sh (first 40 matches) ==="
  rg -n -g '*.sh' 'find \.|grep -[rR]|ls -R|git rev-list' "$ROOT_DIR/scripts" 2>/dev/null | head -40 || true
  echo ""
  echo "=== Migration count ==="
  ls -1 "$ROOT_DIR/backend/alembic/versions" 2>/dev/null | wc -l || true
} >"$LOG"

echo "Detailed audit log: .test-output/$(basename "$LOG")"
echo "--- Brief excerpt ---"
head -22 "$LOG"
