# Curator

Curator runs in Codex to (1) dump BigQuery table schemas into `schemas/_manifest.json` and (2) generate a weekly QA brief (`report.md` + charts). It can also be run locally.

---

## Codex setup

**Secrets**
- `BQ_PROJECT`
- `BQ_DATASETS`
- `GOOGLE_APPLICATION_CREDENTIALS_JSON`
- `BQ_TABLE_CARDS` (optional; used by `weekly-qa`)

The daily lane summary reuses the same BigQuery credentials that power the existing tasks, so no additional secrets are required beyond the above.

**Scheduled tasks**
- `daily-lane-summary` runs every morning at 7am Pacific, executes `daily_lane_summary.py`, and posts a daily rundown of unified scan adapter health (with the Markdown report saved as `report.md`).

**Chat-first output**
- Curator can write artifacts, but you likely want explanations **in the chat thread**.
- This is enforced by the env var: `CURATOR_THREAD_PLAIN=1`.
- It’s already set per-task in `codex.yml` (both `dump-schemas` and `weekly-qa`).
  If you ever create new tasks, add:
  ```yaml
  env:
    CURATOR_THREAD_PLAIN: "1"
