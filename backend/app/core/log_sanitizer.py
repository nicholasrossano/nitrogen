import re

# Common sensitive tokens/secrets that may appear in exception strings.
_SENSITIVE_PATTERNS = [
    re.compile(r"(?i)(authorization\s*:\s*bearer\s+)[^\s,;]+"),
    re.compile(r"(?i)(bearer\s+)[^\s,;]+"),
    re.compile(r"(?i)(api[_-]?key\s*[=:]\s*)[^\s,;]+"),
    re.compile(r"(?i)(client[_-]?secret\s*[=:]\s*)[^\s,;]+"),
    re.compile(r"(?i)(refresh[_-]?token\s*[=:]\s*)[^\s,;]+"),
    re.compile(r"(?i)(access[_-]?token\s*[=:]\s*)[^\s,;]+"),
    re.compile(r"(sk-[A-Za-z0-9_-]{16,})"),
    re.compile(r"(AIza[0-9A-Za-z\-_]{20,})"),
]


def sanitize_text(raw: str) -> str:
    """Best-effort redaction for sensitive values embedded in log strings."""
    text = raw
    for pattern in _SENSITIVE_PATTERNS:
        text = pattern.sub(r"\1[REDACTED]", text)
    return text


def sanitize_exception(exc: Exception) -> str:
    """Return a scrubbed exception string safe for logs/client error payloads."""
    return sanitize_text(str(exc))
