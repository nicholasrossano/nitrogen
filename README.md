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

## Quick Start (Local Development)

### Prerequisites

- Python 3.12+
- Node.js 22+
- PostgreSQL with pgvector (or a Neon database)
- OpenAI API key

### 1) Clone and configure environment

```bash
git clone https://github.com/nicholasrossano/nitrogen.git
cd nitrogen
cp .env.example .env   # first-time template only — then keep your real .env
bash scripts/worktree_setup.sh
bash scripts/check_dev_env.sh
```

Set `DATABASE_URL`, `OPENAI_API_KEY`, and either Firebase (`NEXT_PUBLIC_FIREBASE_*` + `FIREBASE_PROJECT_ID`) or mock dev auth (`DEBUG=true`, `DEV_MOCK_TOKEN`).

`backend/.env` and `frontend/.env.local` symlink to root `.env`. Quick start: `bash scripts/start_emulator.sh`.

### 2) Start backend

```bash
cd backend
pip install -r requirements.txt
python3 -m alembic upgrade head
python3 -m uvicorn app.main:app --reload --port 8000
```

### 3) Start frontend

```bash
cd frontend
npm install
npm run dev
```

### 4) Open the app

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

## Docker (Optional)

If you prefer Docker-based local setup:

```bash
docker compose up -d
docker compose exec backend alembic upgrade head
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow details. Contributions require a signed [Contributor License Agreement](CLA.md) before merge.

Browse [open issues](https://github.com/nicholasrossano/nitrogen/issues) to get started.

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

Organizations that need terms outside the AGPLv3 may contact Nitrogen AI about a separate [commercial license](COMMERCIAL_LICENSE.md). Use of Nitrogen AI names, logos, and branding is covered by the [trademark guidelines](TRADEMARKS.md).
