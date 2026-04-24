from datetime import datetime
from typing import Optional

import httpx

DRIVE_BASE_URL = "https://www.googleapis.com/drive/v3"

# Maps Drive MIME types to our internal file_type strings
DRIVE_MIME_TO_FILE_TYPE: dict[str, str] = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xlsx",
    "text/plain": "text",
    "text/csv": "text",
    "application/rtf": "text",
    # Google native types — exported on download
    "application/vnd.google-apps.document": "docx",
    "application/vnd.google-apps.spreadsheet": "xlsx",
}

# Google native files must be exported rather than downloaded directly
GOOGLE_NATIVE_EXPORT_MIME: dict[str, str] = {
    "application/vnd.google-apps.document": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ),
}

# Comma-separated list for the Google Picker MIME type filter
PICKER_SUPPORTED_MIMES = ",".join(DRIVE_MIME_TO_FILE_TYPE.keys())


class GoogleDriveService:
    def __init__(self, access_token: str):
        self._token = access_token
        self._headers = {"Authorization": f"Bearer {access_token}"}

    async def get_file_metadata(self, file_id: str) -> dict:
        """Fetch name, mimeType, modifiedTime, size for a single file."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{DRIVE_BASE_URL}/files/{file_id}",
                headers=self._headers,
                params={"fields": "id,name,mimeType,modifiedTime,size"},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_files_metadata(self, file_ids: list[str]) -> list[dict]:
        """Fetch metadata for multiple files sequentially."""
        results = []
        async with httpx.AsyncClient() as client:
            for file_id in file_ids:
                resp = await client.get(
                    f"{DRIVE_BASE_URL}/files/{file_id}",
                    headers=self._headers,
                    params={"fields": "id,name,mimeType,modifiedTime,size"},
                )
                if resp.status_code == 200:
                    results.append(resp.json())
        return results

    async def download_file(self, file_id: str, mime_type: str) -> bytes:
        """Download file bytes. Google-native types are exported to office formats."""
        async with httpx.AsyncClient(timeout=120.0) as client:
            if mime_type in GOOGLE_NATIVE_EXPORT_MIME:
                resp = await client.get(
                    f"{DRIVE_BASE_URL}/files/{file_id}/export",
                    headers=self._headers,
                    params={"mimeType": GOOGLE_NATIVE_EXPORT_MIME[mime_type]},
                )
            else:
                resp = await client.get(
                    f"{DRIVE_BASE_URL}/files/{file_id}",
                    headers=self._headers,
                    params={"alt": "media"},
                )
            resp.raise_for_status()
            return resp.content

    async def list_folder_files(self, folder_id: str) -> list[dict]:
        """Return metadata for all supported files directly inside a folder (non-recursive)."""
        supported = ", ".join(f"mimeType='{m}'" for m in DRIVE_MIME_TO_FILE_TYPE)
        query = f"'{folder_id}' in parents and trashed=false and ({supported})"
        results = []
        page_token = None
        async with httpx.AsyncClient() as client:
            while True:
                params: dict = {
                    "q": query,
                    "fields": "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
                    "pageSize": 100,
                }
                if page_token:
                    params["pageToken"] = page_token
                resp = await client.get(
                    f"{DRIVE_BASE_URL}/files",
                    headers=self._headers,
                    params=params,
                )
                resp.raise_for_status()
                data = resp.json()
                results.extend(data.get("files", []))
                page_token = data.get("nextPageToken")
                if not page_token:
                    break
        return results

    async def list_folder_files_recursive(self, folder_id: str, max_files: int = 200) -> list[dict]:
        """Return metadata for all supported files inside a folder, including nested folders."""
        queue: list[str] = [folder_id]
        visited: set[str] = set()
        results: list[dict] = []

        async with httpx.AsyncClient() as client:
            while queue:
                current_folder_id = queue.pop(0)
                if current_folder_id in visited:
                    continue
                visited.add(current_folder_id)

                page_token = None
                while True:
                    params: dict = {
                        "q": f"'{current_folder_id}' in parents and trashed=false",
                        "fields": "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
                        "pageSize": 100,
                    }
                    if page_token:
                        params["pageToken"] = page_token

                    resp = await client.get(
                        f"{DRIVE_BASE_URL}/files",
                        headers=self._headers,
                        params=params,
                    )
                    resp.raise_for_status()
                    data = resp.json()

                    for file_meta in data.get("files", []):
                        mime_type = file_meta.get("mimeType", "")
                        if mime_type == "application/vnd.google-apps.folder":
                            child_folder_id = file_meta.get("id")
                            if child_folder_id and child_folder_id not in visited:
                                queue.append(child_folder_id)
                            continue

                        if self.is_supported(mime_type):
                            results.append(file_meta)
                            if len(results) >= max_files:
                                return results

                    page_token = data.get("nextPageToken")
                    if not page_token:
                        break

        return results

    def get_file_type(self, mime_type: str) -> Optional[str]:
        return DRIVE_MIME_TO_FILE_TYPE.get(mime_type)

    def is_supported(self, mime_type: str) -> bool:
        return mime_type in DRIVE_MIME_TO_FILE_TYPE

    def parse_modified_time(self, time_str: str) -> datetime:
        """Parse Drive's RFC3339 modifiedTime string into a tz-aware datetime."""
        return datetime.fromisoformat(time_str.replace("Z", "+00:00"))
