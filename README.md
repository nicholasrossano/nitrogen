# Nitrogen AI

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![CI](https://github.com/nicholasrossano/nitrogen/actions/workflows/ci.yml/badge.svg)](https://github.com/nicholasrossano/nitrogen/actions/workflows/ci.yml)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![Next.js 14](https://img.shields.io/badge/Next.js-14-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Open-source software for sustainable development project design and implementation.

Nitrogen AI is a collaborative platform for teams designing, evaluating, and advancing sustainable development projects, orchestrating micro-model assessments like solar yield, levelized cost of electricity, health impact analyses, and more all within one tool. It can then turn project materials and assessments into deliverables like investment memos, landscape assessments, and other decision-ready materials with clear, traceable logs across citations and decisions.

## Overview

Sustainable development work is often shaped by unequal access to expertise, tools, and implementation support. Nitrogen AI is motivated by the idea that teams working in lower-resource environments — along with the global organizations that support them — should have better access to the analytical tools, structured workflows, and precedent needed to design and execute successful projects.

In practice, those workflows are often fragmented across spreadsheets, consultant reports, internal notes, institution-specific knowledge, and more. Nitrogen AI is an attempt to bring more of that work into a shared, adaptable system.

The platform is designed to help teams:

- structure project information through guided and conversational workflows
- run targeted assessments across technical, financial, and impact-related questions
- incorporate precedent, datasets, and supporting evidence into project design
- generate decision-ready materials such as memos, applications, and supporting documents

The goal is not to replace domain expertise, but to make it easier to apply, adapt, and extend. The platform prioritizes simplicity and usability, with a straightforward interface that keeps users in control while shifting more of the technical complexity into the underlying system.

## Tech Stack

- **Frontend**: Next.js 14 (TypeScript), Tailwind CSS, Zustand
- **Backend**: FastAPI (Python), SQLAlchemy, Alembic
- **Database**: PostgreSQL with pgvector for vector search and RAG embeddings
- **Auth**: Firebase Authentication
- **Deployment**:
  - Frontend: Vercel
  - Backend: Railway
  - Database: Neon (serverless Postgres)

## Quick Start

### Prerequisites

- Docker & Docker Compose
- OpenAI API key

### Setup

1. Clone and configure:
```bash
git clone https://github.com/nicholasrossano/nitrogen.git
cd nitrogen
cp .env.example .env
# Edit .env with your OPENAI_API_KEY
```

2. Start all services:
```bash
docker-compose up -d
```

3. Run database migrations:
```bash
docker-compose exec backend alembic upgrade head
```

4. Seed the corpus (optional but recommended):
```bash
docker-compose exec backend python scripts/seed_corpus.py
```

5. Access the app:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Local Development (without Docker)

**Prerequisites:**
- Python 3.12+ 
- Node.js 22+
- PostgreSQL with pgvector (or use Neon cloud database)

**Backend:**
```bash
cd backend
pip install -r requirements.txt

# Set up environment (copy from .env.example or use existing .env)
# Required: DATABASE_URL, OPENAI_API_KEY

# Run migrations
alembic upgrade head

# Start server on port 8000
python -m uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install

# Start server on port 3000
npm run dev
```

**Important:** 
- Frontend runs on `http://localhost:3000`
- Backend runs on `http://localhost:8000`
- CORS is configured to allow localhost:3000 and localhost:3001
- If you get CORS errors, check that backend/.env has the correct CORS_ORIGINS

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, branch conventions, and the PR process. Contributions require a signed [Contributor License Agreement](CLA.md) before merge. Check the [open issues](../../issues) for things to work on; issues tagged `good first issue` are a great starting point.

## Security Checks

Run the local secret scanner before opening a PR or preparing an open-source release:

```bash
./scripts/security_check.sh
```

For a deeper scan that also checks commit history:

```bash
./scripts/security_check.sh --history
```

## License

[GNU Affero General Public License v3.0](LICENSE): any modifications must be open-sourced under the same license, including when deployed as a hosted service.

Organizations that need terms outside the AGPLv3 may contact Nitrogen about a separate [commercial license](COMMERCIAL-LICENSE.md). Use of Nitrogen names, logos, and branding is covered by the [trademark guidelines](TRADEMARKS.md).
