#!/usr/bin/env bash
# Vercel "Ignored Build Step" helper (Project Settings → Git → Ignored Build Step).
# Convention: exit 0 = skip the build, exit 1 = run the build.
# https://vercel.com/docs/project-configuration/git-settings#ignored-build-step
#
# Suggested dashboard command (Root Directory = frontend):
#   bash scripts/vercel-ignore-build.sh
# or:
#   npm run vercel:ignore-build
#
# Skips only when every changed file is clearly outside the Next app and Node pin.

set -euo pipefail

# Local / CI: never skip via this helper (Vercel sets VERCEL=1).
if [ "${VERCEL:-}" != "1" ]; then
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "${REPO_ROOT}" ]; then
  exit 1
fi
cd "${REPO_ROOT}"

PREV="${VERCEL_GIT_PREVIOUS_SHA:-}"
CUR="${VERCEL_GIT_COMMIT_SHA:-}"

if [ -z "${PREV}" ] || [ -z "${CUR}" ] || [ "${PREV}" = "${CUR}" ]; then
  exit 1
fi

if ! git rev-parse --verify "${PREV}^{commit}" >/dev/null 2>&1; then
  exit 1
fi

if ! git rev-parse --verify "${CUR}^{commit}" >/dev/null 2>&1; then
  exit 1
fi

changed=0
while IFS= read -r f; do
  [ -z "${f}" ] && continue
  changed=1
  case "${f}" in
    frontend/*|.nvmrc)
      exit 1
      ;;
  esac
done < <(git diff --name-only "${PREV}" "${CUR}" || true)

# No file list (or unreadable diff): do not skip.
if [ "${changed}" -eq 0 ]; then
  exit 1
fi

exit 0
