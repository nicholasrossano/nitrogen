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
  echo "   cp .env.example .env and fill Firebase + DATABASE_URL."
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

if [[ -z "$firebase_api_key" ]]; then
  echo "❌ NEXT_PUBLIC_FIREBASE_API_KEY is required for local dev"
  exit 1
fi

if [[ -z "$firebase_project" ]]; then
  echo "❌ FIREBASE_PROJECT_ID is required — backend cannot verify Firebase tokens"
  exit 1
fi

echo "✓ Auth mode: Firebase"
echo "✓ DATABASE_URL set"
echo "✓ Dev environment OK"
