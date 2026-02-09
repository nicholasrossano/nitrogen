# Export Issue Summary

## What You're Seeing

```
Access to fetch at 'https://nitrogen-production.up.railway.app/api/v1/initiatives/{id}/export' 
from origin 'https://nitrogen-sandy.vercel.app' has been blocked by CORS policy: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.

POST .../export net::ERR_FAILED 500 (Internal Server Error)
```

## What's Actually Happening

**The CORS error is a red herring.** Here's the real story:

1. Your backend is returning a `500 Internal Server Error`
2. When FastAPI encounters an unhandled exception, it returns 500 **before** CORS middleware runs
3. The response has no CORS headers
4. Browser sees missing CORS headers and reports "CORS policy" error
5. **The real error is hidden on the server side**

## The Real Problem

The export endpoint (`/api/v1/initiatives/{id}/export`) is throwing an exception. Common causes:

- **Missing memo**: No memo exists for this initiative
- **Invalid memo content**: Memo missing required fields
- **File system issue**: Can't write to exports directory
- **Missing dependency**: `python-docx`, `docxtpl`, or `openpyxl` not installed
- **Database error**: Can't read memo from database

## Immediate Actions Required

### 1. Check Railway Logs (Most Important!)

Go to Railway dashboard → Logs and look for the actual error:

```
ERROR:app.api.exports:Export failed for initiative {id}: [THE REAL ERROR MESSAGE]
```

This will tell you **exactly** what's failing.

### 2. Fix CORS Configuration on Railway

Even though the CORS error is a symptom, you still need to fix it:

**Set in Railway environment variables:**
```bash
CORS_ORIGINS=["https://nitrogen-sandy.vercel.app"]
```

Your code already has `allow_origin_regex=r"https://.*\.vercel\.app"` to handle preview deployments.

### 3. Test These Endpoints

```bash
# Check backend health
curl https://nitrogen-production.up.railway.app/health

# Check CORS config
curl https://nitrogen-production.up.railway.app/debug/cors

# Check file system and config
curl https://nitrogen-production.up.railway.app/debug/config

# Check if memo exists (replace {id})
curl -H "Authorization: Bearer dev-mock-token" \
  https://nitrogen-production.up.railway.app/api/v1/initiatives/{id}/memo
```

## What I've Fixed in the Code

### 1. Added Detailed Logging to Export Endpoint

The export endpoint now logs every step:
- When request starts
- Initiative lookup
- Memo lookup  
- DOCX generation
- File saving
- Any errors with full stack trace

**File**: `backend/app/api/exports.py`

### 2. Added Better Error Handling

All exceptions are now caught and logged with details before re-raising as HTTP errors.

### 3. Added Debug Endpoint

New endpoint `/debug/config` shows:
- Storage configuration
- Whether exports directory exists
- What environment variables are set

### 4. Added Export Test Script

**File**: `backend/scripts/test_export.py`

Run locally to test DOCX generation:
```bash
cd backend
python scripts/test_export.py
```

This tests export in isolation without hitting the database.

## Why It Might Be Inconsistent

If exports work sometimes but not always, possible causes:

1. **Different memos have different content structures** - Some may have invalid data
2. **Race condition** - Memo not fully saved when export runs
3. **Database connection issues** - Intermittent connection to Neon
4. **File system issues** - Directory permissions or disk space
5. **Different users** - Some memos might be from different users (auth issue)

## Next Steps

### Step 1: Check Railway Logs (Do This First!)

The logs will show the real error. Once you see the error message, you'll know exactly what to fix.

### Step 2: Fix the Root Cause

Based on what the logs show:

**If "No memo found":**
- Generate a memo first before exporting
- Or check database for memo_versions table

**If "Permission denied" or "Cannot write":**
- Check Dockerfile creates `/app/exports`
- Check Railway environment has write permissions

**If "ModuleNotFoundError":**
- Check `requirements.txt` has all dependencies
- Check Railway build logs for installation errors

**If "KeyError" or "ValidationError":**
- Check memo content structure
- Fix memo generation to include all required fields

### Step 3: Update Railway Environment

Set `CORS_ORIGINS` to include your Vercel domain:
```bash
CORS_ORIGINS=["https://nitrogen-sandy.vercel.app"]
```

### Step 4: Redeploy

After fixing the code and environment variables:
```bash
git add .
git commit -m "Fix export endpoint error handling and CORS"
git push
```

Railway will auto-deploy.

### Step 5: Test Again

After deployment:
1. Try export again from frontend
2. Check Railway logs to see if error is gone
3. Verify CORS headers are present

## Files Created/Modified

### New Files
- `DEPLOYMENT.md` - Complete deployment guide for Railway/Vercel
- `TROUBLESHOOTING_EXPORT.md` - Detailed troubleshooting guide
- `backend/scripts/test_export.py` - Test script for DOCX export
- `EXPORT_ISSUE_SUMMARY.md` - This file

### Modified Files
- `backend/app/api/exports.py` - Added logging and error handling
- `backend/app/main.py` - Added `/debug/config` endpoint
- `backend/app/services/docx_exporter.py` - Added error logging

## Testing Checklist

Before deploying to production:

- [ ] Run `python backend/scripts/test_export.py` locally
- [ ] Verify exports directory exists: `ls -la backend/exports/`
- [ ] Check `requirements.txt` has all dependencies
- [ ] Test memo generation works
- [ ] Test memo has all required fields
- [ ] Set `CORS_ORIGINS` on Railway
- [ ] Check Railway build succeeds
- [ ] Check Railway logs after deployment
- [ ] Test export from frontend
- [ ] Verify downloaded DOCX opens correctly

## Quick Reference

**Railway Environment Variables Needed:**
```bash
DATABASE_URL=postgresql+asyncpg://...
OPENAI_API_KEY=sk-...
CORS_ORIGINS=["https://nitrogen-sandy.vercel.app"]
STORAGE_TYPE=local
EXPORTS_DIR=./exports
```

**Debug Endpoints:**
```bash
GET /health                    # Basic health check
GET /debug/cors                # CORS configuration
GET /debug/config              # Full config including file system
GET /api/v1/initiatives/{id}/memo  # Check memo exists
```

**Local Testing:**
```bash
cd backend
python scripts/test_export.py
```

## Summary

The issue is **not CORS** - it's a **500 error** that happens before CORS headers can be added. You need to:

1. **Check Railway logs** to see the real error
2. **Fix the root cause** based on the error message  
3. **Update CORS_ORIGINS** on Railway to include Vercel domain
4. **Redeploy and test**

The code changes I made will help you debug by providing detailed logs and better error messages.
