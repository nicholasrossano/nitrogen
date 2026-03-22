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
        # Generate unique filename
        ext = Path(filename).suffix
        unique_name = f"{uuid.uuid4()}{ext}"
        
        # Create folder if needed
        folder_path = self.base_dir / folder if folder else self.base_dir
        folder_path.mkdir(parents=True, exist_ok=True)
        
        # Save file
        file_path = folder_path / unique_name
        async with aiofiles.open(file_path, 'wb') as f:
            await f.write(content)
        
        # Return relative path
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


class GCSStorage(StorageBackend):
    """Google Cloud Storage backend - placeholder for production"""
    
    def __init__(self, bucket_name: str):
        self.bucket_name = bucket_name
        # In production:
        # from google.cloud import storage
        # self.client = storage.Client()
        # self.bucket = self.client.bucket(bucket_name)
    
    async def save(self, content: bytes, filename: str, folder: str = "") -> str:
        raise NotImplementedError("GCS storage not implemented for MVP")
    
    async def load(self, path: str) -> bytes:
        raise NotImplementedError("GCS storage not implemented for MVP")
    
    async def delete(self, path: str) -> bool:
        raise NotImplementedError("GCS storage not implemented for MVP")
    
    def get_url(self, path: str) -> str:
        # Return signed URL in production
        return f"https://storage.googleapis.com/{self.bucket_name}/{path}"


def get_storage() -> StorageBackend:
    """Get configured storage backend"""
    if settings.storage_type == "gcs":
        return GCSStorage(settings.gcs_bucket)
    return LocalStorage(settings.exports_dir)


def get_uploads_storage() -> StorageBackend:
    """Get storage backend for uploads"""
    return LocalStorage(settings.uploads_dir)
