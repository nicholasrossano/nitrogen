from app.services.pdf_structured import _pages_from_document, _render_element


def test_pages_grouped_by_page_number_in_reading_order():
    doc = {
        "kids": [
            {"type": "heading", "heading level": 1, "page number": 1, "content": "Intro"},
            {"type": "paragraph", "page number": 1, "content": "First body."},
            {"type": "paragraph", "page number": 2, "content": "Second page body."},
        ]
    }

    pages = _pages_from_document(doc)

    assert pages == [
        ("# Intro\n\nFirst body.", 1),
        ("Second page body.", 2),
    ]


def test_table_rendered_as_markdown_with_header_separator():
    table = {
        "type": "table",
        "page number": 3,
        "rows": [
            {
                "type": "table row",
                "cells": [
                    {"kids": [{"type": "paragraph", "content": "Year"}]},
                    {"kids": [{"type": "paragraph", "content": "Revenue"}]},
                ],
            },
            {
                "type": "table row",
                "cells": [
                    {"kids": [{"type": "paragraph", "content": "2025"}]},
                    {"kids": [{"type": "paragraph", "content": "$1M"}]},
                ],
            },
        ],
    }

    rendered = _render_element(table)

    assert rendered == "| Year | Revenue |\n| --- | --- |\n| 2025 | $1M |"


def test_list_rendered_with_markers_and_nested_content():
    ordered = {
        "type": "list",
        "numbering style": "ordered",
        "list items": [
            {"type": "list item", "content": "First"},
            {"type": "list item", "content": "Second"},
        ],
    }
    bullet = {
        "type": "list",
        "numbering style": "bullet",
        "list items": [{"type": "list item", "content": "Point"}],
    }

    assert _render_element(ordered) == "1. First\n2. Second"
    assert _render_element(bullet) == "- Point"


def test_cell_pipes_escaped_to_preserve_table_layout():
    table = {
        "type": "table",
        "rows": [
            {
                "type": "table row",
                "cells": [{"kids": [{"type": "paragraph", "content": "a|b"}]}],
            }
        ],
    }

    assert _render_element(table) == "| a\\|b |\n| --- |"


def test_unknown_wrapper_type_recurses_into_kids():
    wrapper = {
        "type": "text block",
        "page number": 1,
        "kids": [
            {"type": "paragraph", "content": "Wrapped text."},
        ],
    }

    assert _render_element(wrapper) == "Wrapped text."
