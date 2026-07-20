#!/usr/bin/env python3
"""
Sync secrets from the current environment (injected by Cursor Secrets) to Vercel.

Run automatically at the start of every cloud agent session via AGENTS.md.
Also writes a local .env file for the agent VM.

Usage:
    python3 scripts/sync_secrets_to_vercel.py

Requirements:
    VERCEL_TOKEN  — Vercel API token (in Cursor Secrets)
    VERCEL_PROJECT_ID — set below or as env var
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

# No hardcoded default: a committed maintainer project id would let anyone with a
# stray VERCEL_TOKEN in their env push secrets into the maintainer's Vercel project
# (cross-tenant leak). Both must be provided explicitly by the operator.
VERCEL_PROJECT_ID = os.environ.get("VERCEL_PROJECT_ID", "")
VERCEL_TOKEN = os.environ.get("VERCEL_TOKEN", "")

if not VERCEL_TOKEN:
    print("⚠  VERCEL_TOKEN not set — skipping Vercel sync (not yet injected this session)")
    sys.exit(0)

if not VERCEL_PROJECT_ID:
    print("⚠  VERCEL_PROJECT_ID not set — refusing to sync (no default target). "
          "Set VERCEL_PROJECT_ID to your own Vercel project id.")
    sys.exit(0)

BASE = f"https://api.vercel.com/v9/projects/{VERCEL_PROJECT_ID}/env"
HEADERS = {"Authorization": f"Bearer {VERCEL_TOKEN}", "Content-Type": "application/json"}

ALL_ENVS = ["production", "preview", "development"]
PROD_PREVIEW = ["production", "preview"]

# ── Secret definitions ────────────────────────────────────────────────────────
# (key, targets, type)
# type: "sensitive" for secrets, "plain" for non-secret values
# Values come from environment (Cursor Secrets injection).
# If not in env, the existing Vercel value is left unchanged.

SECRET_DEFS = [
    # Stripe
    ("STRIPE_SECRET_KEY",               PROD_PREVIEW, "sensitive"),
    ("STRIPE_WEBHOOK_SECRET",           PROD_PREVIEW, "sensitive"),
    ("STRIPE_PRICE_ID",                 ALL_ENVS,     "plain"),
    ("API_KEY_ENCRYPTION_KEY",          PROD_PREVIEW, "sensitive"),
    ("BILLING_TESTING_MODE",            ALL_ENVS,     "plain"),
    # Optional override for included AI budget (default $19.00 is in code)
    ("SUBSCRIPTION_USAGE_LIMIT_USD",    ALL_ENVS,     "plain"),
    # Stripe frontend — Price id only; $20/$19.00 labels come from GET /billing/catalog
    ("NEXT_PUBLIC_BILLING_ENABLED",             ALL_ENVS, "plain"),
    ("NEXT_PUBLIC_STRIPE_PRICE_ID",             ALL_ENVS, "plain"),
    ("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",      ALL_ENVS, "plain"),
    # OpenRouter (future routing plan)
    ("OPENROUTER_API_KEY",              PROD_PREVIEW, "sensitive"),
    # OpenAI
    ("OPENAI_API_KEY",                  PROD_PREVIEW, "sensitive"),
]

# Repo-scoped Cursor Secrets take precedence over legacy unsuffixed/shared
# ones of the same purpose — see cursor_secrets_manifest.txt. Map them onto
# the plain names above (what Vercel/the app actually expect) before sync.
_NITROGEN_ALIASES = {
    "STRIPE_SECRET_KEY_NITROGEN": "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY_NITROGEN": "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    # STRIPE_RESTRICTED_KEY_NITROGEN is intentionally not aliased here — the
    # app doesn't yet use a restricted key; add an alias once one is wired in.
}
for _src, _dest in _NITROGEN_ALIASES.items():
    _val = os.environ.get(_src)
    if _val:
        os.environ[_dest] = _val

# ── Helpers ───────────────────────────────────────────────────────────────────

def api(method, url, body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode()) from e

def get_existing():
    result = api("GET", BASE)
    existing = {}
    for e in result.get("envs", []):
        existing.setdefault(e["key"], []).append(e["id"])
    return existing

def upsert(key, value, targets, typ, existing):
    for eid in existing.get(key, []):
        try:
            api("DELETE", f"{BASE}/{eid}")
        except Exception:
            pass
    api("POST", BASE, {"key": key, "value": value, "target": targets, "type": typ})

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("→ Syncing secrets to Vercel...")
    existing = get_existing()
    synced, skipped = [], []

    for key, targets, typ in SECRET_DEFS:
        value = os.environ.get(key)
        if not value:
            skipped.append(key)
            continue
        try:
            upsert(key, value, targets, typ, existing)
            synced.append(key)
            print(f"  ✓ {key}")
        except Exception as e:
            print(f"  ✗ {key}: {e}")

    if skipped:
        print(f"\n  ⚠  Skipped (not in env): {', '.join(skipped)}")
    print(f"\n✓ Synced {len(synced)} vars to Vercel")

    # ── Write local .env for this agent session ───────────────────────────────
    write_local_env()

def write_local_env():
    env_path = Path("/workspace/.env")
    example = Path("/workspace/.env.example").read_text()

    # Replace each key=... line with the env value if available
    import re
    def replacer(m):
        key = m.group(1)
        val = os.environ.get(key)
        if val:
            return f"{key}={val}"
        return m.group(0)

    result = re.sub(r'^([A-Z_][A-Z0-9_]*)=.*$', replacer, example, flags=re.MULTILINE)
    env_path.write_text(result)

    # Symlink backend/.env and frontend/.env.local
    for link in [Path("/workspace/backend/.env"), Path("/workspace/frontend/.env.local")]:
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(env_path)

    print("✓ Written /workspace/.env and symlinks")

if __name__ == "__main__":
    main()
