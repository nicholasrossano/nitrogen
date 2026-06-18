#!/usr/bin/env bash
# Apply GitHub settings that require a public repo (or GitHub Pro) on private repos.
# Run once immediately after making nicholasrossano/nitrogen public.
#
# Usage: bash scripts/github_post_public_setup.sh
set -euo pipefail

REPO="${GITHUB_REPO:-nicholasrossano/nitrogen}"

echo "==> Configuring $REPO (branch protection + Actions policy)"

echo "==> Allow GitHub-owned Actions (checkout, setup-node, setup-python, etc.)"
gh api -X PUT "repos/$REPO/actions/permissions" --input - <<'EOF'
{
  "enabled": true,
  "allowed_actions": "selected"
}
EOF

gh api -X PUT "repos/$REPO/actions/permissions/workflow" --input - <<'EOF'
{
  "default_workflow_permissions": "read",
  "github_owned_allowed": true,
  "verified_allowed": false,
  "patterns_allowed": []
}
EOF

echo "==> Protect main: CI must pass; admins may bypass"
gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "Security (secrets + artifacts)" },
      { "context": "Frontend (typecheck + lint + test + build)" },
      { "context": "Backend (lint + test)" }
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

echo "✅ GitHub post-public setup complete."
echo "   Verify: gh api repos/$REPO/branches/main/protection"
