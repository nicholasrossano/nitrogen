# Troubleshooting Export Issues

## Problem: Export Endpoint Returns 500 Error with CORS Issues

### Symptoms
```
Access to fetch at 'https://nitrogen-production.up.railway.app/api/v1/initiatives/{id}/export' 
from origin 'https://nitrogen-sandy.vercel.app' has been blocked by CORS policy: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.

POST https://nitrogen-production.up.railway.app/api/v1/initiatives/{id}/export 
net::ERR_FAILED 500 (Internal Server Error)
```

### Root Causes

This error message is **misleading**. The CORS error is a **symptom**, not the cause. Here's what's actually happening:

1. **Primary Issue**: The export endpoint throws an exception (500 error)
2. **Secondary Issue**: When FastAPI encounters an unhandled exception, it returns a 500 response before the CORS middleware can add headers
3. **Browser Behavior**: The browser sees missing CORS headers and reports a CORS error, hiding the real 500 error

### Diagnosis Steps

#### Step 1: Check Railway Logs

Go to Railway dashboard → Your project → Logs

Look for:
```
ERROR:app.api.exports:Export failed for initiative {id}: {error message}
```

Common errors:
- `FileNotFoundError`: Exports directory doesn't exist
- `PermissionError`: Can't write to exports directory  
- `ModuleNotFoundError`: Missing Python dependency
- `ValidationError`: Invalid memo content structure
- `KeyError`: Missing field in memo content

#### Step 2: Test Health Endpoints

```bash
# Test basic health
curl https://nitrogen-production.up.railway.app/health

# Check CORS configuration
curl https://nitrogen-production.up.railway.app/debug/cors

# Check application configuration
curl https://nitrogen-production.up.railway.app/debug/config
```

#### Step 3: Test Memo Exists

```bash
# Get the memo (replace {id} with your initiative ID)
curl -H "Authorization: Bearer dev-mock-token" \
  https://nitrogen-production.up.railway.app/api/v1/initiatives/{id}/memo
```

If this returns 404, you need to generate a memo first.

#### Step 4: Test Export Locally

```bash
cd backend
python scripts/test_export.py
```

This will test the DOCX generation in isolation.

### Solutions

#### Solution 1: Fix CORS Configuration (Railway)

Set the `CORS_ORIGINS` environment variable in Railway:

```bash
CORS_ORIGINS=["https://nitrogen-sandy.vercel.app"]
```

**Why this matters**: Even though you have `allow_origin_regex` in the code, you need at least one valid origin in the environment variable.

**How to set**:
1. Go to Railway dashboard
2. Select your project → Variables
3. Add/update `CORS_ORIGINS`
4. Redeploy (may happen automatically)

#### Solution 2: Ensure Exports Directory Exists

The Dockerfile should create this, but verify:

```dockerfile
# In Dockerfile
RUN mkdir -p /app/exports
```

Check the debug endpoint:
```bash
curl https://nitrogen-production.up.railway.app/debug/config
```

Look for:
```json
{
  "exports_dir": "./exports",
  "exports_dir_exists": true
}
```

If `exports_dir_exists` is `false`, the directory isn't being created properly.

#### Solution 3: Check Python Dependencies

Verify `requirements.txt` includes:
```
python-docx>=1.1.0
docxtpl>=0.16.7
openpyxl>=3.1.2
```

Railway should install these automatically, but check the build logs.

#### Solution 4: Validate Memo Content Structure

The most common issue is invalid memo content. Check your memo has all required fields:

```python
{
  "title": str,
  "date": str,
  "executive_summary": str,
  "recommendation": "proceed" | "hold" | "reject",
  "recommendation_rationale": str,
  "evidence_summary": str,
  "risks_and_assumptions": str,
  "open_questions": list[str],
  "citations": list[{
    "number": int,
    "source_type": "evidence" | "corpus",
    "source_title": str,
    "excerpt": str,
    "chunk_id": str
  }]
}
```

### Quick Fix Checklist

- [ ] Railway environment variable `CORS_ORIGINS` includes your Vercel domain
- [ ] Railway logs show what error is actually happening
- [ ] `/debug/config` shows exports directory exists
- [ ] Memo exists for the initiative (check `/api/v1/initiatives/{id}/memo`)
- [ ] Test export works locally (`python scripts/test_export.py`)
- [ ] All required dependencies in `requirements.txt`
- [ ] Dockerfile creates exports directory

### Still Not Working?

If you've tried all the above:

1. **Check specific error in Railway logs** - This will tell you exactly what's failing
2. **Test with a fresh initiative** - Create new, generate memo, export
3. **Check Neon database** - Ensure memo_versions table has data
4. **Verify file permissions** - Railway container should be able to write to /app/exports
5. **Test DOCX generation locally** - Use `scripts/test_export.py`

### Understanding the Error Chain

```
User clicks Export
    ↓
Frontend sends POST to /api/v1/initiatives/{id}/export
    ↓
Backend receives request
    ↓
Export endpoint runs (exports.py)
    ↓
[SOMETHING FAILS HERE - Check Railway logs to see what]
    ↓
Python raises exception
    ↓
FastAPI returns 500 response (no CORS headers added)
    ↓
Browser sees missing CORS headers
    ↓
Browser shows "No 'Access-Control-Allow-Origin' header"
    ↓
Real error is hidden - need to check server logs!
```

### Prevention

To avoid this in the future:

1. **Always check Railway logs first** when debugging production issues
2. **Test exports locally** before deploying changes
3. **Use the test script** (`scripts/test_export.py`) in CI/CD
4. **Monitor Railway logs** for any warnings during normal operation
5. **Keep CORS_ORIGINS updated** when adding new domains

### Related Issues

- **Checklist export fails**: Same issue, check `export-checklist` endpoint
- **Download fails after export**: Different issue - check storage/file loading
- **Export works sometimes**: Race condition or database consistency issue

## Additional Resources

- [FastAPI CORS Documentation](https://fastapi.tiangolo.com/tutorial/cors/)
- [Railway Logging Guide](https://docs.railway.app/reference/logs)
- [Debugging 500 Errors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500)
