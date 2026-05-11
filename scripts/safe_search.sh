#!/usr/bin/env bash
# rg wrapper: standard excludes for noisy/generated paths. Full hits also saved under .test-output/.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <pattern> [extra rg args...] [--] [paths]" >&2
  echo "Example: $0 'useFoo' -- frontend/src" >&2
  exit 2
fi

OUT_DIR="$ROOT_DIR/.test-output"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/safe-search-$(date +%Y%m%d%H%M%S).txt"

EXCLUDES=(
  --glob '!**/node_modules/**'
  --glob '!.git/**'
  --glob '!**/.next/**'
  --glob '!**/dist/**'
  --glob '!**/build/**'
  --glob '!**/out/**'
  --glob '!**/coverage/**'
  --glob '!**/htmlcov/**'
  --glob '!**/.test-output/**'
  --glob '!**/__pycache__/**'
  --glob '!**/.pytest_cache/**'
  --glob '!**/.ruff_cache/**'
  --glob '!**/.mypy_cache/**'
  --glob '!**/*.map'
)

set +e
rg -n "${EXCLUDES[@]}" "$@" 2>&1 | tee "$LOG" | head -120
rg_status=${PIPESTATUS[0]}
set -e

echo ""
echo "(stdout capped at 120 lines; full rg output: .test-output/$(basename "$LOG"))"
exit "$rg_status"
