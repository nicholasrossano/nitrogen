# Unified Scan Adapter Metrics Queries

These sample BigQuery snippets help verify that adapter-level metrics and events
are flowing into the analytics dataset. Adjust the project, dataset, or table
names if you are overriding the defaults via environment variables.

## Recent Adapter Stats

```sql
SELECT
  run_started_at,
  adapter_id,
  cards_saved,
  press_short,
  unhandled,
  raw_rows,
  processed
FROM `ponder-f84ce.analytics.unified_scan_adapter_stats`
ORDER BY run_started_at DESC
LIMIT 50;
```

## Join Latest Stats With Events

Use this query to fetch qualitative events for the most recent execution of each
adapter and pair them with their corresponding counters:

```sql
WITH latest_runs AS (
  SELECT
    run_id,
    adapter_id,
    ROW_NUMBER() OVER (
      PARTITION BY adapter_id
      ORDER BY run_started_at DESC
    ) AS rn
  FROM `ponder-f84ce.analytics.unified_scan_adapter_stats`
)
SELECT
  e.run_id,
  e.adapter_id,
  s.run_started_at,
  e.occurred_at,
  e.event_type,
  e.error_class,
  e.http_status,
  e.source_url,
  e.message,
  e.metadata,
  s.cards_saved,
  s.press_short,
  s.unhandled
FROM `ponder-f84ce.analytics.unified_scan_adapter_events` AS e
JOIN latest_runs AS lr
  USING (run_id, adapter_id)
JOIN `ponder-f84ce.analytics.unified_scan_adapter_stats` AS s
  USING (run_id, adapter_id)
WHERE lr.rn = 1
ORDER BY e.occurred_at DESC
LIMIT 100;
```

## Filter Specific Event Types

To zero in on HTTP failures (for example, 404 responses) regardless of run,
filter on the event type and optional metadata fields:

```sql
SELECT
  occurred_at,
  adapter_id,
  source_url,
  http_status,
  message
FROM `ponder-f84ce.analytics.unified_scan_adapter_events`
WHERE event_type = 'fetch_error'
  AND http_status = 404
ORDER BY occurred_at DESC
LIMIT 100;
```
