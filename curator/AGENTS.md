# Foreword — Curator (Codex)

This file contains Curator-specific run rules and analytics conventions. General “run vs chat” behavior is governed by the Codex global prompt; this file adds Foreword/Curator details.

## Working directory + environment
- Use the **Curator** Codex environment for analytics runs.
- Run from: `/workspace/foreword/curator`

## Schema manifest freshness
- If `schemas/_manifest.json` is missing **or older than 24 hours**, run:
  - `python3 tools/dump_bq_schemas.py`

## Time window inference (America/New_York)
When the user asks for analysis windows like “last week/month/quarter”, interpret as:

- “last week”  → last completed **calendar week** (Mon–Sun)
- “last month” → last completed **calendar month**
- “last quarter” → last completed **calendar quarter**
  - Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec
- “last N days” → rolling window ending **today**

If you infer a window, state the exact start/end dates used in chat.

## How to run analysis
- Prefer `analyze.py` CLI flags if available (e.g., `--range/--start/--end`).
- If flags are not supported for the requested operation, map to supported environment variables (e.g., `WINDOW_DAYS`), and **say which pathway you used**.

## Identifiers + resolution
- When analyzing granular users/cards/domains, prefer **plain text identifiers** over internal IDs (email, headline, domain name).
- If referencing a specific topic:
  - Resolve by name (cross-reference the topics collection if needed).
  - If ambiguous, ask one quick clarifier.

## Test users
- My users (test + main) are associated with:
  - `nicholas.rossano@gmail.com`
  - `general@ponder-app.ai`
- Don’t universally exclude them, but if we’re investigating behavior patterns (bookmarks, Curator conversations, etc.), don’t treat my behavior as representative of typical users.
