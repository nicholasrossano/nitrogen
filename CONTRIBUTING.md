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
2. Copy the environment template:
   ```bash
   cp .env.example .env   # first-time only; then keep your real .env
   bash scripts/worktree_setup.sh && bash scripts/check_dev_env.sh
   ```
3. Fill in your API keys and database URL in `.env`
4. Start the backend:
   ```bash
   cd backend
   pip install -r requirements.txt
   alembic upgrade head
   python -m uvicorn app.main:app --reload --port 8000
   ```
5. Start the frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
6. Open http://localhost:3000

See the [README](README.md) for Docker-based setup and more detail.

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
5. Wait for CI to pass (lint, typecheck, test, build) and a maintainer review

### Code Style

- **Frontend**: Follow the [Style Guide](docs/style-guide.md) and existing patterns
- **Backend**: Follow PEP 8; we use [Ruff](https://docs.astral.sh/ruff/) for linting

### Testing and Validation

Use narrow, quiet test commands while iterating, then run full regression before opening a PR. See [Testing and Validation](docs/testing.md) for single-test commands, quiet wrappers, and fast validation checks.

## Reporting Bugs

Open a [Bug Report](../../issues/new?template=bug_report.yml) issue. Include steps to reproduce, expected vs. actual behavior, and your environment.

## Requesting Features

Open a [Feature Request](../../issues/new?template=feature_request.yml) issue. Describe the problem you're solving and your proposed approach.

## Security Vulnerabilities

Please report security issues privately. See [SECURITY.md](SECURITY.md) for details.

## Licensing

Nitrogen is distributed under the [GNU Affero General Public License v3.0](LICENSE). For organizations that need terms outside the AGPLv3, separate licensing may be available. See [Commercial Licensing](COMMERCIAL_LICENSE.md).

By contributing, you agree that your contributions may be distributed under the [AGPLv3](LICENSE) and under the additional terms described in the [Contributor License Agreement](CLA.md).
