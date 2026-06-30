#!/usr/bin/env bash
# Run this ON YOUR MACHINE (where root .env exists) to print values for
# Cursor → Cloud Agents → Secrets. Does not print values if .env is missing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

KEYS=(
  DATABASE_URL
  OPENAI_API_KEY
  FIREBASE_PROJECT_ID
  NITROGEN_FIREBASE_CREDENTIALS
  FIREBASE_SERVICE_ACCOUNT_JSON
  NEXT_PUBLIC_API_URL
  NEXT_PUBLIC_FIREBASE_API_KEY
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  NEXT_PUBLIC_FIREBASE_PROJECT_ID
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
  NEXT_PUBLIC_FIREBASE_APP_ID
  VERCEL_TOKEN
  VERCEL_PROJECT_ID
  VERCEL_ORG_ID
)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No $ENV_FILE found. Run from repo root after: cp .env.example .env"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "$ENV_FILE"
set +a

echo "Add each line below in Cursor → Cloud Agents → Secrets"
echo "(https://cursor.com/dashboard/cloud-agents)"
echo ""
echo "Secret name          | Present?"
echo "---------------------|----------"

missing=0
for key in "${KEYS[@]}"; do
  val="${!key:-}"
  if [[ -n "$val" ]]; then
    printf '%-21s| yes (%d chars)\n' "$key" "${#val}"
  else
    printf '%-21s| MISSING\n' "$key"
    missing=$((missing + 1))
  fi
done

echo ""
if [[ "$missing" -gt 0 ]]; then
  echo "$missing keys missing from .env — fill those in .env first, then re-run."
  exit 1
fi

echo "To copy a value for pasting into Cursor:"
echo "  grep '^DATABASE_URL=' .env | cut -d= -f2-"
echo ""
echo "For NITROGEN_FIREBASE_CREDENTIALS, paste the full JSON as one secret value."
echo "Do not commit .env or paste secrets into chat."
