#!/usr/bin/env bash
set -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/.test-output"
mkdir -p "$OUTPUT_DIR"

target="${1:-all}"
shift || true

timestamp="$(date +%Y%m%d-%H%M%S)"
log_file="$OUTPUT_DIR/${target}-${timestamp}.log"

print_usage() {
  echo "Usage: scripts/ai_test.sh [backend|frontend|all] [test args...]"
  echo "Examples:"
  echo "  scripts/ai_test.sh backend tests/services/test_assumptions_service.py::test_normalize_missing_value_coerces_placeholder_tokens"
  echo "  scripts/ai_test.sh frontend src/__tests__/components/ui/Button.test.tsx -t 'renders'"
}

run_backend() {
  (
    cd "$ROOT_DIR/backend"
    python3 -m pytest -q -x --tb=short "$@"
  )
}

run_frontend() {
  (
    cd "$ROOT_DIR/frontend"
    npm test -- --runInBand --silent --bail "$@"
  )
}

run_target() {
  case "$target" in
    backend)
      run_backend "$@"
      ;;
    frontend)
      run_frontend "$@"
      ;;
    all)
      run_backend "$@" && run_frontend "$@"
      ;;
    -h|--help|help)
      print_usage
      exit 0
      ;;
    *)
      print_usage >&2
      exit 2
      ;;
  esac
}

if run_target "$@" >"$log_file" 2>&1; then
  echo "OK: ${target} tests passed. Full log: .test-output/$(basename "$log_file")"
else
  status=$?
  echo "FAIL: ${target} tests failed. First relevant output:"
  failure_block="$(awk '
    /^(FAILED|FAIL |ERROR |E   |=================================== FAILURES ===================================|==================================== ERRORS ====================================)/ {printing=1}
    printing {print; count++}
    count >= 80 {exit}
  ' "$log_file")"
  if [[ -n "$failure_block" ]]; then
    echo "$failure_block"
  else
    awk 'NR <= 80 {print}' "$log_file"
  fi
  echo "Full log: .test-output/$(basename "$log_file")"
  exit "$status"
fi
