"""Deep dive should expose only sources actually cited in the overview."""

from types import SimpleNamespace

from app.core.web_search import _parse_openai_responses_output
from app.services.deep_dive import (
    DeepDiveSource,
    build_cited_overview,
    filter_sources_to_cited,
    is_usable_deep_dive_cache,
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


def test_build_cited_overview_extracts_and_strips_markdown_links():
    """OpenAI web search often embeds ([domain](url)) without url_citation annotations."""
    text = (
        "The **Malawi Demographic and Health Survey (MDHS) Geospatial Data** is a "
        "publicly available dataset "
        "([dhsprogram.com](https://dhsprogram.com/data/dataset/Malawi_Standard-DHS_2015.cfm"
        "?flag=0&utm_source=openai)). "
        "It provides GPS cluster coordinates "
        "([spatialdata.dhsprogram.com](https://spatialdata.dhsprogram.com/methodology/"
        "?utm_source=openai)). "
        "The DHS Program’s Spatial Data Repository also hosts a Local Data Mapping Tool "
        "([spatialdata.dhsprogram.com](https://spatialdata.dhsprogram.com/local-data-mapping-tool/"
        "?utm_source=openai))."
    )

    result = build_cited_overview(text, citations=[])

    assert len(result["sources"]) == 3
    assert "dhsprogram.com/data/dataset" in (result["sources"][0].url or "")
    assert "methodology" in (result["sources"][1].url or "")
    assert "local-data-mapping-tool" in (result["sources"][2].url or "")
    assert result["summary_items"][0]["source_indices"] == [1]
    assert result["summary_items"][1]["source_indices"] == [2]
    assert result["summary_items"][2]["source_indices"] == [3]
    joined = " ".join(item["text"] for item in result["summary_items"])
    assert "](" not in joined
    assert "utm_source=openai" not in joined
    assert "Malawi Demographic and Health Survey" in joined


def test_build_cited_overview_merges_markdown_when_annotations_partial():
    text = (
        "Agency guidance is published online "
        "([example.gov](https://example.gov/guide)). "
        "A second checklist is also available "
        "([forms.example.gov](https://forms.example.gov/check))."
    )
    citations = [
        {
            "url": "https://example.gov/guide",
            "title": "Guide",
            "start_index": 0,
        }
    ]
    result = build_cited_overview(text, citations)
    assert len(result["sources"]) == 2
    assert result["summary_items"][0]["source_indices"] == [1]
    assert result["summary_items"][1]["source_indices"] == [2]
    assert "](" not in result["summary_items"][0]["text"]


def test_parse_openai_responses_accepts_dict_annotations():
    resp = {
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "text": "Cited sentence about permits.",
                        "annotations": [
                            {
                                "type": "url_citation",
                                "url": "https://dict.example/page",
                                "title": "Dict Source",
                                "start_index": 0,
                                "end_index": 5,
                            }
                        ],
                    }
                ],
            }
        ]
    }
    text, citations = _parse_openai_responses_output(resp)
    assert text == "Cited sentence about permits."
    assert len(citations) == 1
    assert citations[0]["url"] == "https://dict.example/page"
    assert citations[0]["start_index"] == 0


def test_parse_openai_responses_falls_back_to_markdown_links():
    resp = SimpleNamespace(
        output=[
            SimpleNamespace(
                type="message",
                content=[
                    SimpleNamespace(
                        text=(
                            "Overview sentence "
                            "([epa.gov](https://epa.gov/guide?utm_source=openai))."
                        ),
                        annotations=[],
                    )
                ],
            )
        ]
    )
    text, citations = _parse_openai_responses_output(resp)
    assert "epa.gov/guide" in text
    assert len(citations) == 1
    assert citations[0]["url"] == "https://epa.gov/guide?utm_source=openai"


def test_build_cited_overview_strips_conversational_lead_in():
    text = (
        "Here's a concise, authoritative overview of the 'Household Demand for Clean Cooking Fuels' "
        "landscape from reliable institutional sources: Ugandan households overwhelmingly rely on "
        "biomass for cooking."
    )
    result = build_cited_overview(text, citations=[])

    assert result["summary_items"]
    assert not result["summary_items"][0]["text"].lower().startswith("here's")
    assert result["summary_items"][0]["text"].startswith("Ugandan households")


def test_is_usable_deep_dive_cache_rejects_markdown_leaks():
    assert is_usable_deep_dive_cache(None) is False
    assert is_usable_deep_dive_cache({"what_this_is": ["ok"]}) is False
    assert is_usable_deep_dive_cache({
        "summary_citations": [[]],
        "what_this_is": ["See ([epa.gov](https://epa.gov/x))."],
    }) is False
    assert is_usable_deep_dive_cache({
        "summary_citations": [[1]],
        "what_this_is": ["Clean overview sentence."],
        "sources": [{"title": "EPA", "url": "https://epa.gov/x"}],
    }) is True


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
