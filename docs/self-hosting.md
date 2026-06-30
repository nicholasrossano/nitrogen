# Running Nitrogen

There are three distinct ways to run Nitrogen. Pick the one that matches your situation.

---

## 1. Local development (your own machine)

**Prerequisites:** Python 3.12+, Node 22+, PostgreSQL with pgvector (or a [Neon](https://neon.tech) cloud DB), OpenAI API key, Firebase project.

```bash
# First time only
cp .env.example .env
# Fill in .env — see comments in the file for each value

bash scripts/worktree_setup.sh   # symlinks backend/.env and frontend/.env.local
bash scripts/check_dev_env.sh    # validates required vars

# Start both servers (persistent, auto-restart)
bash scripts/dev_daemon.sh start
# → http://localhost:3000
```

The daemon keeps running across terminal sessions. `restart` / `stop` / `status` are the other subcommands.

---

## 2. Cursor cloud agents (AI-assisted development)

Cloud agent VMs are fresh every session. They cannot read your local `.env` or your Vercel/Railway dashboards — that's not a bug, it's how every cloud CI/CD platform works. You configure secrets **once** in the Cursor dashboard and they inject into every future VM automatically.

### One-time setup in Cursor → Cloud Agents → Secrets

**Option A — Vercel pull (recommended if frontend is on Vercel)**

Add three secrets:

| Secret name | Where to find it |
|---|---|
| `VERCEL_TOKEN` | vercel.com → Settings → Tokens |
| `VERCEL_PROJECT_ID` | Vercel project → Settings → General → Project ID |
| `VERCEL_ORG_ID` | Vercel project → Settings → General → Team ID (or your personal account ID) |

Then also add the backend-only vars that live in Railway (not Vercel):

| Secret name | Value |
|---|---|
| `DATABASE_URL` | Your Neon/Postgres connection string |
| `NITROGEN_FIREBASE_CREDENTIALS` | Your Firebase service account JSON (inline) |

`materialize_dev_env.sh` auto-runs `vercel env pull` and gets all the frontend vars from Vercel, then writes the backend vars alongside them.

**Option B — Mirror all vars individually**

Add each variable from `.env.example` as a Cursor secret using the exact same key name. No Vercel CLI needed.

**Option C — Mount a file**

Set `NITROGEN_ENV_FILE=/path/to/your/.env` as a Cursor secret pointing to a path that gets mounted into the VM (e.g. via a volume or network share). `materialize_dev_env.sh` symlinks it.

### What happens on each agent session

```
bash scripts/dev_daemon.sh start
```

(Agents run this automatically per `AGENTS.md`.)

1. `materialize_dev_env.sh` resolves `.env` using the order above
2. `worktree_setup.sh` symlinks `backend/.env` and `frontend/.env.local`
3. `check_dev_env.sh` validates required vars
4. Backend (`:8000`) and frontend (`:3000`) start in tmux with auto-restart
5. If backend env is incomplete, frontend still starts so `localhost:3000` is reachable

---

## 3. Self-hosted deployment (own infrastructure)

The project is designed to run backend on **Railway** and frontend on **Vercel**, but any equivalent platform works.

### Backend (any Docker / PaaS host)

Set these environment variables on your host:

```bash
DATABASE_URL=postgresql+asyncpg://...        # Neon or your own Postgres
OPENAI_API_KEY=sk-...
FIREBASE_PROJECT_ID=your-firebase-project
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'  # inline JSON
CORS_ORIGINS=["https://your-frontend-domain.com"]
STORAGE_TYPE=local                           # or firebase for GCS-backed storage
```

Start:
```bash
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Or use the provided `Dockerfile` and `railway.toml`.

### Frontend (any Node / static host)

Set these environment variables on your host (Vercel, Netlify, etc.):

```bash
NEXT_PUBLIC_API_URL=https://your-backend-domain.com
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

Build and start:
```bash
npm run build
npm start
```

### Firebase project (required for auth)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Email/Password** and **Google** sign-in providers
3. Add your domain to **Authorized Domains**
4. Download the service account JSON for the backend
5. Copy the Web app config to your frontend env vars

### Database

Any Postgres database with the `pgvector` extension works. [Neon](https://neon.tech) is the default. Run migrations once:

```bash
cd backend && alembic upgrade head
```

---

## Env var reference

See [`.env.example`](../.env.example) for the full annotated list of every variable, which are required vs optional, and their default values.
