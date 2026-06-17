#!/usr/bin/env bash
# Rewrite git history to replace the legacy Nitrogen product name with Nitrogen.
# Run once before open-sourcing, then force-push all branches.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "git-filter-repo is required. Install: pip install git-filter-repo" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree must be clean before history rewrite. Stash or commit first." >&2
  exit 1
fi

REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
REPLACEMENTS="$(mktemp)"
cat >"$REPLACEMENTS" <<'EOF'
literal:Nitrogen==>Nitrogen
literal:nitrogen==>nitrogen
EOF

echo "==> Rewriting blob content and commit messages (Nitrogen -> Nitrogen)..."
git filter-repo --force \
  --replace-text "$REPLACEMENTS" \
  --commit-callback '
message = commit.message.decode("utf-8")
updated = message.replace("Nitrogen", "Nitrogen").replace("nitrogen", "nitrogen")
if updated != message:
    commit.message = updated.encode("utf-8")
'

rm -f "$REPLACEMENTS"

if [[ -n "$REMOTE_URL" ]]; then
  git remote add origin "$REMOTE_URL"
  echo "==> Restored origin remote: $REMOTE_URL"
fi

echo "✅ History rewrite complete."
echo "Verify: git log --oneline | rg -i nitrogen || echo 'no Nitrogen in messages'"
echo "Then force-push: git push --force-with-lease --all && git push --force-with-lease --tags"
