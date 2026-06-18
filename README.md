# Nitrogen

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![CI](https://github.com/nicholasrossano/nitrogen/actions/workflows/ci.yml/badge.svg)](https://github.com/nicholasrossano/nitrogen/actions/workflows/ci.yml)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![Next.js 14](https://img.shields.io/badge/Next.js-14-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Open-source, chat-first reference architecture for climate-impact investment diligence.

Nitrogen is a self-hostable platform for impact investors and diligence teams: research companies in personal chat, promote findings to shared project records, and track deal health with rubric snapshots. Energy calculators (carbon, LCOE, solar) ship as signal providers for the worked example — the engine is domain-agnostic.

See [docs/positioning.md](docs/positioning.md) for the product narrative and [docs/architecture.md](docs/architecture.md) for system design.

## Overview

Investment diligence is fragmented across spreadsheets, data rooms, consultant memos, and ad-hoc notes. Nitrogen brings that work into a shared, chat-native system with clear promotion boundaries between private research and team-visible findings.

The platform helps teams:

- research deals in personal, project-optional chat with cited retrieval
- promote curated outputs to project-level findings and structured assumptions
- upload and organize company library and deal-room documents
- track rubric health across documents, findings, and computed signals

## Tech Stack

- **Frontend**: Next.js 14 (TypeScript), Tailwind CSS, Zustand
- **Backend**: FastAPI (Python), SQLAlchemy, Alembic
- **Database**: PostgreSQL with pgvector for vector search and RAG embeddings
- **Auth**: Firebase Authentication (required)

## Quick Start (Local Development)

### Prerequisites

- Python 3.12+
- Node.js 22+
- PostgreSQL with pgvector (or a Neon database)
- **Required:** `OPENAI_API_KEY`, `DATABASE_URL`, and Firebase (see below)

### 1) Clone and configure environment

```bash
git clone https://github.com/nicholasrossano/nitrogen.git
cd nitrogen
cp .env.example .env   # first-time template only — then keep your real .env
bash scripts/worktree_setup.sh
bash scripts/check_dev_env.sh
```

**Authentication:** Nitrogen uses Firebase for sign-in in every environment (local and production). Mock auth was removed. Create a [Firebase project](https://console.firebase.google.com/) (free tier is fine), enable Email/Password and/or Google sign-in, then copy the Web app config into `NEXT_PUBLIC_FIREBASE_*` and set `FIREBASE_PROJECT_ID` plus a service account path in `NITROGEN_FIREBASE_CREDENTIALS` (see `.env.example`). `bash scripts/check_dev_env.sh` validates the minimum vars before you start.

For self-hosting, Firebase is the supported path today: you run Nitrogen's app and database yourself; Firebase handles identity. That keeps auth out of the critical path for a small team fork without maintaining a separate auth server. Alternative identity providers are not wired in yet.

`backend/.env` and `frontend/.env.local` symlink to root `.env`. Quick start: `bash scripts/start_emulator.sh`.

### 2) Migrate and optional demo seed

```bash
cd backend
pip install -r requirements.txt
python3 -m alembic upgrade head
python3 scripts/seed_demo_deal.py   # optional synthetic sample deal
```

### 3) Start servers

```bash
# from repo root
bash scripts/start_emulator.sh
```

Or manually:

```bash
cd backend && python3 -m uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

### 4) Open the app

- Frontend: `http://localhost:3000` (redirects to `/chat`)
- Backend API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

## Docker (Optional)

```bash
docker compose up -d
docker compose exec backend alembic upgrade head
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions require a signed [Contributor License Agreement](CLA.md) before merge.

## Security Checks

```bash
./scripts/security_check.sh          # pre-commit (working tree)
./scripts/security_check.sh --history # full scan including git history
./scripts/oss_pre_release.sh         # run before making the repo public
```

CI runs the full secret and artifact scan on every push.

## License

Code: [GNU Affero General Public License v3.0](LICENSE). The Nitrogen name and branding are not covered by that license — see [brand and naming](TRADEMARKS.md). Organizations needing terms outside the AGPLv3 may contact us about a [commercial license](COMMERCIAL_LICENSE.md).
