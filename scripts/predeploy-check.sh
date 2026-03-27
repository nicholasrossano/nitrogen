#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Frontend: lint"
(
  cd "$ROOT_DIR/frontend"
  npm run lint
)

echo "==> Frontend: test"
(
  cd "$ROOT_DIR/frontend"
  npm test -- --passWithNoTests
)

echo "==> Frontend: build"
(
  cd "$ROOT_DIR/frontend"
  NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:8000}" \
  NEXT_PUBLIC_ACCESS_CODE="${NEXT_PUBLIC_ACCESS_CODE:-local-predeploy}" \
  npm run build
)

echo "==> Backend: ruff"
(
  cd "$ROOT_DIR/backend"
  python3 -m ruff check .
)

echo "==> Backend: pytest"
(
  cd "$ROOT_DIR/backend"
  OPENAI_API_KEY="${OPENAI_API_KEY:-test-key-not-real}" \
  FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-test-project}" \
  python3 -m pytest tests/ -x -q
)

echo "Pre-deploy checks passed."
