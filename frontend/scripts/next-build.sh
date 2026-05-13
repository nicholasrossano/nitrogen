#!/usr/bin/env bash
# Mirrors previous npm "build" behavior: local uses .next-build + NITROGEN_NEXT_DIST_DIR;
# Vercel (VERCEL=1) uses distDir .next from next.config.js — avoid extra rm/env there.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

if [ "${VERCEL:-}" != "1" ]; then
  rm -rf .next-build
  export NITROGEN_NEXT_DIST_DIR=.next-build
fi

exec next build
