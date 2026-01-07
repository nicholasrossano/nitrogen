#!/usr/bin/env python3
import os
import json
import time
import base64
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from google.cloud import bigquery
from google.oauth2 import service_account
from google.api_core import exceptions as gexc


BASE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = BASE_DIR / "schemas"
MANIFEST_PATH = OUT_DIR / "_manifest.json"

PK_CANDIDATES = ["document_id", "card_id", "id", "uuid", "item_id", "news_id"]
TIME_CANDIDATES = ["timestamp", "created_at", "updated_at", "published_at", "ts", "created"]


# ─────────── Section Header ───────────
def _load_service_account_info(raw: str) -> Optional[Dict[str, Any]]:
	raw = (raw or "").strip()
	if not raw:
		return None

	if raw.startswith("{"):
		try:
			return json.loads(raw)
		except Exception:
			return None

	try:
		decoded = base64.b64decode(raw).decode("utf-8")
		return json.loads(decoded)
	except Exception:
		return None


def _credentials() -> Optional[service_account.Credentials]:
	raw = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
	info = _load_service_account_info(raw) if raw else None
	if info:
		return service_account.Credentials.from_service_account_info(info)

	path = (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
	if path and os.path.exists(path):
		try:
			return service_account.Credentials.from_service_account_file(path)
		except Exception:
			return None

	return None


def _project_id() -> str:
	for key in ("BQ_PROJECT", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"):
		val = (os.environ.get(key) or "").strip()
		if val:
			return val

	raw = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
	info = _load_service_account_info(raw) if raw else None
	if info and isinstance(info, dict):
		project_id = (info.get("project_id") or "").strip()
		if project_id:
			return project_id

	path = (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
	if path and os.path.exists(path):
		try:
			info = json.loads(open(path, "r", encoding="utf-8").read())
			project_id = (info.get("project_id") or "").strip()
			if project_id:
				return project_id
		except Exception:
			pass

	raise RuntimeError("Missing BigQuery project id. Set BQ_PROJECT or provide valid service account creds.")


def _datasets() -> List[str]:
	raw = (os.environ.get("BQ_DATASETS") or "analytics").strip()
	if not raw:
		return ["analytics"]
	return [d.strip() for d in raw.split(",") if d.strip()]


def _env_int(name: str, default: int) -> int:
	try:
		return int((os.environ.get(name) or str(default)).strip())
	except Exception:
		return default


def _client() -> bigquery.Client:
	project = _project_id()
	creds = _credentials()
	return bigquery.Client(project=project, credentials=creds) if creds else bigquery.Client(project=project)


def _type_and_mode(data_type: str, is_nullable: str) -> Tuple[str, str]:
	t = (data_type or "").strip().upper()
	nullable = (is_nullable or "").strip().upper() == "YES"

	mode = "NULLABLE" if nullable else "REQUIRED"
	field_type = t

	if t.startswith("ARRAY<") and t.endswith(">"):
		mode = "REPEATED"
		inner = t[len("ARRAY<"):-1].strip()
		field_type = inner

	if field_type.startswith("STRUCT<") or field_type == "STRUCT":
		field_type = "RECORD"

	m = {
		"INT64": "INTEGER",
		"FLOAT64": "FLOAT",
		"BOOL": "BOOLEAN",
	}
	field_type = m.get(field_type, field_type)
	return field_type, mode


def _guess_pk(column_names: List[str]) -> Optional[str]:
	names = set(column_names)
	for c in PK_CANDIDATES:
		if c in names:
			return c
	for n in names:
		if n.endswith("_id") and n not in ("topic_id",):
			return n
	return None


def _guess_time(columns: List[Dict[str, Any]]) -> Optional[str]:
	names = {c["name"]: c for c in columns}
	for c in TIME_CANDIDATES:
		if c in names:
			return c
	for c in columns:
		if c.get("type") in ("TIMESTAMP", "DATETIME"):
			return c["name"]
	return None


def _run_query_rows(c: bigquery.Client, sql: str, timeout_sec: int) -> List[bigquery.table.Row]:
	job = c.query(sql)
	return list(job.result(timeout=timeout_sec))


def main() -> None:
	OUT_DIR.mkdir(parents=True, exist_ok=True)

	max_age_sec = _env_int("BQ_SCHEMA_MAX_AGE_SEC", 86400)
	timeout_sec = _env_int("BQ_SCHEMA_QUERY_TIMEOUT_SEC", 45)

	if MANIFEST_PATH.exists() and max_age_sec > 0:
		age = int(time.time() - MANIFEST_PATH.stat().st_mtime)
		if age < max_age_sec:
			print(f"[schemas] manifest fresh ({age}s old) — skipping refresh.")
			return

	project = _project_id()
	datasets = _datasets()
	c = _client()

	print(f"[schemas] project={project} datasets={datasets}", flush=True)

	manifest: Dict[str, Any] = {
		"project": project,
		"generated_at": datetime.now(timezone.utc).isoformat(),
		"datasets": {},
	}

	errors: List[Dict[str, Any]] = []
	any_dataset_ok = False

	for ds in datasets:
		print(f"[schemas] dataset={ds} querying INFORMATION_SCHEMA…", flush=True)

		tables_sql = f"""
		SELECT table_name, table_type
		FROM `{project}.{ds}.INFORMATION_SCHEMA.TABLES`
		ORDER BY table_name
		"""

		cols_sql = f"""
		SELECT table_name, column_name, data_type, is_nullable, ordinal_position
		FROM `{project}.{ds}.INFORMATION_SCHEMA.COLUMNS`
		ORDER BY table_name, ordinal_position
		"""

		try:
			table_rows = _run_query_rows(c, tables_sql, timeout_sec=timeout_sec)
			col_rows = _run_query_rows(c, cols_sql, timeout_sec=timeout_sec)
		except Exception as e:
			errors.append({"dataset": ds, "error": str(e)})
			print(f"[schemas] dataset={ds} ERROR: {e}", flush=True)
			manifest["datasets"][ds] = {"tables": []}
			continue

		table_type_map: Dict[str, str] = {}
		for r in table_rows:
			name = str(r["table_name"])
			tt = str(r["table_type"] or "")
			tt_u = tt.upper()
			if "VIEW" in tt_u:
				out_tt = "VIEW"
			elif "TABLE" in tt_u:
				out_tt = "TABLE"
			else:
				out_tt = tt_u or "TABLE"
			table_type_map[name] = out_tt

		cols_by_table: Dict[str, List[Dict[str, Any]]] = {}
		for r in col_rows:
			tname = str(r["table_name"])
			cname = str(r["column_name"])
			dtype = str(r["data_type"] or "")
			isnull = str(r["is_nullable"] or "YES")
			ftype, mode = _type_and_mode(dtype, isnull)
			cols_by_table.setdefault(tname, []).append({"name": cname, "type": ftype, "mode": mode})

		tables_out: List[Dict[str, Any]] = []
		for tname in sorted(table_type_map.keys()):
			cols = cols_by_table.get(tname, [])
			col_names = [c["name"] for c in cols]
			pk = _guess_pk(col_names)
			tf = _guess_time(cols)

			tables_out.append({
				"table": f"{project}.{ds}.{tname}",
				"dataset": ds,
				"name": tname,
				"type": table_type_map.get(tname, "TABLE"),
				"primary_key": pk,
				"time_field": tf,
				"columns": cols,
				"partitioning": None,
				"clustering": [],
			})

		manifest["datasets"][ds] = {"tables": tables_out}
		print(f"[schemas] dataset={ds} tables={len(tables_out)}", flush=True)
		any_dataset_ok = True

	if any_dataset_ok:
		MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
		print(f"[schemas] wrote {MANIFEST_PATH}", flush=True)

		if errors:
			(OUT_DIR / "_errors.json").write_text(json.dumps(errors, ensure_ascii=False, indent=2), encoding="utf-8")
			print(f"[schemas] warnings={len(errors)} wrote schemas/_errors.json", flush=True)
		return

	if MANIFEST_PATH.exists():
		print("[schemas] refresh failed, but keeping existing manifest.", flush=True)
		return

	raise RuntimeError("[schemas] refresh failed and no existing manifest is available.")


if __name__ == "__main__":
	main()
