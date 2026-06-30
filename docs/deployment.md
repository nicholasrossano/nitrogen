# Deployment Guide

## Production Environment

### Railway (Backend)

#### Required Environment Variables

Set these in your Railway project dashboard:

```bash
# Database
DATABASE_URL=postgresql+asyncpg://...  # Your Neon connection string

# OpenAI
OPENAI_API_KEY=sk-...

# Storage
STORAGE_TYPE=local
EXPORTS_DIR=./exports
UPLOADS_DIR=./uploads

# CORS - CRITICAL for production
CORS_ORIGINS=["https://your-domain.com"]


# Firebase Auth (required)
FIREBASE_PROJECT_ID=your-firebase-project
NITROGEN_FIREBASE_CREDENTIALS=/path/to/service-account.json
# Or: FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
# Note: For GOOGLE_APPLICATION_CREDENTIALS, upload the JSON file to Railway
# and set this to the file path in the container
```

#### Deployment Configuration

The `railway.toml` file configures:
- Dockerfile-based build
- Health check at `/health`
- Automatic restart on failure

#### Post-Deployment Checklist

1. **Test health endpoint**: `https://your-app.railway.app/health`
2. **Test CORS**: `https://your-app.railway.app/debug/cors`
3. **Check logs** for any errors during startup
4. **Run migrations** if needed (Railway auto-runs on deploy if configured)

### Vercel (Frontend)

#### Required Environment Variables

```bash
NEXT_PUBLIC_API_URL=https://your-app.up.railway.app

# Firebase (required — same Web app config as local .env)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

#### Automatic Deployments

- **Production**: Pushes to `main` branch
- **Preview**: Pull requests and other branches

### Neon (Database)

- Connection string format: `postgresql+asyncpg://user:pass@host/db?ssl=require`
- Always use pooled connection string for serverless environments
- pgvector extension should be enabled

## Common Production Issues

### CORS Errors

**Symptom**: Browser console shows "No 'Access-Control-Allow-Origin' header"

**Causes**:
1. Missing or incorrect `CORS_ORIGINS` in Railway
2. Backend returning 500 error before CORS middleware runs

**Solution**:
1. Check Railway environment variables
2. Check Railway logs for actual error
3. Test with: `curl -I https://your-app.railway.app/health`

### Export Endpoint Failing

**Symptom**: 500 error when exporting memos

**Common causes**:
1. Missing memo in database
2. File system permissions (ensure `./exports` directory exists)
3. Missing Python dependencies (`python-docx`, `docxtpl`, `openpyxl`)
4. Invalid memo content structure

**Debug steps**:
1. Check Railway logs for detailed error message
2. Test memo exists: `GET /api/v1/projects/{id}/memo`
3. Verify exports directory created in Dockerfile
4. Test with a simple memo first

### Database Connection Issues

**Symptom**: FastAPI won't start or returns database errors

**Solution**:
1. Verify `DATABASE_URL` includes `postgresql+asyncpg://` prefix
2. Ensure `?ssl=require` suffix for Neon
3. Check Neon dashboard for connection limits
4. Use pooled connection string from Neon

### Authentication Issues

**Symptom**: 401 Unauthorized errors

**Solution**:
1. Run `bash scripts/check_dev_env.sh` from repo root.
2. Set `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_PROJECT_ID`, and backend credentials (`NITROGEN_FIREBASE_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT_JSON`) in `.env`; run `bash scripts/worktree_setup.sh`.
3. In production: verify the same Firebase vars on the host (e.g. Railway) and that the frontend Firebase Web config matches the project.
4. Sign in via the app and confirm the browser sends a Firebase ID token on API requests. Mock auth is not supported.

## Monitoring

### Health Checks

- **Backend**: `GET /health` - Returns `{"status": "healthy"}`
- **Frontend**: Vercel automatically monitors

### Logging

- **Railway**: View logs in dashboard or via CLI: `railway logs`
- **Vercel**: View logs in deployment details

### Error Tracking

Current setup uses:
- FastAPI's built-in logging
- Console logs in frontend
- Railway's log aggregation

Consider adding:
- Sentry for error tracking
- LogRocket for session replay
- Datadog/New Relic for APM

## Scaling Considerations

### Current Architecture
- **Stateless**: No session storage, can scale horizontally
- **File storage**: Using local filesystem (not suitable for multi-instance)
- **Database**: Neon handles connection pooling

### Future Improvements
1. **Storage**: Migrate from local to GCS/S3 for exports and uploads
2. **Caching**: Add Redis for session data and RAG results
3. **Queue**: Add Celery/Bull for async memo generation
4. **CDN**: Add CloudFront/Cloudflare for static assets

## Rollback Procedure

### Railway
1. Go to deployment history
2. Select previous successful deployment
3. Click "Redeploy"

### Vercel
1. Go to deployments
2. Find last working deployment
3. Click "Promote to Production"

## Environment Variable Management

### Security Best Practices
1. Never commit `.env` files
2. Use Railway's secrets for sensitive values
3. Rotate API keys regularly
4. Use different keys for dev/staging/prod

### Variable Precedence
1. Railway environment variables (highest)
2. `.env` file
3. Default values in `config.py` (lowest)

## Database Migrations

### Running Migrations on Railway

**Option 1: Automatic (Recommended)**
Add to `Procfile` or startup command:
```bash
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

**Option 2: Manual**
```bash
railway run alembic upgrade head
```

### Creating New Migrations

```bash
# Local development
cd backend
alembic revision --autogenerate -m "description"
alembic upgrade head

# Commit and push - Railway will run on deploy
git add backend/alembic/versions/
git commit -m "Add migration: description"
git push
```
