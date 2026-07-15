# Archived one-shot backend scripts

Finished migration/backfill utilities. Not used by CI or the running app.

| Script | Original purpose |
|---|---|
| `migrate_to_shared_user.py` | Firebase multi-user → shared-user migration |
| `add_icons_to_existing.py` | Icon backfill |
| `backfill_file_sizes.py` | `file_size` column backfill |
| `backfill_implementation_plan_instances.py` | `project_plan` → assessment instances |
| `wipe_empty_assumptions_and_reextract.py` | One-time assumptions cleanup |

Still-active ops scripts remain in `backend/scripts/` (e.g. visual chunk backfill / reprocess).
