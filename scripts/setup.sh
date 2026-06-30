#!/usr/bin/env bash
# One command to get the dev simulator running.
#   bash scripts/setup.sh          # first time / after env changes
#   bash scripts/setup.sh --status # check only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

status_only=0
[[ "${1:-}" == "--status" ]] && status_only=1

print_banner() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Nitrogen dev simulator"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

missing_vars() {
  local missing=()
  [[ -z "${DATABASE_URL:-}" ]] && missing+=(DATABASE_URL)
  [[ -z "${NEXT_PUBLIC_FIREBASE_API_KEY:-}" ]] && missing+=(NEXT_PUBLIC_FIREBASE_API_KEY)
  [[ -z "${FIREBASE_PROJECT_ID:-}" ]] && missing+=(FIREBASE_PROJECT_ID)
  [[ -z "${NITROGEN_FIREBASE_CREDENTIALS:-}" && -z "${FIREBASE_SERVICE_ACCOUNT_JSON:-}" ]] && \
    missing+=(NITROGEN_FIREBASE_CREDENTIALS)
  printf '%s\n' "${missing[@]}"
}

load_env() {
  if [[ -f "$ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env"
    set +a
  fi
}

print_status() {
  local tier mode
  load_env

  if [[ -n "${DATABASE_URL:-}" ]] && \
     [[ -n "${NEXT_PUBLIC_FIREBASE_API_KEY:-}" ]] && \
     { [[ -n "${NITROGEN_FIREBASE_CREDENTIALS:-}" ]] || [[ -n "${FIREBASE_SERVICE_ACCOUNT_JSON:-}" ]]; }; then
    tier="full stack (local backend + frontend)"
    mode=":3000 UI  →  :8000 API  →  your DATABASE_URL"
  elif [[ -n "${NEXT_PUBLIC_FIREBASE_API_KEY:-}" ]]; then
    tier="frontend only (API hits production)"
    mode=":3000 UI  →  ${NEXT_PUBLIC_API_URL:-production Railway}"
  else
    tier="not configured"
    mode="run: bash scripts/setup.sh"
  fi

  echo ""
  echo "  Mode:   $tier"
  echo "  Path:   $mode"
  bash "$ROOT/scripts/dev_daemon.sh" status 2>/dev/null || true
  echo ""
}

resolve_env() {
  echo "→ Installing dependencies…"
  pip install -q -r "$ROOT/backend/requirements.txt"
  bash "$ROOT/scripts/worktree_setup.sh" 2>/dev/null || true
  echo "→ Resolving .env…"
  bash "$ROOT/scripts/materialize_dev_env.sh" || true
  load_env
}

maybe_migrate() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    return 0
  fi
  echo "→ Running migrations…"
  (cd "$ROOT/backend" && python3 -m alembic upgrade head 2>/dev/null) || \
    echo "  ⚠ Migrations skipped (DB not reachable yet)"
}

start_stack() {
  echo "→ Starting dev simulator…"
  bash "$ROOT/scripts/dev_daemon.sh" restart
}

report_gaps() {
  local missing
  missing=$(missing_vars)
  if [[ -z "$missing" ]]; then
    echo ""
    echo "✓ Full stack configured"
    echo "  Open http://localhost:3000"
    return 0
  fi

  echo ""
  echo "⚠ Partial setup — simulator is up but missing:"
  echo "$missing" | sed 's/^/    /'
  echo ""
  echo "  To get full local stack, add those to ONE of:"
  echo "    • root .env on your machine (local dev)"
  echo "    • Cursor → Cloud Agents → Secrets (cloud agents)"
  echo "    • See scripts/cursor_secrets_manifest.txt for the full list"
  echo ""
  echo "  Frontend should still work at http://localhost:3000"
}

# ── Main ──────────────────────────────────────────────────────────────────────

print_banner

if [[ "$status_only" == "1" ]]; then
  print_status
  exit 0
fi

resolve_env
maybe_migrate
start_stack
sleep 8
print_status
report_gaps
