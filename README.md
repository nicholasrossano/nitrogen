# Wisterion

Chat-first decision packet studio. Generate investment memos grounded in evidence through conversational AI.

## Overview

Wisterion helps users create structured decision documents by:
1. **Conversational Intake** - Chat with an AI assistant to define your initiative
2. **Evidence Upload** - Upload a document or paste text as supporting evidence
3. **Memo Generation** - Generate an investment memo with citations from both your evidence and a curated case study corpus

## Tech Stack

- **Frontend**: Next.js 14 (TypeScript), Tailwind CSS, Zustand
- **Backend**: FastAPI (Python), SQLAlchemy, Alembic
- **Database**: PostgreSQL with pgvector for embeddings
- **AI**: OpenAI GPT-4 for chat/generation, text-embedding-ada-002 for RAG
- **Auth**: Firebase Authentication (optional for MVP)

## Quick Start

### Prerequisites

- Docker & Docker Compose
- OpenAI API key

### Setup

1. Clone and configure:
```bash
cd Wisterion
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

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
python scripts/seed_corpus.py
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## Project Structure

```
Wisterion/
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

## Demo Flow

1. Start chat → "What are you working on?"
2. Answer follow-up questions about your initiative
3. Confirm the initiative summary
4. Upload a supporting document
5. Generate a memo with AI-powered citations
6. Export to Word document

## License

Proprietary - All rights reserved
