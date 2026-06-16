from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


class DocumentConversionError(RuntimeError):
    """Raised when an uploaded document cannot be converted safely."""


@dataclass(frozen=True)
class PreparedDocument:
    content: bytes
    filename: str
    file_type: str


_IWORK_TARGETS = {
    "pages": ("docx", ".docx"),
    "keynote": ("pptx", ".pptx"),
    "numbers": ("xlsx", ".xlsx"),
}


def prepare_uploaded_document(
    content: bytes,
    filename: str | None,
    file_type: str,
) -> PreparedDocument:
    """Convert editable iWork uploads to Office files before storage/parsing."""

    safe_filename = filename or "Untitled"
    target = _IWORK_TARGETS.get(file_type)
    if target is None:
        return PreparedDocument(content=content, filename=safe_filename, file_type=file_type)

    target_file_type, target_ext = target
    converted = _convert_with_libreoffice(content, safe_filename, target_ext)
    return PreparedDocument(
        content=converted,
        filename=_replace_extension(safe_filename, target_ext),
        file_type=target_file_type,
    )


def _convert_with_libreoffice(content: bytes, filename: str, target_ext: str) -> bytes:
    binary = shutil.which("soffice") or shutil.which("libreoffice")
    if not binary:
        raise DocumentConversionError(
            "This file type requires document conversion, but LibreOffice is not installed on the server."
        )

    source_name = _safe_local_filename(filename)
    with tempfile.TemporaryDirectory(prefix="nitrogen-doc-convert-") as tmp:
        tmp_path = Path(tmp)
        input_path = tmp_path / source_name
        output_dir = tmp_path / "out"
        output_dir.mkdir()
        input_path.write_bytes(content)

        result = subprocess.run(
            [
                binary,
                "--headless",
                "--convert-to",
                target_ext.lstrip("."),
                "--outdir",
                str(output_dir),
                str(input_path),
            ],
            capture_output=True,
            timeout=90,
            check=False,
        )

        converted_files = sorted(output_dir.glob(f"*{target_ext}"))
        if result.returncode != 0 or not converted_files:
            stderr = result.stderr.decode("utf-8", errors="replace").strip()
            stdout = result.stdout.decode("utf-8", errors="replace").strip()
            detail = stderr or stdout or "conversion produced no output"
            raise DocumentConversionError(f"Could not convert file to {target_ext}: {detail}")

        return converted_files[0].read_bytes()


def _replace_extension(filename: str, target_ext: str) -> str:
    dot_idx = filename.rfind(".")
    if dot_idx <= 0:
        return f"{filename}{target_ext}"
    return f"{filename[:dot_idx]}{target_ext}"


def _safe_local_filename(filename: str) -> str:
    safe = re.sub(r"[^\w .-]", "_", Path(filename).name).strip()
    return safe or "upload"
