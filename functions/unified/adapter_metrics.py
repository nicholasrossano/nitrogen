import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from google.cloud import bigquery

import config

log = logging.getLogger(__name__)
log.setLevel(logging.INFO)

PROJECT_ID = getattr(config, "PROJECT_ID", os.getenv("PROJECT_ID", "ponder-f84ce"))
BQ_DATASET = os.getenv("BQ_ANALYTICS_DATASET") or getattr(config, "BQ_DATASET", "analytics")
TABLE_NAME = os.getenv("UNIFIED_SCAN_ADAPTER_TABLE", "unified_scan_adapter_stats")
TABLE_FQN = f"{PROJECT_ID}.{BQ_DATASET}.{TABLE_NAME}"
EVENT_TABLE_NAME = os.getenv(
    "UNIFIED_SCAN_ADAPTER_EVENT_TABLE", "unified_scan_adapter_events"
)
EVENT_TABLE_FQN = f"{PROJECT_ID}.{BQ_DATASET}.{EVENT_TABLE_NAME}"

_BACKEND = (
    os.getenv("UNIFIED_SCAN_METRICS_BACKEND")
    or getattr(config, "UNIFIED_SCAN_METRICS_BACKEND", "auto")
).lower()

_EMULATOR_HINT = bool(
    os.getenv("FIRESTORE_EMULATOR_HOST")
    or os.getenv("FUNCTIONS_EMULATOR")
    or os.getenv("FIREBASE_FIRESTORE_EMULATOR_ADDRESS")
)

_BQ_CLIENT: Optional[bigquery.Client] = None
_READY_TABLES: set[str] = set()

_STATS_SCHEMA = [
    bigquery.SchemaField("run_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("adapter_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("run_started_at", "TIMESTAMP", mode="NULLABLE"),
    bigquery.SchemaField("started_at", "TIMESTAMP", mode="NULLABLE"),
    bigquery.SchemaField("finished_at", "TIMESTAMP", mode="NULLABLE"),
    bigquery.SchemaField("duration_ms", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("planned_target", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("effective_target", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("raw_rows", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("processed", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("cards_saved", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("cooldown", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("no_body", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("press_none", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("press_empty", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("press_short", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("save_fail", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("unhandled", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("pipeline_order", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("requested_pipelines", "STRING", mode="NULLABLE"),
    bigquery.SchemaField("requested_raw", "STRING", mode="NULLABLE"),
]

_EVENT_SCHEMA = [
    bigquery.SchemaField("run_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("adapter_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("event_type", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("occurred_at", "TIMESTAMP", mode="NULLABLE"),
    bigquery.SchemaField("run_started_at", "TIMESTAMP", mode="NULLABLE"),
    bigquery.SchemaField("adapter_started_at", "TIMESTAMP", mode="NULLABLE"),
    bigquery.SchemaField("pipeline_order", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("entity_key", "STRING", mode="NULLABLE"),
    bigquery.SchemaField("message", "STRING", mode="NULLABLE"),
    bigquery.SchemaField("error_class", "STRING", mode="NULLABLE"),
    bigquery.SchemaField("http_status", "INT64", mode="NULLABLE"),
    bigquery.SchemaField("source_url", "STRING", mode="NULLABLE"),
    bigquery.SchemaField("requested_pipelines", "STRING", mode="NULLABLE"),
    bigquery.SchemaField("requested_raw", "STRING", mode="NULLABLE"),
    bigquery.SchemaField("metadata", "STRING", mode="NULLABLE"),
]


def _bq_client() -> Optional[bigquery.Client]:
    global _BQ_CLIENT
    if _BQ_CLIENT is not None:
        return _BQ_CLIENT
    try:
        _BQ_CLIENT = bigquery.Client(project=PROJECT_ID)
        return _BQ_CLIENT
    except Exception as exc:  # pragma: no cover - defensive
        log.warning(f"[adapter_metrics] BigQuery client init failed: {exc}")
        _BQ_CLIENT = None
        return None


def _ensure_dataset(client: bigquery.Client) -> None:
    try:
        dataset_ref = bigquery.Dataset(f"{PROJECT_ID}.{BQ_DATASET}")
        client.create_dataset(dataset_ref, exists_ok=True)
    except Exception:
        try:
            client.get_dataset(f"{PROJECT_ID}.{BQ_DATASET}")
        except Exception as exc:  # pragma: no cover - defensive
            log.warning(f"[adapter_metrics] ensure_dataset failed: {exc}")


def _ensure_table(table_fqn: str, schema: list[bigquery.SchemaField], partition_field: str) -> None:
    if table_fqn in _READY_TABLES:
        return
    client = _bq_client()
    if client is None:
        return
    try:
        _ensure_dataset(client)
        try:
            client.get_table(table_fqn)
        except Exception:
            table = bigquery.Table(table_fqn, schema=schema)
            table.time_partitioning = bigquery.TimePartitioning(
                type_=bigquery.TimePartitioningType.DAY,
                field=partition_field,
            )
            client.create_table(table, exists_ok=True)
        _READY_TABLES.add(table_fqn)
    except Exception as exc:  # pragma: no cover - defensive
        log.warning(f"[adapter_metrics] ensure_table failed for {table_fqn}: {exc}")


def _ts(val: Any) -> Any:
    if isinstance(val, datetime):
        return val.isoformat()
    return val


def _write_firestore(row: Dict[str, Any], firestore_client: Optional[Any]) -> bool:
    client = firestore_client
    if client is None:
        try:
            from firebase_admin import firestore as firestore_admin  # type: ignore

            client = firestore_admin.client()
        except Exception as exc:  # pragma: no cover - defensive
            log.debug(f"[adapter_metrics] Firestore client unavailable: {exc}")
            return False

    try:
        doc_id = f"{row['run_id']}-{row.get('pipeline_order', 0)}-{row['adapter_id']}"
        client.collection(TABLE_NAME).document(doc_id).set(row)
        return True
    except Exception as exc:  # pragma: no cover - defensive
        log.warning(f"[adapter_metrics] Firestore write failed for {row['adapter_id']}: {exc}")
        return False


def _write_firestore_event(row: Dict[str, Any], firestore_client: Optional[Any]) -> bool:
    client = firestore_client
    if client is None:
        try:
            from firebase_admin import firestore as firestore_admin  # type: ignore

            client = firestore_admin.client()
        except Exception as exc:  # pragma: no cover - defensive
            log.debug(f"[adapter_metrics] Firestore client unavailable: {exc}")
            return False

    try:
        client.collection(EVENT_TABLE_NAME).add(row)
        return True
    except Exception as exc:  # pragma: no cover - defensive
        log.warning(
            f"[adapter_metrics] Firestore event write failed for {row.get('event_type')}: {exc}"
        )
        return False


def record_adapter_stats(
    run_id: str,
    adapter_id: str,
    stats: Dict[str, int],
    metadata: Dict[str, Any],
    firestore_client: Optional[Any] = None,
) -> None:
    row_common: Dict[str, Any] = {
        "run_id": run_id,
        "adapter_id": adapter_id,
        "run_started_at": metadata.get("run_started_at"),
        "started_at": metadata.get("started_at"),
        "finished_at": metadata.get("finished_at"),
        "duration_ms": metadata.get("duration_ms"),
        "planned_target": metadata.get("planned_target"),
        "effective_target": metadata.get("effective_target"),
        "raw_rows": metadata.get("raw_rows"),
        "processed": metadata.get("processed"),
        "pipeline_order": metadata.get("pipeline_order"),
        "requested_pipelines": metadata.get("requested_pipelines"),
        "requested_raw": metadata.get("requested_raw"),
    }

    for key in (
        "cards_saved",
        "cooldown",
        "no_body",
        "press_none",
        "press_empty",
        "press_short",
        "save_fail",
        "unhandled",
    ):
        row_common[key] = int(stats.get(key, 0))

    wrote_firestore = False
    bq_success = False

    if _BACKEND in {"bigquery", "auto"}:
        client = _bq_client()
        if client is not None:
            _ensure_table(TABLE_FQN, _STATS_SCHEMA, "run_started_at")
            if TABLE_FQN in _READY_TABLES:
                bq_row = {**row_common}
                bq_row["run_started_at"] = _ts(bq_row["run_started_at"])
                bq_row["started_at"] = _ts(bq_row["started_at"])
                bq_row["finished_at"] = _ts(bq_row["finished_at"])
                try:
                    errors = client.insert_rows_json(TABLE_FQN, [bq_row])
                    if errors:  # pragma: no cover - defensive
                        log.warning(
                            f"[adapter_metrics] insert errors for {adapter_id}: {errors}"
                        )
                    else:
                        bq_success = True
                except Exception as exc:  # pragma: no cover - defensive
                    log.warning(
                        f"[adapter_metrics] insert failed for {adapter_id}: {exc}"
                    )
        elif _BACKEND == "bigquery":
            return

    should_write_firestore = _BACKEND == "firestore" or (
        _BACKEND == "auto" and not bq_success
    )

    if should_write_firestore:
        wrote_firestore = _write_firestore(row_common, firestore_client)
        if wrote_firestore:
            return

    if not wrote_firestore and firestore_client is not None and not bq_success:
        _write_firestore(row_common, firestore_client)

    if bq_success and _BACKEND == "bigquery":
        return


def record_adapter_event(
    run_id: str,
    adapter_id: str,
    event_type: str,
    event: Dict[str, Any],
    firestore_client: Optional[Any] = None,
) -> None:
    occurred_at = event.get("occurred_at")
    if occurred_at is None:
        occurred_at = datetime.now(timezone.utc)
    elif isinstance(occurred_at, datetime) and occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=timezone.utc)
    row_common: Dict[str, Any] = {
        "run_id": run_id,
        "adapter_id": adapter_id,
        "event_type": event_type,
        "occurred_at": occurred_at,
        "run_started_at": event.get("run_started_at"),
        "adapter_started_at": event.get("adapter_started_at"),
        "pipeline_order": event.get("pipeline_order"),
        "entity_key": event.get("entity_key"),
        "message": event.get("message"),
        "error_class": event.get("error_class"),
        "http_status": event.get("http_status"),
        "source_url": event.get("source_url"),
        "requested_pipelines": event.get("requested_pipelines"),
        "requested_raw": event.get("requested_raw"),
    }

    metadata_val = event.get("metadata")
    firestore_row = dict(row_common)
    if metadata_val is not None:
        firestore_row["metadata"] = metadata_val

    bq_row = dict(row_common)
    if metadata_val is not None:
        if isinstance(metadata_val, str):
            bq_row["metadata"] = metadata_val
        else:
            try:
                bq_row["metadata"] = json.dumps(metadata_val, default=str)
            except Exception:
                bq_row["metadata"] = json.dumps({"value": str(metadata_val)})
    else:
        bq_row["metadata"] = None

    bq_success = False
    if _BACKEND in {"bigquery", "auto"}:
        client = _bq_client()
        if client is not None:
            _ensure_table(EVENT_TABLE_FQN, _EVENT_SCHEMA, "occurred_at")
            if EVENT_TABLE_FQN in _READY_TABLES:
                bq_row["occurred_at"] = _ts(bq_row["occurred_at"])
                bq_row["run_started_at"] = _ts(bq_row["run_started_at"])
                bq_row["adapter_started_at"] = _ts(bq_row["adapter_started_at"])
                try:
                    errors = client.insert_rows_json(EVENT_TABLE_FQN, [bq_row])
                    if errors:  # pragma: no cover - defensive
                        log.warning(
                            f"[adapter_metrics] event insert errors for {adapter_id}: {errors}"
                        )
                    else:
                        bq_success = True
                except Exception as exc:  # pragma: no cover - defensive
                    log.warning(
                        f"[adapter_metrics] event insert failed for {adapter_id}: {exc}"
                    )
        elif _BACKEND == "bigquery":
            return

    should_write_firestore = _BACKEND == "firestore" or (
        _BACKEND == "auto" and not bq_success
    )

    if should_write_firestore:
        wrote_firestore = _write_firestore_event(firestore_row, firestore_client)
        if wrote_firestore:
            return

    if not bq_success and firestore_client is not None:
        _write_firestore_event(firestore_row, firestore_client)

