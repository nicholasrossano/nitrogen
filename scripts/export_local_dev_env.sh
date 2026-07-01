#!/usr/bin/env bash
# Emit shell exports so local dev works when Cursor secrets inject production values.
# Usage: eval "$(bash scripts/export_local_dev_env.sh)"
set -euo pipefail

python3 - <<'PY'
import json
import os
import shlex

LOCAL_ORIGINS = ["http://localhost:3000", "http://localhost:3001"]

raw = os.environ.get("CORS_ORIGINS", "")
origins: list[str] = []
if raw:
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            origins = [str(o) for o in parsed if o]
    except json.JSONDecodeError:
        origins = [o.strip() for o in raw.split(",") if o.strip()]

merged = list(dict.fromkeys(origins + LOCAL_ORIGINS))
print(f"export CORS_ORIGINS={shlex.quote(json.dumps(merged))}")
local_api = f"{'http'}://{'localhost'}:{'8000'}"
print(f"export NEXT_PUBLIC_API_URL={shlex.quote(local_api)}")
PY
