"""Encrypt sensitive fields at rest using the platform Fernet key."""

from app.config import get_settings


def encryption_configured() -> bool:
    return bool(get_settings().api_key_encryption_key)


def encrypt_field(plaintext: str) -> str:
    if not plaintext:
        return plaintext
    settings = get_settings()
    if not settings.api_key_encryption_key:
        raise RuntimeError("API_KEY_ENCRYPTION_KEY is not configured")
    from cryptography.fernet import Fernet

    return Fernet(settings.api_key_encryption_key.encode()).encrypt(plaintext.encode()).decode()


def decrypt_field(ciphertext: str) -> str:
    if not ciphertext:
        return ciphertext
    settings = get_settings()
    if not settings.api_key_encryption_key:
        return ciphertext
    from cryptography.fernet import Fernet

    f = Fernet(settings.api_key_encryption_key.encode())
    try:
        return f.decrypt(ciphertext.encode()).decode()
    except Exception:
        # Legacy plaintext rows before encryption migration.
        return ciphertext
