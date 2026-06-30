# Contributing to Nitrogen

Thanks for your interest in contributing! This guide will help you get started.

Nitrogen is open source under the [GNU Affero General Public License v3.0](LICENSE). Contributions are welcome. Before a contribution can be merged, contributors must sign the [Contributor License Agreement](CLA.md), which keeps contribution rights clear and helps us maintain the project over time.

Only submit code, documentation, data, designs, or other assets that you have the right to contribute. The AGPLv3 covers the software license; the Nitrogen name and branding are covered separately — see [brand and naming](TRADEMARKS.md).

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 22+
- PostgreSQL with pgvector (or a [Neon](https://neon.tech) cloud database)
- An OpenAI API key
- A [Firebase](https://console.firebase.google.com/) project for authentication (required — mock auth is not supported)

### Local Setup

1. Fork and clone the repo
2. One command:
   ```bash
   cp .env.example .env   # first time only — fill DATABASE_URL, OPENAI_API_KEY, Firebase vars
   bash scripts/setup.sh
   ```
3. Open http://localhost:3000

`setup.sh` resolves env, runs migrations, starts the simulator, and tells you exactly what's missing if anything fails.

**Using Cursor cloud agents?** Add your `.env` values as [Cursor Secrets](https://cursor.com/dashboard/cloud-agents) once (see `scripts/cursor_secrets_manifest.txt`). Cloud VMs don't get your laptop's `.env` automatically.

See [docs/self-hosting.md](docs/self-hosting.md) for Firebase config and self-hosting.

## Making Changes

### Branch Naming

- `feat/short-description` -- new features
- `fix/short-description` -- bug fixes
- `docs/short-description` -- documentation only

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add dark mode toggle
fix: prevent crash on empty memo export
docs: update deployment guide for Railway
```

Keep subjects short and specific. Avoid generic prefixes like "Enhance" or "Refactor" without saying what changed.

### Secrets and User Data

Never commit:

- `.env` or any file containing API keys, database URLs with credentials, or service account JSON
- `exports/` or `uploads/` (runtime user artifacts; gitignored but double-check before `git add -A`)
- Local SQLite or mock databases (e.g. `backend/.dev-mock.db`)

Pre-commit runs `./scripts/security_check.sh`. Before a public release, also run:

```bash
./scripts/oss_pre_release.sh
```

### Pull Request Process

1. Create your branch from `main`
2. Make your changes — a pre-commit hook will automatically lint staged files on commit
3. Open a PR against `main` using the PR template
4. Fill in the summary, link related issues, and complete the checklist
5. Wait for CI to pass (lint, typecheck, test, build)

External contributions merge via PR only. Maintainers may bypass branch rules when needed (see [Repository governance](#repository-governance)).

### Code Style

- **Frontend**: Follow the [Style Guide](docs/style-guide.md) and existing patterns
- **Backend**: Follow PEP 8; we use [Ruff](https://docs.astral.sh/ruff/) for linting

### Testing and Validation

Use narrow, quiet test commands while iterating, then run full regression before opening a PR. See [Testing and Validation](docs/testing.md) for single-test commands, quiet wrappers, and fast validation checks.

## Repository governance

After the repo is public, `main` is protected as follows (applied via `scripts/github_post_public_setup.sh`):

| Rule | Why |
|------|-----|
| CI must pass (security scan, frontend, backend) | Keeps broken code off `main` |
| Pull requests required to merge | Standard OSS gate for forks and collaborators |
| Zero required approving reviews | Solo maintainer — no waiting on yourself |
| **Admins may bypass** | You can still ship urgent fixes without friction |

**Does this slow you down?** A little for PR-based merges: you wait for CI (~3 min). As repo admin with bypass enabled, you can still push or merge when you need to. Direct pushes to `main` are discouraged but not blocked for admins.

**GitHub Actions** allow GitHub-owned actions only (`actions/checkout`, `actions/setup-node`, `actions/setup-python`, etc.) — not arbitrary third-party marketplace actions.

**Deployment environments** (`Production`, `Preview`) are not gated in GitHub today — production secrets live in Railway/Vercel/Firebase, not GitHub Actions.

## Reporting Bugs

Open a [Bug Report](../../issues/new?template=bug_report.yml) issue. Include steps to reproduce, expected vs. actual behavior, and your environment.

## Requesting Features

Open a [Feature Request](../../issues/new?template=feature_request.yml) issue. Describe the problem you're solving and your proposed approach.

## Security Vulnerabilities

Please report security issues privately. See [SECURITY.md](SECURITY.md) for details.

## Licensing

Nitrogen is distributed under the [GNU Affero General Public License v3.0](LICENSE). For organizations that need terms outside the AGPLv3, separate licensing may be available. See [Commercial Licensing](COMMERCIAL_LICENSE.md).

By contributing, you agree that your contributions may be distributed under the [AGPLv3](LICENSE) and under the additional terms described in the [Contributor License Agreement](CLA.md).
