#!/usr/bin/env bash
# Start backend + frontend for local emulator (ports 8000 / 3000).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "❌ Missing $ROOT/.env"
  echo "   cp .env.example .env"
  echo "   Fill DATABASE_URL, FIREBASE_PROJECT_ID, NITROGEN_FIREBASE_CREDENTIALS, and NEXT_PUBLIC_FIREBASE_*"
  exit 1
fi

bash "$ROOT/scripts/worktree_setup.sh"
bash "$ROOT/scripts/check_dev_env.sh"

if ss -tlnp 2>/dev/null | rg -q ':8000'; then
  echo "✓ Backend already listening on :8000"
else
  echo "Starting backend on :8000…"
  (cd "$ROOT/backend" && python3 -m uvicorn app.main:app --reload --port 8000) &
fi

if ss -tlnp 2>/dev/null | rg -q ':3000'; then
  echo "✓ Frontend already listening on :3000"
else
  echo "Starting frontend on :3000…"
  (cd "$ROOT/frontend" && npm run dev) &
fi

sleep 3
if curl -sf -o /dev/null http://127.0.0.1:8000/health 2>/dev/null; then
  echo "✓ Backend health OK"
else
  echo "⚠ Backend not healthy yet — check logs"
fi

echo ""
echo "Open http://localhost:3000 (art lab: http://localhost:3000/art-lab)"
echo "Enable Developer Mode in Settings for art lab."
