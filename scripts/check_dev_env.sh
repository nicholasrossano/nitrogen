#!/usr/bin/env bash
# Validate root .env before starting the local emulator.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

read_env_var() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 || true)"
  if [[ -z "$line" ]]; then
    return 0
  fi
  local value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Missing $ENV_FILE"
  echo "   Use your team .env at repo root (never commit it)."
  echo "   For mock-only smoke tests: bash scripts/start_emulator.sh (uses scripts/dev-mock.env)."
  exit 1
fi

for link in "$ROOT/backend/.env" "$ROOT/frontend/.env.local"; do
  if [[ ! -L "$link" ]] || [[ "$(readlink -f "$link")" != "$(readlink -f "$ENV_FILE")" ]]; then
    echo "⚠ $link is not symlinked to root .env — run: bash scripts/worktree_setup.sh"
  fi
done

database_url="$(read_env_var DATABASE_URL)"
if [[ -z "$database_url" ]]; then
  echo "❌ DATABASE_URL is not set in .env"
  exit 1
fi

firebase_api_key="$(read_env_var NEXT_PUBLIC_FIREBASE_API_KEY)"
firebase_project="$(read_env_var FIREBASE_PROJECT_ID)"
debug="$(read_env_var DEBUG)"

if [[ -n "$firebase_api_key" ]]; then
  echo "✓ Auth mode: Firebase (NEXT_PUBLIC_FIREBASE_API_KEY set)"
  if [[ -z "$firebase_project" ]]; then
    echo "⚠ FIREBASE_PROJECT_ID is empty — backend cannot verify Firebase tokens"
    exit 1
  fi
else
  if [[ "$debug" != "true" ]]; then
    echo "❌ No Firebase config and DEBUG is not true — enable mock auth with DEBUG=true"
    echo "   or add NEXT_PUBLIC_FIREBASE_* vars to .env"
    exit 1
  fi
  echo "✓ Auth mode: dev mock (DEBUG=true, no NEXT_PUBLIC_FIREBASE_API_KEY)"
fi

echo "✓ DATABASE_URL set"
echo "✓ Dev environment OK"
