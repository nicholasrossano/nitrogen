#!/usr/bin/env bash
# Quick hygiene scan: largest tracked files + risky patterns in scripts/CI (capped stdout).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/.test-output"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d%H%M%S)"
REPORT="$OUT_DIR/safe-repo-scan-${STAMP}.txt"

{
  echo "safe_repo_scan.sh — $STAMP"
  echo ""
  echo "=== Top tracked files by bytes (git ls-files, top 50) ==="
  git -C "$ROOT_DIR" ls-files -z 2>/dev/null | xargs -0 du -b 2>/dev/null | sort -nr | head -50 || true
  echo ""
  echo "=== Selected directory sizes ==="
  du -sh "$ROOT_DIR/backend" "$ROOT_DIR/frontend" "$ROOT_DIR/docs" "$ROOT_DIR/scripts" 2>/dev/null || true
  echo ""
  echo "=== Risky shell idioms in scripts + .github (first 50 lines) ==="
  rg -n --glob '!**/.git/**' \
    --glob '!**/node_modules/**' \
    'find \.|grep -[rR]|ls -R|du -ah \.|git rev-list --all' \
    "$ROOT_DIR/scripts" "$ROOT_DIR/.github" 2>/dev/null | head -50 || true
} >"$REPORT"

echo "Summary:"
head -40 "$REPORT"
echo ""
echo "Full scan log: .test-output/$(basename "$REPORT")"
