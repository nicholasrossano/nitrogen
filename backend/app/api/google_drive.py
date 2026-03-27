import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core import google_oauth
from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.permissions import require_editor, require_viewer
from app.core.storage import get_uploads_storage
from app.models.evidence import EvidenceDoc, EvidenceChunk
from app.models.google_drive import DriveLinkedFile, UserGoogleConnection
from app.services.evidence_processing import (
    delete_evidence_doc_chunks,
    parse_file_to_chunks,
    store_evidence_doc,
)
from app.services.google_drive import GoogleDriveService
from app.services.document_parser import DocumentParserService
from app.services.embeddings import EmbeddingsService

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()

_EXT_MAP = {"pdf": ".pdf", "docx": ".docx", "xlsx": ".xlsx", "text": ".txt"}


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _get_connection(
    db: AsyncSession, user_id: str
) -> UserGoogleConnection | None:
    result = await db.execute(
        select(UserGoogleConnection).where(UserGoogleConnection.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def _get_valid_access_token(
    db: AsyncSession, connection: UserGoogleConnection
) -> str:
    """Return a valid access token, refreshing if expired or close to expiry."""
    now = datetime.now(timezone.utc)
    buffer = timedelta(minutes=5)

    if (
        connection.access_token
        and connection.token_expiry
        and connection.token_expiry > now + buffer
    ):
        return connection.access_token

    token_data = await google_oauth.refresh_access_token(connection.refresh_token)
    connection.access_token = token_data["access_token"]
    connection.token_expiry = now + timedelta(seconds=token_data.get("expires_in", 3600))
    connection.updated_at = now
    await db.commit()
    await db.refresh(connection)
    return connection.access_token


# ── OAuth flow ────────────────────────────────────────────────────────────────

class ConnectRequest(BaseModel):
    initiative_id: str


@router.post("/google/connect")
async def start_google_connect(
    body: ConnectRequest,
    user: AuthUser = Depends(get_current_user),
):
    """Return the Google OAuth consent URL for the authenticated user."""
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Drive integration is not configured",
        )
    state = google_oauth.create_oauth_state(user.uid, body.initiative_id)
    return {"auth_url": google_oauth.build_auth_url(state)}


@router.get("/google/callback")
async def google_oauth_callback(
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Google OAuth callback — not called by the frontend directly.
    Exchanges the code for tokens, stores them, and redirects back to the app.
    """
    frontend_url = settings.frontend_url

    if error or not code or not state:
        return RedirectResponse(url=f"{frontend_url}?drive_error=access_denied")

    try:
        user_id, initiative_id = google_oauth.verify_oauth_state(state)
    except ValueError:
        return RedirectResponse(url=f"{frontend_url}?drive_error=invalid_state")

    try:
        token_data = await google_oauth.exchange_code(code)
    except Exception as e:
        logger.error(f"Google OAuth token exchange failed: {e}")
        return RedirectResponse(url=f"{frontend_url}?drive_error=token_exchange_failed")

    refresh_token = token_data.get("refresh_token", "")
    if not refresh_token:
        return RedirectResponse(url=f"{frontend_url}?drive_error=no_refresh_token")

    now = datetime.now(timezone.utc)
    access_token = token_data.get("access_token", "")
    expires_in = token_data.get("expires_in", 3600)
    token_expiry = now + timedelta(seconds=expires_in)

    google_email = await google_oauth.get_google_email(access_token)

    existing = await _get_connection(db, user_id)
    if existing:
        existing.refresh_token = refresh_token
        existing.access_token = access_token
        existing.token_expiry = token_expiry
        existing.google_email = google_email
        existing.updated_at = now
    else:
        db.add(
            UserGoogleConnection(
                user_id=user_id,
                refresh_token=refresh_token,
                access_token=access_token,
                token_expiry=token_expiry,
                google_email=google_email,
            )
        )

    await db.commit()
    return RedirectResponse(
        url=f"{frontend_url}/initiatives/{initiative_id}?drive_connected=true"
    )


@router.get("/google/status")
async def get_drive_status(
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return whether the current user has an active Google Drive connection."""
    connection = await _get_connection(db, user.uid)
    if not connection:
        return {"connected": False, "email": None}
    return {"connected": True, "email": connection.google_email}


@router.get("/google/access-token")
async def get_drive_access_token(
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return a fresh access token for the Google Picker (short-lived, frontend use)."""
    connection = await _get_connection(db, user.uid)
    if not connection:
        raise HTTPException(status_code=404, detail="Google Drive not connected")
    try:
        access_token = await _get_valid_access_token(db, connection)
    except Exception as e:
        logger.error(f"Failed to refresh Google token for user {user.uid}: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Failed to refresh Google token. Please reconnect Google Drive.",
        )
    return {"access_token": access_token}


@router.delete("/google/disconnect")
async def disconnect_google_drive(
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Revoke tokens and remove the Google Drive connection for the current user."""
    connection = await _get_connection(db, user.uid)
    if not connection:
        raise HTTPException(status_code=404, detail="No Google Drive connection found")
    try:
        await google_oauth.revoke_token(connection.refresh_token)
    except Exception:
        pass
    await db.delete(connection)
    await db.commit()
    return {"success": True}


# ── Import ────────────────────────────────────────────────────────────────────

class DriveImportRequest(BaseModel):
    file_ids: list[str]


@router.post("/initiatives/{initiative_id}/drive/import")
async def import_from_drive(
    initiative_id: UUID,
    body: DriveImportRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Import selected Drive files into project evidence."""
    if not body.file_ids:
        raise HTTPException(status_code=400, detail="No file IDs provided")
    if len(body.file_ids) > 20:
        raise HTTPException(status_code=400, detail="Cannot import more than 20 files at once")

    initiative = await require_editor(db, initiative_id, user)

    connection = await _get_connection(db, user.uid)
    if not connection:
        raise HTTPException(status_code=400, detail="Google Drive not connected")

    access_token = await _get_valid_access_token(db, connection)
    drive = GoogleDriveService(access_token)
    storage = get_uploads_storage()

    imported = []
    errors = []

    # Expand any folder IDs into their direct file children
    expanded_file_metas: list[dict] = []
    for file_id in body.file_ids:
        meta = await drive.get_file_metadata(file_id)
        if meta.get("mimeType") == "application/vnd.google-apps.folder":
            children = await drive.list_folder_files(file_id)
            expanded_file_metas.extend(children)
        else:
            expanded_file_metas.append(meta)

    if len(expanded_file_metas) > 50:
        raise HTTPException(status_code=400, detail="Folder contains too many files (max 50 at once)")

    for meta in expanded_file_metas:
        file_id = meta.get("id", "")
        try:
            mime_type = meta.get("mimeType", "")
            filename = meta.get("name", "unknown")
            modified_str = meta.get("modifiedTime", "")

            if not drive.is_supported(mime_type):
                errors.append({"file_id": file_id, "error": f"Unsupported type: {mime_type}"})
                continue

            # Skip files already linked to this initiative
            existing = await db.execute(
                select(DriveLinkedFile).where(
                    DriveLinkedFile.drive_file_id == file_id,
                    DriveLinkedFile.initiative_id == initiative_id,
                )
            )
            if existing.scalar_one_or_none():
                errors.append({"file_id": file_id, "error": "Already imported"})
                continue

            file_bytes = await drive.download_file(file_id, mime_type)

            if len(file_bytes) > 50 * 1024 * 1024:
                errors.append({"file_id": file_id, "error": "File exceeds 50 MB limit"})
                continue

            file_type = drive.get_file_type(mime_type)
            ext = _EXT_MAP.get(file_type or "", "")
            storage_filename = filename if "." in filename else f"{filename}{ext}"
            storage_path = await storage.save(
                file_bytes, storage_filename, folder=str(initiative_id)
            )

            evidence_doc, chunk_count = await store_evidence_doc(
                db=db,
                initiative=initiative,
                file_bytes=file_bytes,
                filename=filename,
                file_type=file_type,
                storage_path=storage_path,
                file_size=len(file_bytes),
            )

            modified_time = (
                drive.parse_modified_time(modified_str)
                if modified_str
                else datetime.now(timezone.utc)
            )
            link = DriveLinkedFile(
                initiative_id=initiative_id,
                evidence_doc_id=evidence_doc.id,
                user_id=user.uid,
                drive_file_id=file_id,
                drive_file_name=filename,
                drive_mime_type=mime_type,
                drive_modified_time=modified_time,
            )
            db.add(link)
            await db.commit()
            await db.refresh(link)

            imported.append(
                {
                    "id": str(evidence_doc.id),
                    "filename": evidence_doc.filename,
                    "file_type": evidence_doc.file_type,
                    "file_size": evidence_doc.file_size,
                    "created_at": (
                        evidence_doc.created_at.isoformat()
                        if evidence_doc.created_at
                        else None
                    ),
                    "source": "evidence",
                    "drive_link_id": str(link.id),
                    "chunk_count": chunk_count,
                }
            )
        except Exception as e:
            logger.error(f"Drive import failed for file {file_id}: {e}")
            errors.append({"file_id": file_id, "error": str(e)})

    return {"imported": imported, "errors": errors}


# ── Linked files ──────────────────────────────────────────────────────────────

@router.get("/initiatives/{initiative_id}/drive/linked")
async def list_drive_linked_files(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List all Drive-linked files for an initiative."""
    await require_viewer(db, initiative_id, user)
    result = await db.execute(
        select(DriveLinkedFile).where(DriveLinkedFile.initiative_id == initiative_id)
    )
    links = result.scalars().all()
    return [
        {
            "id": str(lnk.id),
            "evidence_doc_id": str(lnk.evidence_doc_id) if lnk.evidence_doc_id else None,
            "drive_file_id": lnk.drive_file_id,
            "drive_file_name": lnk.drive_file_name,
            "drive_mime_type": lnk.drive_mime_type,
            "drive_modified_time": lnk.drive_modified_time.isoformat(),
            "last_synced_at": lnk.last_synced_at.isoformat(),
        }
        for lnk in links
    ]


@router.delete("/initiatives/{initiative_id}/drive/linked/{linked_id}")
async def unlink_drive_file(
    initiative_id: UUID,
    linked_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Remove the Drive link record (keeps the underlying evidence doc)."""
    await require_editor(db, initiative_id, user)
    result = await db.execute(
        select(DriveLinkedFile).where(
            DriveLinkedFile.id == linked_id,
            DriveLinkedFile.initiative_id == initiative_id,
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Drive link not found")
    await db.delete(link)
    await db.commit()
    return {"success": True}


# ── Sync ──────────────────────────────────────────────────────────────────────

@router.post("/initiatives/{initiative_id}/drive/sync")
async def sync_drive_files(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """
    Check all Drive-linked files in this initiative for remote changes.
    Re-downloads and re-indexes any files whose modifiedTime has advanced.
    """
    initiative = await require_editor(db, initiative_id, user)

    connection = await _get_connection(db, user.uid)
    if not connection:
        raise HTTPException(status_code=400, detail="Google Drive not connected")

    access_token = await _get_valid_access_token(db, connection)
    drive = GoogleDriveService(access_token)
    storage = get_uploads_storage()

    result = await db.execute(
        select(DriveLinkedFile).where(
            DriveLinkedFile.initiative_id == initiative_id,
            DriveLinkedFile.user_id == user.uid,
        )
    )
    links = result.scalars().all()

    updated = 0
    errors = []

    for link in links:
        try:
            meta = await drive.get_file_metadata(link.drive_file_id)
            modified_str = meta.get("modifiedTime", "")
            if not modified_str:
                continue

            remote_modified = drive.parse_modified_time(modified_str)
            stored_modified = link.drive_modified_time
            if stored_modified.tzinfo is None:
                stored_modified = stored_modified.replace(tzinfo=timezone.utc)

            if remote_modified <= stored_modified:
                continue

            # File has changed — re-download and re-index
            mime_type = link.drive_mime_type
            file_bytes = await drive.download_file(link.drive_file_id, mime_type)

            if len(file_bytes) > 50 * 1024 * 1024:
                errors.append({"file_id": link.drive_file_id, "error": "File exceeds 50 MB limit"})
                continue

            file_type = drive.get_file_type(mime_type)

            if link.evidence_doc_id:
                await delete_evidence_doc_chunks(db, link.evidence_doc_id)

                doc_result = await db.execute(
                    select(EvidenceDoc).where(EvidenceDoc.id == link.evidence_doc_id)
                )
                doc = doc_result.scalar_one_or_none()

                if doc:
                    # Replace stored file
                    if doc.storage_path:
                        try:
                            await storage.delete(doc.storage_path)
                        except Exception:
                            pass
                    ext = _EXT_MAP.get(file_type or "", "")
                    storage_filename = (
                        link.drive_file_name
                        if "." in link.drive_file_name
                        else f"{link.drive_file_name}{ext}"
                    )
                    new_storage_path = await storage.save(
                        file_bytes, storage_filename, folder=str(initiative_id)
                    )
                    doc.storage_path = new_storage_path
                    doc.file_size = len(file_bytes)
                    await db.commit()
                    await db.refresh(doc)

                    # Re-embed
                    parser = DocumentParserService()
                    embeddings_service = EmbeddingsService(user_id=user.uid, db=db)
                    chunk_tuples = parse_file_to_chunks(parser, file_bytes, file_type)
                    plain_texts = [t[0] for t in chunk_tuples]
                    embeddings = await embeddings_service.embed_texts(plain_texts)

                    for i, ((plain, html_content, page_num), embedding) in enumerate(
                        zip(chunk_tuples, embeddings)
                    ):
                        db.add(
                            EvidenceChunk(
                                evidence_doc_id=doc.id,
                                chunk_index=i,
                                content=plain,
                                content_html=html_content,
                                page_number=page_num,
                                embedding=embedding,
                            )
                        )

                    initiative.touch()
                    await db.commit()

            link.drive_modified_time = remote_modified
            link.last_synced_at = datetime.now(timezone.utc)
            await db.commit()
            updated += 1

        except Exception as e:
            logger.error(f"Drive sync failed for file {link.drive_file_id}: {e}")
            errors.append({"file_id": link.drive_file_id, "error": str(e)})

    return {"checked": len(links), "updated": updated, "errors": errors}
