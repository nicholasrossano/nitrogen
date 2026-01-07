import os
import json
import base64
from typing import Any, Dict, Optional

from google.cloud import firestore
from google.oauth2 import service_account


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

	raise RuntimeError("Missing project id. Set BQ_PROJECT (preferred) or provide service account creds.")


def client() -> firestore.Client:
	raw = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
	info = _load_service_account_info(raw) if raw else None

	if info:
		creds = service_account.Credentials.from_service_account_info(info)
		return firestore.Client(project=_project_id(), credentials=creds)

	path = (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
	if path and os.path.exists(path):
		creds = service_account.Credentials.from_service_account_file(path)
		return firestore.Client(project=_project_id(), credentials=creds)

	return firestore.Client(project=_project_id())
