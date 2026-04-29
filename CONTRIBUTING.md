# Contributing to Nitrogen AI

Thanks for your interest in contributing! This guide will help you get started.

Nitrogen is open source under the [GNU Affero General Public License v3.0](LICENSE). Contributions are welcome, and contributors retain copyright in their work, but contributions require a signed [Contributor License Agreement](CLA.md) before they can be merged. The CLA lets Nitrogen keep the public project available under the AGPLv3 while also offering separate [commercial licenses](COMMERCIAL-LICENSE.md) for organizations that need terms outside the AGPLv3.

Only submit code, documentation, data, designs, or other assets that you have the right to contribute. The AGPLv3 covers the software license; Nitrogen names, logos, and branding are covered separately by the [trademark guidelines](TRADEMARKS.md).

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 22+
- PostgreSQL with pgvector (or a [Neon](https://neon.tech) cloud database)
- An OpenAI API key

### Local Setup

1. Fork and clone the repo
2. Copy the environment template:
   ```bash
   cp .env.example .env
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

### Pull Request Process

1. Create your branch from `main`
2. Make your changes — a pre-commit hook will automatically lint staged files on commit
3. Open a PR against `main` using the PR template
4. Fill in the summary, link related issues, and complete the checklist
5. Wait for CI to pass (lint, typecheck, test, build) and a maintainer review

### Code Style

- **Frontend**: Follow the [Style Guide](docs/style-guide.md) and existing patterns
- **Backend**: Follow PEP 8; we use [Ruff](https://docs.astral.sh/ruff/) for linting

## Reporting Bugs

Open a [Bug Report](../../issues/new?template=bug_report.yml) issue. Include steps to reproduce, expected vs. actual behavior, and your environment.

## Requesting Features

Open a [Feature Request](../../issues/new?template=feature_request.yml) issue. Describe the problem you're solving and your proposed approach.

## Security Vulnerabilities

Please report security issues privately. See [SECURITY.md](SECURITY.md) for details.

## License

By contributing, you agree that your contributions may be distributed under the [AGPLv3](LICENSE) and under the additional terms described in the [Contributor License Agreement](CLA.md).
