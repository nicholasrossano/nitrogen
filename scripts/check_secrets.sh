#!/usr/bin/env bash
# Validate that the API keys in .env are actually LIVE against their providers.
#
# Why this exists: a key can be present and well-formed but dead (revoked, or
# out of quota/credits). Those failures otherwise surface only mid-request as a
# generic "unexpected error". This checks the real thing, up front, and fails loud.
#
# Usage:
#   bash scripts/check_secrets.sh            # check keys found in .env
#   ENV_FILE=/path/to/.env bash scripts/check_secrets.sh
#
# Exit code is non-zero if any REQUIRED key (OpenAI) is missing or not live,
# so this is safe to gate CI / a predeploy step on.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ No env file at $ENV_FILE"
  exit 1
fi

# Read a single key from the env file without sourcing it (avoids executing
# arbitrary content). Returns empty string if absent.
read_key() {
  local name="$1"
  sed -n -E "s/^${name}=(.*)$/\1/p" "$ENV_FILE" | tail -1 | sed -E 's/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/'
}

fail=0

# ── OpenAI (required) ─────────────────────────────────────────────────────────
openai_key="$(read_key OPENAI_API_KEY)"
if [[ -z "$openai_key" ]]; then
  echo "❌ OPENAI_API_KEY  : MISSING (required)"
  fail=1
else
  # A 1-token completion is the only check that also catches quota exhaustion
  # (listing /models succeeds even when credits are gone). Cost is ~$0.000001.
  resp="$(curl -sS -m 30 -w $'\n%{http_code}' https://api.openai.com/v1/chat/completions \
    -H "Authorization: Bearer ${openai_key}" \
    -H "Content-Type: application/json" \
    -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}],"max_tokens":1}' 2>/dev/null)"
  code="$(printf '%s' "$resp" | tail -1)"
  body="$(printf '%s' "$resp" | sed '$d')"
  case "$code" in
    200) echo "✅ OPENAI_API_KEY  : LIVE (…${openai_key: -6})" ;;
    401) echo "❌ OPENAI_API_KEY  : INVALID / revoked (401)"; fail=1 ;;
    429)
      if printf '%s' "$body" | grep -q "insufficient_quota"; then
        echo "❌ OPENAI_API_KEY  : OUT OF QUOTA / CREDITS (429 insufficient_quota)"
        fail=1
      else
        echo "⚠  OPENAI_API_KEY  : RATE LIMITED (429) — key looks valid, retry later"
      fi
      ;;
    *) echo "❌ OPENAI_API_KEY  : unexpected HTTP $code"; fail=1 ;;
  esac
fi

# ── OpenRouter (optional) ─────────────────────────────────────────────────────
# Optional keys report status but never fail the gate: they may be intentionally
# absent/placeholder in local dev, and shouldn't block a required-key CI check.
or_key="$(read_key OPENROUTER_API_KEY)"
if [[ -n "$or_key" ]]; then
  code="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' https://openrouter.ai/api/v1/key \
    -H "Authorization: Bearer ${or_key}" 2>/dev/null)"
  case "$code" in
    200) echo "✅ OPENROUTER_API_KEY : LIVE" ;;
    401) echo "⚠  OPENROUTER_API_KEY : INVALID (401)" ;;
    *)   echo "⚠  OPENROUTER_API_KEY : unexpected HTTP $code" ;;
  esac
fi

# ── Stripe (optional) ─────────────────────────────────────────────────────────
stripe_key="$(read_key STRIPE_SECRET_KEY)"
if [[ -n "$stripe_key" ]]; then
  code="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' https://api.stripe.com/v1/balance \
    -u "${stripe_key}:" 2>/dev/null)"
  case "$code" in
    200) echo "✅ STRIPE_SECRET_KEY : LIVE" ;;
    401) echo "⚠  STRIPE_SECRET_KEY : INVALID (401) — checkout will fail (ok if unused locally)" ;;
    *)   echo "⚠  STRIPE_SECRET_KEY : unexpected HTTP $code" ;;
  esac
fi

echo ""
if [[ "$fail" -ne 0 ]]; then
  echo "✗ One or more required keys are missing or not live."
  exit 1
fi
echo "✓ All present keys are live."
