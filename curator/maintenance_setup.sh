#!/usr/bin/env bash
set -euo pipefail

CREDS_DIR="/workspace/credentials"
CREDS_PATH="${GOOGLE_APPLICATION_CREDENTIALS:-/workspace/credentials/service_account.json}"

mkdir -p "$CREDS_DIR"

if [[ -f "$CREDS_PATH" ]]; then
  echo "[curator] creds file already exists: $CREDS_PATH"
  exit 0
fi

if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS_JSON:-}" ]]; then
  echo "[curator] missing GOOGLE_APPLICATION_CREDENTIALS_JSON (Codex Secret). Cannot write creds file."
  exit 1
fi

python - <<'PY'
import os, json, base64, pathlib

raw = (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON") or "").strip()
out_path = pathlib.Path(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or "/workspace/credentials/service_account.json")

def parse_json(s: str):
    if s.startswith("{"):
        return json.loads(s)
    decoded = base64.b64decode(s).decode("utf-8")
    return json.loads(decoded)

data = parse_json(raw)
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

email = data.get("client_email", "<unknown>")
print(f"[curator] wrote creds file: {out_path}")
print(f"[curator] service account: {email}")
PY

chmod 600 "$CREDS_PATH"
echo "[curator] GOOGLE_APPLICATION_CREDENTIALS=$CREDS_PATH"
ls -la "$CREDS_PATH"
