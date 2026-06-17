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
  "sk-(?!your-openai-api-key-here)[A-Za-z0-9_-]{20,}"
  "ghp_[A-Za-z0-9]{20,}"
  "AKIA[0-9A-Z]{16}"
  "AIza[0-9A-Za-z_-]{20,}"
  "-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----"
  "(?i)(api[_-]?key|client[_-]?secret)\\s*=\\s*['\\\"][^'\\\"]{12,}['\\\"]"
)

is_placeholder_match() {
  local line="$1"
  [[ "$line" == *"your-openai-api-key-here"* ]] && return 0
  [[ "$line" == *"postgres:postgres@localhost"* ]] && return 0
  [[ "$line" == *"test-key-not-real"* ]] && return 0
  [[ "$line" == *"ci-placeholder"* ]] && return 0
  [[ "$line" == *"read_env_var"* ]] && return 0
  return 1
}

filter_real_matches() {
  local input="$1"
  local output="$2"
  : >"$output"
  local line
  while IFS= read -r line; do
    if ! is_placeholder_match "$line"; then
      echo "$line" >>"$output"
    fi
  done <"$input"
  [[ -s "$output" ]]
}

run_worktree_scan() {
  echo "==> Scanning working tree for potential secrets..."
  local found=0
  local -a glob_args
  for ex in "${EXCLUDES[@]}"; do
    glob_args+=(--glob "!$ex")
  done

  for p in "${PATTERNS[@]}"; do
    if rg -n --hidden --pcre2 "$p" "${glob_args[@]}" . >/tmp/nitrogen_secret_scan.$$ 2>/dev/null; then
      if filter_real_matches /tmp/nitrogen_secret_scan.$$ /tmp/nitrogen_secret_scan_filtered.$$; then
        echo ""
        echo "[MATCH] Pattern: $p (first 200 lines)"
        head -200 /tmp/nitrogen_secret_scan_filtered.$$
        found=1
      fi
    fi
  done

  rm -f /tmp/nitrogen_secret_scan.$$ /tmp/nitrogen_secret_scan_filtered.$$ || true
  return "$found"
}

run_history_scan() {
  echo "==> Scanning git history..."
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
      [[ -z "$commit" ]] && continue
      if ! git grep -I -n -E "$p" "$commit" -- . "${history_excludes[@]}" 2>/dev/null >/tmp/nitrogen_secret_history_scan.$$; then
        continue
      fi
      if ! filter_real_matches /tmp/nitrogen_secret_history_scan.$$ /tmp/nitrogen_secret_history_filtered.$$; then
        continue
      fi
      echo ""
      echo "[HISTORY MATCH] Pattern: $p (commit: $commit) — first 200 lines"
      head -200 /tmp/nitrogen_secret_history_filtered.$$
      found=1
      break 2
    done < <(git log --all -G "$p" --format=%H 2>/dev/null || true)
  done

  rm -f /tmp/nitrogen_secret_history_scan.$$ /tmp/nitrogen_secret_history_filtered.$$ || true
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

  if ! bash "$ROOT_DIR/scripts/check_tracked_artifacts.sh"; then
    worktree_status=1
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
