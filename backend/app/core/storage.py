import uuid
import aiofiles
from pathlib import Path
from abc import ABC, abstractmethod

from app.config import get_settings

settings = get_settings()


class StorageBackend(ABC):
    @abstractmethod
    async def save(self, content: bytes, filename: str, folder: str = "") -> str:
        """Save content and return the storage path"""
        pass

    @abstractmethod
    async def load(self, path: str) -> bytes:
        """Load content from storage path"""
        pass

    @abstractmethod
    async def delete(self, path: str) -> bool:
        """Delete content at path"""
        pass

    @abstractmethod
    def get_url(self, path: str) -> str:
        """Get URL/path for accessing the file"""
        pass


class LocalStorage(StorageBackend):
    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    async def save(self, content: bytes, filename: str, folder: str = "") -> str:
        ext = Path(filename).suffix
        unique_name = f"{uuid.uuid4()}{ext}"

        folder_path = self.base_dir / folder if folder else self.base_dir
        folder_path.mkdir(parents=True, exist_ok=True)

        file_path = folder_path / unique_name
        async with aiofiles.open(file_path, 'wb') as f:
            await f.write(content)

        return str(file_path.relative_to(self.base_dir))

    async def load(self, path: str) -> bytes:
        file_path = self.base_dir / path
        async with aiofiles.open(file_path, 'rb') as f:
            return await f.read()

    async def delete(self, path: str) -> bool:
        file_path = self.base_dir / path
        try:
            file_path.unlink()
            return True
        except FileNotFoundError:
            return False

    def get_url(self, path: str) -> str:
        return f"/files/{path}"


class FirebaseStorage(StorageBackend):
    """Firebase Storage backend (backed by GCS) — uses the existing firebase-admin SDK.

    Files are stored privately in your Firebase project's Storage bucket.
    The backend is the only accessor; users never get direct bucket URLs.
    Per-user access control is enforced at the API layer (require_project_viewer).
    """

    def __init__(self, bucket_name: str):
        self.bucket_name = bucket_name

    def _get_bucket(self):
        import firebase_admin
        from firebase_admin import storage as fb_storage

        try:
            firebase_admin.get_app()
        except ValueError:
            # Firebase not yet initialised — delegate to the auth assessment's initialiser
            # so credentials are shared and we avoid double-init.
            from app.core.auth import _init_firebase  # noqa: E402
            _init_firebase()

        return fb_storage.bucket(name=self.bucket_name)

    async def save(self, content: bytes, filename: str, folder: str = "") -> str:
        import asyncio

        ext = Path(filename).suffix
        unique_name = f"{uuid.uuid4()}{ext}"
        blob_path = f"{folder}/{unique_name}" if folder else unique_name

        bucket = self._get_bucket()
        blob = bucket.blob(blob_path)
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, blob.upload_from_string, content)
        return blob_path

    async def load(self, path: str) -> bytes:
        import asyncio

        bucket = self._get_bucket()
        blob = bucket.blob(path)
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, blob.download_as_bytes)

    async def delete(self, path: str) -> bool:
        import asyncio

        bucket = self._get_bucket()
        blob = bucket.blob(path)
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, blob.delete)
            return True
        except Exception:
            return False

    def get_url(self, path: str) -> str:
        return f"https://storage.googleapis.com/{self.bucket_name}/{path}"


def get_storage() -> StorageBackend:
    """Get configured storage backend for exports."""
    return LocalStorage(settings.exports_dir)


def get_uploads_storage() -> StorageBackend:
    """Get configured storage backend for user-uploaded files."""
    if settings.storage_type == "firebase" and settings.firebase_storage_bucket:
        return FirebaseStorage(settings.firebase_storage_bucket)
    return LocalStorage(settings.uploads_dir)


def _firebase_uploads_storage() -> FirebaseStorage | None:
    if settings.firebase_storage_bucket:
        return FirebaseStorage(settings.firebase_storage_bucket)
    return None


async def load_upload(path: str) -> bytes:
    """Load a user upload from the configured backend.

    When running with local storage, fall back to Firebase if the file is
    missing on disk. This supports the common dev setup of a shared Neon DB
    whose uploads were stored in Firebase by cloud/preview environments.
    """
    primary = get_uploads_storage()
    try:
        return await primary.load(path)
    except Exception as primary_error:
        if settings.storage_type != "local":
            raise primary_error

        fallback = _firebase_uploads_storage()
        if fallback is None:
            raise primary_error

        try:
            return await fallback.load(path)
        except Exception:
            raise primary_error from None
