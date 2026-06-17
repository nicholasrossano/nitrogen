#!/usr/bin/env bash
# Run before making the repository public or tagging a release.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> OSS pre-release checks"
bash "$ROOT_DIR/scripts/security_check.sh" --history
bash "$ROOT_DIR/scripts/check_tracked_artifacts.sh"
echo "✅ OSS pre-release checks passed."
