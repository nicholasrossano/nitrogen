#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCAN_HISTORY=false
if [[ "${1:-}" == "--history" ]]; then
  SCAN_HISTORY=true
fi

# Exclude obvious placeholders, docs, lockfiles, dependency/build noise, and giant generated paths.
EXCLUDES=(
  ".env.example"
  "docs/**"
  "**/*.md"
  "**/*.lock"
  "**/node_modules/**"
  ".git/**"
  "**/.next/**"
  "**/dist/**"
  "**/build/**"
  "**/out/**"
  "**/coverage/**"
  "**/htmlcov/**"
  ".test-output/**"
  "**/__pycache__/**"
  "**/*.map"
)

PATTERNS=(
  "sk-[A-Za-z0-9_-]{20,}"
  "ghp_[A-Za-z0-9]{20,}"
  "AKIA[0-9A-Z]{16}"
  "AIza[0-9A-Za-z_-]{20,}"
  "-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----"
  "(?i)(api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\\s*[=:]\\s*['\\\"]?[A-Za-z0-9._-]{12,}"
)

run_worktree_scan() {
  echo "==> Scanning working tree for potential secrets..."
  local found=0
  local -a glob_args
  for ex in "${EXCLUDES[@]}"; do
    glob_args+=(--glob "!$ex")
  done

  for p in "${PATTERNS[@]}"; do
    if rg -n --hidden --pcre2 "$p" "${glob_args[@]}" . >/tmp/nitrogen_secret_scan.$$ 2>/dev/null; then
      echo ""
      echo "[MATCH] Pattern: $p (first 200 lines; full scan was written to temp)"
      head -200 /tmp/nitrogen_secret_scan.$$
      found=1
    fi
  done

  rm -f /tmp/nitrogen_secret_scan.$$ || true
  return "$found"
}

run_history_scan() {
  echo "==> Scanning git history (this can take a while)..."
  local found=0
  local commit
  local -a history_excludes=(
    ":(exclude).env.example"
    ":(exclude)**/*.example"
    ":(exclude)**/*.example.*"
    ":(exclude)**/*.md"
    ":(exclude)**/*.lock"
    ":(exclude,glob)**/node_modules/**"
    ":(exclude,glob)**/.git/**"
    ":(exclude,glob)**/.next/**"
    ":(exclude,glob)**/dist/**"
    ":(exclude,glob)**/build/**"
    ":(exclude,glob)**/coverage/**"
    ":(exclude,glob)**/*.map"
  )

  for p in "${PATTERNS[@]}"; do
    while read -r commit; do
      if git grep -I -n -E "$p" "$commit" -- . "${history_excludes[@]}" 2>/dev/null >/tmp/nitrogen_secret_history_scan.$$; then
        echo ""
        echo "[HISTORY MATCH] Pattern: $p (commit: $commit) — first 200 lines"
        head -200 /tmp/nitrogen_secret_history_scan.$$
        found=1
        break
      fi
    done < <(git rev-list --all)
  done

  rm -f /tmp/nitrogen_secret_history_scan.$$ || true
  return "$found"
}

main() {
  local worktree_status=0
  local history_status=0

  if run_worktree_scan; then
    worktree_status=0
    echo "✅ Working tree scan passed."
  else
    worktree_status=1
    echo "❌ Working tree scan found potential secrets."
  fi

  if [[ "$SCAN_HISTORY" == "true" ]]; then
    if run_history_scan; then
      history_status=0
      echo "✅ History scan passed."
    else
      history_status=1
      echo "❌ History scan found potential secrets."
    fi
  else
    echo "ℹ️  Skipping history scan. Re-run with --history for deep scan."
  fi

  if [[ "$worktree_status" -ne 0 || "$history_status" -ne 0 ]]; then
    echo "Security scan failed."
    exit 1
  fi

  echo "Security scan complete."
}

main
