#!/usr/bin/env bash
# Persistent local dev stack (backend :8000 + frontend :3000) via tmux.
#
# Usage:
#   bash scripts/dev_daemon.sh          # start (default)
#   bash scripts/dev_daemon.sh start
#   bash scripts/dev_daemon.sh stop
#   bash scripts/dev_daemon.sh restart
#   bash scripts/dev_daemon.sh status
#
# Both servers run in auto-restart loops inside a tmux session so they
# survive agent session boundaries. Frontend starts even if backend env
# is incomplete so localhost:3000 is always reachable.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="${NITROGEN_DEV_SESSION:-nitrogen-dev}"
LOG_DIR="$ROOT/.test-output"
BACKEND_LOG="$LOG_DIR/backend-dev.log"
FRONTEND_LOG="$LOG_DIR/frontend-dev.log"

# Prefer the portal tmux config; fall back to plain tmux
if [[ -f /exec-daemon/tmux.portal.conf ]]; then
  TMUX_CMD=(tmux -f /exec-daemon/tmux.portal.conf)
else
  TMUX_CMD=(tmux)
fi

# ── Helpers ───────────────────────────────────────────────────────────────────

port_up() {
  # Try ss first (Linux), then netstat, then curl as last resort
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp 2>/dev/null | grep -q ":${1}[[:space:]]"
  elif netstat -tlnp 2>/dev/null | grep -q ":${1}[[:space:]]"; then
    return 0
  else
    curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:${1}/" 2>/dev/null
  fi
}

health_summary() {
  local be fe
  if port_up 8000 && curl -sf -o /dev/null http://127.0.0.1:8000/health 2>/dev/null; then
    be="healthy"
  elif port_up 8000; then be="listening (starting…)"; else be="down"; fi

  if port_up 3000 && curl -sf -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then
    fe="healthy"
  elif port_up 3000; then fe="listening (starting…)"; else fe="down"; fi

  echo "  backend  :8000  ${be}"
  echo "  frontend :3000  ${fe}"
}

session_running() { "${TMUX_CMD[@]}" has-session -t "=$SESSION" 2>/dev/null; }

wait_for_port() {
  local port=$1 secs=${2:-20}
  for _ in $(seq 1 "$secs"); do port_up "$port" && return 0; sleep 1; done
  return 1
}

# ── Env preparation ───────────────────────────────────────────────────────────

prepare_env() {
  mkdir -p "$LOG_DIR"
  bash "$ROOT/scripts/worktree_setup.sh" 2>/dev/null || true

  if bash "$ROOT/scripts/materialize_dev_env.sh" \
     && bash "$ROOT/scripts/check_dev_env.sh" 2>/dev/null; then
    return 0   # full env — backend + frontend
  fi
  return 1     # partial env — frontend only
}

# ── Start ─────────────────────────────────────────────────────────────────────

do_start() {
  local full_env=1
  prepare_env || full_env=0

  if session_running; then
    echo "✓ Dev session already running"
    health_summary
    return 0
  fi

  # Each tmux window runs an auto-restart loop so crashes don't stay down.
  local be_loop
  be_loop=$(cat <<'SH'
while true; do
  echo "[$(date -Iseconds)] backend starting…"
  cd "$ROOT/backend"
  python3 -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 \
    2>&1 | tee -a "$BACKEND_LOG"
  echo "[$(date -Iseconds)] backend exited ($?), restarting in 3 s…"
  sleep 3
done
SH
)

  local fe_loop
  fe_loop=$(cat <<'SH'
while true; do
  echo "[$(date -Iseconds)] frontend starting…"
  cd "$ROOT/frontend"
  npm run dev 2>&1 | tee -a "$FRONTEND_LOG"
  echo "[$(date -Iseconds)] frontend exited ($?), restarting in 3 s…"
  sleep 3
done
SH
)

  if [[ "$full_env" == "1" ]]; then
    "${TMUX_CMD[@]}" new-session -d -s "$SESSION" -c "$ROOT" \
      -- "${SHELL:-bash}" -lc "export ROOT='$ROOT' BACKEND_LOG='$BACKEND_LOG'; $be_loop"
    "${TMUX_CMD[@]}" new-window -t "$SESSION" -c "$ROOT" \
      -- "${SHELL:-bash}" -lc "export ROOT='$ROOT' FRONTEND_LOG='$FRONTEND_LOG'; $fe_loop"
    echo "✓ Dev session started (backend + frontend, auto-restart)"
  else
    # Frontend only — backend will stay down until secrets are available
    "${TMUX_CMD[@]}" new-session -d -s "$SESSION" -c "$ROOT" \
      -- "${SHELL:-bash}" -lc "export ROOT='$ROOT' FRONTEND_LOG='$FRONTEND_LOG'; $fe_loop"
    echo "⚠ Started frontend only (backend needs secrets — see docs/self-hosting.md)"
  fi

  wait_for_port 3000 25 && echo "✓ http://localhost:3000 is up" || echo "⚠ frontend slow to start — check $FRONTEND_LOG"
  [[ "$full_env" == "1" ]] && { wait_for_port 8000 15 && echo "✓ http://localhost:8000 is up" || echo "⚠ backend slow to start — check $BACKEND_LOG"; }
  echo ""
  health_summary
}

# ── Stop ──────────────────────────────────────────────────────────────────────

do_stop() {
  if session_running; then
    "${TMUX_CMD[@]}" kill-session -t "$SESSION"
    echo "✓ Dev session stopped"
  else
    echo "• Dev session not running"
  fi
}

# ── Status ────────────────────────────────────────────────────────────────────

do_status() {
  if session_running; then
    echo "✓ Dev session running (tmux: $SESSION)"
  else
    echo "• Dev session not running"
  fi
  health_summary
}

# ── Dispatch ──────────────────────────────────────────────────────────────────

case "${1:-start}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; do_start ;;
  status)  do_status ;;
  -h|--help|help)
    echo "Usage: bash scripts/dev_daemon.sh [start|stop|restart|status]"
    ;;
  *) echo "Unknown command: $1" >&2; exit 1 ;;
esac
