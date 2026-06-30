#!/usr/bin/env bash
# Start backend + frontend for local emulator (ports 8000 / 3000).
# Delegates to the persistent tmux daemon so servers survive agent session end.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/scripts/dev_daemon.sh" start
