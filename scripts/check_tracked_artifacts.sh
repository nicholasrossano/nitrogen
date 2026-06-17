#!/usr/bin/env bash
# Fail if user data paths or env files are tracked by git.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BLOCKED_PREFIXES=(
  "exports/"
  "uploads/"
  ".env"
)

found=0
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  if [[ "$path" == ".env.example" || "$path" == .env.*.example ]]; then
    continue
  fi
  for prefix in "${BLOCKED_PREFIXES[@]}"; do
    if [[ "$path" == "$prefix" || "$path" == "${prefix%/}" || "$path" == "$prefix"* ]]; then
      echo "❌ Tracked artifact or secret path: $path"
      found=1
      break
    fi
  done
done < <(git ls-files)

if [[ "$found" -ne 0 ]]; then
  echo "Remove these paths from git tracking before release."
  exit 1
fi

echo "✅ No tracked exports/, uploads/, or .env files."
