"""Export-handler catalog for shipped deliverable types."""

from __future__ import annotations

from typing import Any


def build_export_handlers(handlers: dict[str, Any]) -> dict[str, Any]:
    """Map persisted output types to their export handlers.

    Handler implementations still live beside the API route for now to avoid a
    broad move; this file owns the first-party output-type catalog.
    """
    return {
        "memo": handlers["memo"],
        "lcoe": handlers["lcoe"],
        "carbon": handlers["carbon"],
        "solar": handlers["solar"],
        "template": handlers["template"],
    }

