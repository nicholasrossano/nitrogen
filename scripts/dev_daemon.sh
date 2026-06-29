#!/usr/bin/env bash
# Persistent local dev stack (backend :8000 + frontend :3000) via tmux.
#
# Usage:
#   bash scripts/dev_daemon.sh start    # default
#   bash scripts/dev_daemon.sh stop
#   bash scripts/dev_daemon.sh restart
#   bash scripts/dev_daemon.sh status
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_NAME="${NITROGEN_DEV_SESSION:-nitrogen-dev}"
LOG_DIR="$ROOT/.test-output"
BACKEND_LOG="$LOG_DIR/backend-dev.log"
FRONTEND_LOG="$LOG_DIR/frontend-dev.log"
TMUX=(tmux -f /exec-daemon/tmux.portal.conf)

usage() {
  cat <<EOF
Usage: bash scripts/dev_daemon.sh [start|stop|restart|status]

Persistent dev servers in tmux session "${SESSION_NAME}".
Logs: ${LOG_DIR}/backend-dev.log, ${LOG_DIR}/frontend-dev.log
EOF
}

port_listening() {
  local port="$1"
  ss -tlnp 2>/dev/null | rg -q ":${port}\\b"
}

health_summary() {
  local backend_ok="down"
  local frontend_ok="down"

  if port_listening 8000 && curl -sf -o /dev/null http://127.0.0.1:8000/health 2>/dev/null; then
    backend_ok="healthy"
  elif port_listening 8000; then
    backend_ok="listening (health pending)"
  fi

  if port_listening 3000 && curl -sf -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then
    frontend_ok="healthy"
  elif port_listening 3000; then
    frontend_ok="listening (health pending)"
  fi

  echo "backend (:8000): ${backend_ok}"
  echo "frontend (:3000): ${frontend_ok}"
}

prepare_env() {
  mkdir -p "$LOG_DIR"
  bash "$ROOT/scripts/worktree_setup.sh" || true

  if bash "$ROOT/scripts/materialize_dev_env.sh" && bash "$ROOT/scripts/check_dev_env.sh"; then
    BACKEND_READY=1
    return 0
  fi

  echo "⚠ Backend env incomplete — starting frontend only."
  echo "  Add Cursor cloud agent secrets (see AGENTS.md) or set NITROGEN_ENV_FILE."
  BACKEND_READY=0
}

start_backend_loop() {
  cat <<'EOF'
while true; do
  echo "[$(date -Iseconds)] starting backend..."
  cd "$ROOT/backend" && python3 -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 2>&1 | tee -a "$BACKEND_LOG"
  code=$?
  echo "[$(date -Iseconds)] backend exited (${code}), restarting in 3s..."
  sleep 3
done
EOF
}

start_frontend_loop() {
  cat <<'EOF'
while true; do
  echo "[$(date -Iseconds)] starting frontend..."
  cd "$ROOT/frontend" && npm run dev 2>&1 | tee -a "$FRONTEND_LOG"
  code=$?
  echo "[$(date -Iseconds)] frontend exited (${code}), restarting in 3s..."
  sleep 3
done
EOF
}

start_daemon() {
  BACKEND_READY=0
  prepare_env

  if "${TMUX[@]}" has-session -t "=$SESSION_NAME" 2>/dev/null; then
    echo "✓ tmux session ${SESSION_NAME} already running"
    health_summary
    return 0
  fi

  local backend_cmd frontend_cmd
  backend_cmd="$(start_backend_loop)"
  frontend_cmd="$(start_frontend_loop)"

  if [[ "$BACKEND_READY" == "1" ]]; then
    "${TMUX[@]}" new-session -d -s "$SESSION_NAME" -c "$ROOT" -- "${SHELL:-bash}" -lc \
      "export ROOT='$ROOT' BACKEND_LOG='$BACKEND_LOG'; ${backend_cmd}"
    "${TMUX[@]}" new-window -t "$SESSION_NAME" -c "$ROOT" -- "${SHELL:-bash}" -lc \
      "export ROOT='$ROOT' FRONTEND_LOG='$FRONTEND_LOG'; ${frontend_cmd}"
    echo "✓ Started tmux session ${SESSION_NAME} (backend + frontend, auto-restart enabled)"
  else
    "${TMUX[@]}" new-session -d -s "$SESSION_NAME" -c "$ROOT" -- "${SHELL:-bash}" -lc \
      "export ROOT='$ROOT' FRONTEND_LOG='$FRONTEND_LOG' NEXT_PUBLIC_API_URL='${NEXT_PUBLIC_API_URL:-http://localhost:8000}'; ${frontend_cmd}"
    echo "✓ Started tmux session ${SESSION_NAME} (frontend only — backend waiting on env)"
  fi

  for _ in $(seq 1 20); do
    if port_listening 3000 && { [[ "$BACKEND_READY" != "1" ]] || port_listening 8000; }; then
      break
    fi
    sleep 1
  done

  health_summary
  echo ""
  echo "Open http://localhost:3000"
}

stop_daemon() {
  if "${TMUX[@]}" has-session -t "=$SESSION_NAME" 2>/dev/null; then
    "${TMUX[@]}" kill-session -t "$SESSION_NAME"
    echo "✓ Stopped tmux session ${SESSION_NAME}"
  else
    echo "• No tmux session ${SESSION_NAME}"
  fi
}

status_daemon() {
  if "${TMUX[@]}" has-session -t "=$SESSION_NAME" 2>/dev/null; then
    echo "✓ tmux session ${SESSION_NAME} is running"
  else
    echo "• tmux session ${SESSION_NAME} is not running"
  fi
  health_summary
}

cmd="${1:-start}"
case "$cmd" in
  start) start_daemon ;;
  stop) stop_daemon ;;
  restart) stop_daemon; start_daemon ;;
  status) status_daemon ;;
  -h|--help|help) usage ;;
  *) echo "Unknown command: $cmd" >&2; usage >&2; exit 1 ;;
esac
