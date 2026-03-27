# Contributing to Nitrogen AI

Thanks for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 22+
- PostgreSQL with pgvector (or a [Neon](https://neon.tech) cloud database)
- An OpenAI API key

### Local Setup

1. Fork and clone the repo
2. Copy environment files:
   ```bash
   cp .env.example .env
   cp frontend/.env.local.example frontend/.env.local
   ```
3. Fill in your API keys and database URL in the `.env` files
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

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE).
