"""Guards project-field extraction against content-free messages.

Regression coverage for an incident where extraction ran on a question
("What's this project about?") with no real project information, and the
model fabricated an entire unrelated project description instead of
returning nothing. See is_low_signal_extraction_message for details.
"""

import pytest

from app.api.chat_constants import is_low_signal_extraction_message


@pytest.mark.parametrize(
    "content",
    [
        "",
        "   ",
        "What's this project about?",
        "Can you tell me more?",
        "Thanks",
        "Sounds good",
        "Testing",
        "ok thanks",
    ],
)
def test_low_signal_messages_are_flagged(content: str) -> None:
    assert is_low_signal_extraction_message(content) is True


@pytest.mark.parametrize(
    "content",
    [
        "Electrification in Burkina Faso",
        "Solar minigrid rollout in rural Kenya",
        "A 20 MW wind farm project in coastal Ghana",
    ],
)
def test_descriptive_messages_are_not_flagged(content: str) -> None:
    assert is_low_signal_extraction_message(content) is False
