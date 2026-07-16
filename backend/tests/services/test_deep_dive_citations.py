"""Deep dive should expose only sources actually cited in the overview."""

from types import SimpleNamespace

from app.core.web_search import _parse_openai_responses_output
from app.services.deep_dive import (
    DeepDiveSource,
    build_cited_overview,
    filter_sources_to_cited,
)


def test_build_cited_overview_maps_spans_to_sentences_and_dedupes():
    text = (
        "Agency X regulates permits for hydropower. "
        "Applicants must file Form 12 before construction. "
        "Regional offices publish the current checklist."
    )
    citations = [
        {
            "url": "https://example.gov/permits",
            "title": "Permit Guide",
            "start_index": 0,
        },
        {
            "url": "https://example.gov/form-12",
            "title": "Form 12",
            "start_index": text.index("Applicants"),
        },
        {
            "url": "https://example.gov/permits",
            "title": "Permit Guide",
            "start_index": text.index("Regional"),
        },
    ]

    result = build_cited_overview(text, citations)

    assert len(result["sources"]) == 2
    assert result["sources"][0].url == "https://example.gov/permits"
    assert result["sources"][1].url == "https://example.gov/form-12"
    assert result["summary_items"][0]["source_indices"] == [1]
    assert result["summary_items"][1]["source_indices"] == [2]
    assert result["summary_items"][2]["source_indices"] == [1]


def test_build_cited_overview_attaches_unmapped_annotation_to_first_sentence():
    text = "This overview has no embedded links."
    citations = [
        {"url": "https://cited.example/page", "title": "Cited"},
    ]
    # Provider annotation without a recoverable span still counts as cited.
    result = build_cited_overview(text, citations)
    assert len(result["sources"]) == 1
    assert result["summary_items"][0]["source_indices"] == [1]


def test_build_cited_overview_falls_back_to_url_in_sentence():
    text = (
        "See the EPA checklist at https://epa.example/check. "
        "Then submit the regional packet."
    )
    citations = [
        {"url": "https://epa.example/check", "title": "EPA Checklist"},
    ]
    result = build_cited_overview(text, citations)
    assert result["summary_items"][0]["source_indices"] == [1]
    assert result["summary_items"][1]["source_indices"] == []


def test_filter_sources_to_cited_drops_uncited_and_renumbers():
    sources = [
        DeepDiveSource(title="A", url="https://a.example", source_type="web"),
        DeepDiveSource(title="B", url="https://b.example", source_type="web"),
        DeepDiveSource(title="C", url="https://c.example", source_type="web"),
    ]
    summary_citations = [[1, 3], [], [3]]

    filtered, renumbered = filter_sources_to_cited(sources, summary_citations)

    assert [s.url for s in filtered] == ["https://a.example", "https://c.example"]
    assert renumbered == [[1, 2], [], [2]]


def test_filter_sources_to_cited_empty_when_nothing_cited():
    sources = [
        DeepDiveSource(title="A", url="https://a.example", source_type="web"),
    ]
    filtered, renumbered = filter_sources_to_cited(sources, [[], []])
    assert filtered == []
    assert renumbered == [[], []]


def test_parse_openai_responses_keeps_spans_and_duplicate_urls():
    resp = SimpleNamespace(
        output=[
            SimpleNamespace(
                type="message",
                content=[
                    SimpleNamespace(
                        text="First sentence. Second sentence.",
                        annotations=[
                            SimpleNamespace(
                                type="url_citation",
                                url="https://a.example",
                                title="A",
                                start_index=0,
                                end_index=5,
                            ),
                            SimpleNamespace(
                                type="url_citation",
                                url="https://a.example",
                                title="A",
                                start_index=16,
                                end_index=22,
                            ),
                            SimpleNamespace(
                                type="url_citation",
                                url="https://b.example",
                                title="B",
                                start_index=16,
                                end_index=22,
                            ),
                        ],
                    )
                ],
            )
        ]
    )

    text, citations = _parse_openai_responses_output(resp)
    assert text == "First sentence. Second sentence."
    assert len(citations) == 3
    assert citations[0]["start_index"] == 0
    assert citations[1]["url"] == "https://a.example"
    assert citations[1]["start_index"] == 16
    assert citations[2]["url"] == "https://b.example"
