import os
import json
import re
import time
import base64
import datetime as dt
from typing import Any, Dict, Tuple, Optional

from google.cloud import bigquery
from google.oauth2 import service_account
from google.api_core import exceptions as gexc


_SAFE_READ_SQL = re.compile(r"^\s*(?:--[^\n]*\n\s*)*(WITH|SELECT)\b", re.I)
_TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T[\d:]+(?:\.\d+)?Z$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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


def get_project_id() -> str:
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


def client() -> bigquery.Client:
	project = get_project_id()
	creds = _credentials()
	return bigquery.Client(project=project, credentials=creds) if creds else bigquery.Client(project=project)


def _bq_param(key: str, val: Any) -> bigquery.ScalarQueryParameter:
	if isinstance(val, dt.datetime):
		return bigquery.ScalarQueryParameter(key, "TIMESTAMP", val)
	if isinstance(val, dt.date):
		return bigquery.ScalarQueryParameter(key, "DATE", val)
	if isinstance(val, bool):
		return bigquery.ScalarQueryParameter(key, "BOOL", val)
	if isinstance(val, int):
		return bigquery.ScalarQueryParameter(key, "INT64", val)
	if isinstance(val, float):
		return bigquery.ScalarQueryParameter(key, "FLOAT64", val)
	if isinstance(val, str):
		if _TS_RE.match(val):
			return bigquery.ScalarQueryParameter(key, "TIMESTAMP", val)
		if _DATE_RE.match(val):
			return bigquery.ScalarQueryParameter(key, "DATE", val)
	return bigquery.ScalarQueryParameter(key, "STRING", str(val))


def _env_int(name: str, default: int) -> int:
	try:
		return int((os.environ.get(name) or str(default)).strip())
	except Exception:
		return default


def run_sql_text(sql: str, params: Dict[str, Any]) -> Tuple["pandas.DataFrame", int]:
	import pandas as pd

	if not _SAFE_READ_SQL.match(sql or ""):
		raise ValueError("Only read-only queries starting with SELECT or WITH are permitted.")

	timeout_sec = _env_int("BQ_QUERY_TIMEOUT_SEC", 60)
	retries = _env_int("BQ_QUERY_RETRIES", 3)
	max_bytes = _env_int("BQ_MAX_BYTES_BILLED", 5_000_000_000)

	cfg = bigquery.QueryJobConfig(
		query_parameters=[_bq_param(k, v) for k, v in (params or {}).items()],
		maximum_bytes_billed=max_bytes,
	)

	last_err: Optional[Exception] = None
	for attempt in range(1, retries + 1):
		try:
			c = client()
			job = c.query(sql, job_config=cfg)
			it = job.result(timeout=timeout_sec)
			df = it.to_dataframe(create_bqstorage_client=False)
			return df, int(job.total_bytes_processed or 0)

		except (gexc.DeadlineExceeded, gexc.ServiceUnavailable, gexc.TooManyRequests, gexc.InternalServerError, gexc.BadGateway) as e:
			last_err = e
			if attempt >= retries:
				raise
			sleep_s = min(2 ** attempt, 10)
			time.sleep(sleep_s)

		except Exception as e:
			last_err = e
			raise

	raise last_err if last_err else RuntimeError("BigQuery query failed for unknown reasons.")
