#!/usr/bin/env python3
"""
Local spike: test OpenAI web_search -> article card extraction.

Goal:
- Produce a strict, one-article-per-card JSON output.
- Each card has exactly one citation URL from OpenAI url_citation annotations.
- Optionally enrich missing headline/description/image from article metadata tags.

Usage examples:
  python3 scripts/test_openai_news_cards.py \
    --query "nigeria clean cooking regulation" \
    --query "gold standard carbon methodology updates" \
    --output /tmp/news_cards.json

  python3 scripts/test_openai_news_cards.py \
    --query "kenya mini-grid tariff policy" \
    --no-enrich-metadata
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse

import httpx
from openai import AsyncOpenAI


DEFAULT_MODEL = os.getenv("OPENAI_ORCHESTRATION_MODEL", "gpt-4o")
DEFAULT_CONTEXT_SIZE = "medium"
DEFAULT_MAX_CARDS_PER_QUERY = 12
DEFAULT_TIMEOUT_S = 12.0


@dataclass
class Citation:
    type: str
    url: str
    title: str | None
    start_index: int | None
    end_index: int | None
    excerpt: str | None
    response_id: str | None
    query: str


@dataclass
class ArticleCard:
    schema: str
    article_url: str
    headline: str
    summary: str
    image_url: str | None
    source_name: str
    published_at: str | None
    query: str
    provider: str
    citation: Citation
    extracted_at: str


class MetadataParser(HTMLParser):
    """Lightweight parser for title + Open Graph/Twitter metadata."""

    def __init__(self) -> None:
        super().__init__()
        self.in_title = False
        self.title_text = ""
        self.meta: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = {k.lower(): (v or "") for k, v in attrs}
        if tag.lower() == "title":
            self.in_title = True
            return
        if tag.lower() != "meta":
            return
        key = (attrs_map.get("property") or attrs_map.get("name") or "").lower()
        content = attrs_map.get("content", "").strip()
        if key and content:
            self.meta[key] = content

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_text += data


def _obj_get(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _clean_text(value: str, max_len: int) -> str:
    collapsed = re.sub(r"\s+", " ", value).strip()
    if len(collapsed) <= max_len:
        return collapsed
    return collapsed[: max_len - 1].rstrip() + "…"


def _normalize_url(raw_url: str) -> str:
    parsed = urlparse(raw_url)
    scheme = parsed.scheme.lower() or "https"
    netloc = parsed.netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    path = parsed.path or "/"
    return f"{scheme}://{netloc}{path}"


def _source_from_url(raw_url: str) -> str:
    netloc = urlparse(raw_url).netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    return netloc or "unknown-source"


def _excerpt_from_text(text: str, start: int | None, end: int | None, radius: int = 220) -> str | None:
    if not text:
        return None
    if start is None or end is None or start < 0 or end < 0 or start >= len(text):
        return _clean_text(text, 280)
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    snippet = text[left:right]
    return _clean_text(snippet, 320) if snippet else None


async def fetch_metadata(url: str, timeout_s: float) -> dict[str, str | None]:
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout_s,
            headers={"User-Agent": "NitrogenNewsCardSpike/1.0"},
        ) as client:
            response = await client.get(url)
            if response.status_code >= 400:
                return {"title": None, "description": None, "image": None, "published_at": None}
            parser = MetadataParser()
            parser.feed(response.text[:600_000])

            title = (
                parser.meta.get("og:title")
                or parser.meta.get("twitter:title")
                or parser.title_text.strip()
                or None
            )
            description = (
                parser.meta.get("og:description")
                or parser.meta.get("twitter:description")
                or parser.meta.get("description")
                or None
            )
            image = (
                parser.meta.get("og:image")
                or parser.meta.get("twitter:image")
                or None
            )
            published_at = (
                parser.meta.get("article:published_time")
                or parser.meta.get("og:article:published_time")
                or None
            )
            return {
                "title": _clean_text(title, 220) if title else None,
                "description": _clean_text(description, 360) if description else None,
                "image": image,
                "published_at": published_at,
            }
    except Exception:
        return {"title": None, "description": None, "image": None, "published_at": None}


async def run_query(
    client: AsyncOpenAI,
    model: str,
    query: str,
    search_context_size: str,
    max_cards: int,
    enrich_metadata: bool,
    timeout_s: float,
) -> list[ArticleCard]:
    prompt = (
        "Search for recent, high-relevance news about this topic:\n"
        f"{query}\n\n"
        "Write concise findings and ensure each sourced claim has a URL citation."
    )

    response = await client.responses.create(
        model=model,
        tools=[{"type": "web_search", "search_context_size": search_context_size}],
        input=prompt,
    )

    extracted_at = datetime.now(timezone.utc).isoformat()
    seen_urls: set[str] = set()
    cards: list[ArticleCard] = []

    for item in _obj_get(response, "output", []) or []:
        if _obj_get(item, "type") != "message":
            continue
        for block in _obj_get(item, "content", []) or []:
            text = _obj_get(block, "text", "") or ""
            annotations = _obj_get(block, "annotations", []) or []

            for ann in annotations:
                if _obj_get(ann, "type") != "url_citation":
                    continue

                raw_url = _obj_get(ann, "url", "") or ""
                if not raw_url:
                    continue
                normalized_url = _normalize_url(raw_url)
                if normalized_url in seen_urls:
                    continue
                seen_urls.add(normalized_url)

                ann_title = _obj_get(ann, "title", None)
                start_index = _obj_get(ann, "start_index", None)
                end_index = _obj_get(ann, "end_index", None)
                excerpt = _excerpt_from_text(text, start_index, end_index)

                metadata: dict[str, str | None] = {
                    "title": None,
                    "description": None,
                    "image": None,
                    "published_at": None,
                }
                if enrich_metadata:
                    metadata = await fetch_metadata(raw_url, timeout_s=timeout_s)

                headline = metadata["title"] or ann_title or _source_from_url(raw_url)
                summary = metadata["description"] or excerpt or "No description available."

                citation = Citation(
                    type="url_citation",
                    url=raw_url,
                    title=ann_title,
                    start_index=start_index,
                    end_index=end_index,
                    excerpt=excerpt,
                    response_id=_obj_get(response, "id", None),
                    query=query,
                )
                card = ArticleCard(
                    schema="news_card_v1",
                    article_url=raw_url,
                    headline=_clean_text(headline, 220),
                    summary=_clean_text(summary, 380),
                    image_url=metadata["image"],
                    source_name=_source_from_url(raw_url),
                    published_at=metadata["published_at"],
                    query=query,
                    provider="openai_web_search",
                    citation=citation,
                    extracted_at=extracted_at,
                )
                cards.append(card)
                if len(cards) >= max_cards:
                    return cards

    return cards


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Test OpenAI web_search card extraction with strict one-article-per-card schema."
    )
    parser.add_argument(
        "--query",
        action="append",
        dest="queries",
        help="Search query. Repeat --query for multiple queries.",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"OpenAI model for Responses API (default: {DEFAULT_MODEL}).",
    )
    parser.add_argument(
        "--search-context-size",
        default=DEFAULT_CONTEXT_SIZE,
        choices=["low", "medium", "high"],
        help="web_search context size.",
    )
    parser.add_argument(
        "--max-cards-per-query",
        type=int,
        default=DEFAULT_MAX_CARDS_PER_QUERY,
        help="Upper bound on cards extracted per query.",
    )
    parser.add_argument(
        "--timeout-s",
        type=float,
        default=DEFAULT_TIMEOUT_S,
        help="HTTP timeout for metadata enrichment requests.",
    )
    parser.add_argument(
        "--no-enrich-metadata",
        action="store_true",
        help="Skip fetching article metadata tags (faster; fewer image/title fills).",
    )
    parser.add_argument(
        "--output",
        help="Optional output JSON path. If omitted, prints JSON to stdout.",
    )
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    queries = args.queries or [
        "nigeria clean cooking policy update",
        "gold standard carbon methodology update",
    ]

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("OPENAI_API_KEY is not set.", file=sys.stderr)
        return 1

    client = AsyncOpenAI(api_key=api_key)
    all_cards: list[ArticleCard] = []

    for query in queries:
        cards = await run_query(
            client=client,
            model=args.model,
            query=query,
            search_context_size=args.search_context_size,
            max_cards=args.max_cards_per_query,
            enrich_metadata=not args.no_enrich_metadata,
            timeout_s=args.timeout_s,
        )
        all_cards.extend(cards)

    payload = {
        "schema": "news_card_collection_v1",
        "provider": "openai_web_search",
        "model": args.model,
        "query_count": len(queries),
        "card_count": len(all_cards),
        "cards": [asdict(card) for card in all_cards],
    }

    text = json.dumps(payload, indent=2, ensure_ascii=True)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text)
            f.write("\n")
        print(f"Wrote {len(all_cards)} cards to {args.output}")
    else:
        print(text)

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
