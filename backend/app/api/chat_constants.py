"""Shared chat-route constants."""

SKIP_EXTRACTION_MESSAGES = {
    "I've uploaded my documents.",
    "I don't have any documents to upload.",
}

INITIAL_ONBOARDING_DOCUMENT_PROMPT = (
    "Please upload any relevant project materials, such as feasibility studies, "
    "site assessments, or permit applications."
)

# Minimum word count for a message to plausibly contain real, describable project
# details. Below this, there is nothing concrete to extract.
_MIN_EXTRACTION_WORDS = 4


def is_low_signal_extraction_message(content: str) -> bool:
    """True when a message is unlikely to contain real project details and should
    NOT be sent to project-field extraction (project_description/geography/
    project_type/technology).

    Root cause of a real incident: extraction ran on messages like "What's this
    project about?" (a question, not a description) and the model — instructed to
    extract fields when it can "directly infer" them — fabricated an entire
    unrelated project description (wrong technology, wrong country) instead of
    returning nothing. That invented text was then persisted to the project row
    and echoed back as fact in every later chat turn. Skip extraction for
    questions and other content-free messages so there is nothing for the model
    to over-infer from.
    """
    stripped = (content or "").strip()
    if not stripped:
        return True
    if stripped.endswith("?"):
        return True
    if len(stripped.split()) < _MIN_EXTRACTION_WORDS:
        return True
    return False
