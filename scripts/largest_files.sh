#!/usr/bin/env bash
# List largest tracked files and selected tree sizes. Full report always under .test-output/.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/.test-output"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/largest-files-${STAMP}.txt"

{
  echo "largest-files.sh — $STAMP"
  echo ""
  echo "=== Top tracked files by bytes (git ls-files) ==="
  if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$ROOT_DIR" ls-files -z 2>/dev/null | xargs -0 du -b 2>/dev/null | sort -nr | head -60
  else
    echo "(not a git repo)"
  fi
  echo ""
  echo "=== Selected directory sizes (approx, includes node_modules if present) ==="
  du -sh "$ROOT_DIR/backend" "$ROOT_DIR/frontend" "$ROOT_DIR/docs" "$ROOT_DIR/scripts" 2>/dev/null || true
} >"$REPORT"

echo "Summary (top of full report):"
head -28 "$REPORT"
echo ""
echo "Full report: .test-output/$(basename "$REPORT")"
