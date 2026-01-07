import os
import json
import base64
from typing import Optional, List

from google.cloud import bigquery
from google.oauth2 import service_account


def _parse_credentials_json(raw: str) -> dict:
	raw = (raw or "").strip()
	if not raw:
		raise ValueError("Empty GOOGLE_APPLICATION_CREDENTIALS_JSON.")
	if raw.startswith("{"):
		return json.loads(raw)
	try:
		decoded = base64.b64decode(raw).decode("utf-8")
		return json.loads(decoded)
	except Exception as exc:
		raise ValueError("GOOGLE_APPLICATION_CREDENTIALS_JSON is neither JSON nor base64(JSON).") from exc


def _credentials() -> Optional[service_account.Credentials]:
	raw = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON", "").strip()
	if not raw:
		return None
	info = _parse_credentials_json(raw)
	return service_account.Credentials.from_service_account_info(info)


def _datasets() -> List[str]:
	raw = os.environ.get("BQ_DATASETS", "").strip()
	if not raw:
		return []
	return [x.strip() for x in raw.split(",") if x.strip()]


def main() -> None:
	project_id = os.environ.get("BQ_PROJECT", "").strip()
	if not project_id:
		raise RuntimeError("Missing BQ_PROJECT.")

	creds = _credentials()
	client = bigquery.Client(project=project_id, credentials=creds) if creds else bigquery.Client(project=project_id)

	print(f"BQ_PROJECT: {project_id}")
	print(f"BQ_DATASETS: {_datasets() or ['<none>']}")
	if creds:
		email = getattr(creds, "service_account_email", None)
		print(f"Auth: service_account ({email or '<unknown_email>'})")
	else:
		print("Auth: ADC (GOOGLE_APPLICATION_CREDENTIALS file / metadata)")

	job = client.query("SELECT 1 AS ok")
	rows = list(job.result())
	print(f"SELECT 1 => ok={rows[0]['ok']} (bytes_processed={job.total_bytes_processed or 0})")

	if "analytics" in _datasets() or (not _datasets() and True):
		sql = f"""
		SELECT table_name, table_type
		FROM `{project_id}.analytics.INFORMATION_SCHEMA.TABLES`
		ORDER BY table_name
		"""
		job2 = client.query(sql)
		tables = list(job2.result())
		print(f"analytics tables/views: {len(tables)}")
		for row in tables[:25]:
			print(f" - {row['table_name']} ({row['table_type']})")
		if len(tables) > 25:
			print(f" ... (+{len(tables) - 25} more)")


if __name__ == "__main__":
	main()
