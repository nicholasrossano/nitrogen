# Nitrogen

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![CI](https://github.com/nicholasrossano/nitrogen/actions/workflows/ci.yml/badge.svg)](https://github.com/nicholasrossano/nitrogen/actions/workflows/ci.yml)

Chat-first decision packet studio. Generate investment memos grounded in evidence through conversational AI.

## Overview

Nitrogen helps users create structured decision documents by:
1. **Conversational Intake** - Chat with an AI assistant to define your initiative
2. **Evidence Upload** - Upload a document or paste text as supporting evidence
3. **Memo Generation** - Generate an investment memo with citations from both your evidence and a curated case study corpus

## Tech Stack

- **Frontend**: Next.js 14 (TypeScript), Tailwind CSS, Zustand
- **Backend**: FastAPI (Python), SQLAlchemy, Alembic
- **Database**: PostgreSQL with pgvector for vector search and RAG embeddings
- **AI Models**: 
  - OpenAI GPT for chat and memo generation
  - text-embedding-ada-002 for RAG embeddings
- **Auth**: Firebase Authentication
- **Deployment**:
  - Frontend: Vercel
  - Backend: Railway
  - Database: Neon (serverless Postgres)
- **Development**: Cursor AI coding assistant

## Quick Start

### Prerequisites

- Docker & Docker Compose
- OpenAI API key

### Setup

1. Clone and configure:
```bash
cd Nitrogen
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
- Python 3.11+ 
- Node.js 18+
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

## Project Structure

```
Nitrogen/
├── docker-compose.yml
├── frontend/           # Next.js app
│   ├── src/
│   │   ├── app/       # App router pages
│   │   ├── components/# React components
│   │   ├── hooks/     # Custom hooks
│   │   ├── lib/       # Utilities
│   │   └── stores/    # Zustand stores
│   └── ...
├── backend/            # FastAPI app
│   ├── app/
│   │   ├── api/       # Route handlers
│   │   ├── models/    # SQLAlchemy models
│   │   ├── schemas/   # Pydantic schemas
│   │   ├── services/  # Business logic
│   │   ├── core/      # Auth, DB, storage
│   │   └── prompts/   # AI prompt templates
│   ├── alembic/       # Database migrations
│   ├── scripts/       # CLI tools
│   └── templates/     # DOCX templates
└── exports/           # Generated documents
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/initiatives` | POST | Create new initiative |
| `/api/v1/initiatives/{id}` | GET | Get initiative details |
| `/api/v1/initiatives/{id}/chat` | POST | Send chat message |
| `/api/v1/initiatives/{id}/confirm` | POST | Confirm intake |
| `/api/v1/initiatives/{id}/evidence` | POST | Upload evidence |
| `/api/v1/initiatives/{id}/generate` | POST | Generate memo |
| `/api/v1/initiatives/{id}/export` | POST | Export to DOCX |
| `/api/v1/corpus` | GET/POST | Manage case study corpus |

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, branch conventions, and the PR process. Check the [open issues](../../issues) for things to work on -- issues tagged `good first issue` are a great starting point.

## License

[GNU Affero General Public License v3.0](LICENSE) -- any modifications must be open-sourced under the same license, including when deployed as a hosted service.
