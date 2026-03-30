"""
OpenAlex Service

Queries the free OpenAlex API for scholarly works relevant to
environmental compliance and program design.

API docs: https://docs.openalex.org/
"""

import logging
from dataclasses import dataclass
from typing import Optional

from app.config import get_settings
from app.core.http_client import get_http_client

settings = get_settings()
logger = logging.getLogger(__name__)


@dataclass
class OpenAlexWork:
    """A scholarly work from OpenAlex."""
    title: str
    doi_url: Optional[str]
    abstract_snippet: str
    publication_year: Optional[int]
    source_name: Optional[str]
    openalex_id: str


class OpenAlexService:
    """Client for the OpenAlex REST API (free, no key required)."""

    def __init__(self):
        self.base_url = settings.openalex_base_url.rstrip("/")
        self.email = settings.openalex_email

    async def search_works(
        self,
        query: str,
        per_page: int = 10,
    ) -> list[OpenAlexWork]:
        """
        Search OpenAlex for scholarly works matching the query.
        Returns an empty list on any error (graceful degradation).
        """
        params: dict[str, str | int] = {
            "search": query,
            "per_page": per_page,
            "sort": "relevance_score:desc",
            "select": "id,title,doi,abstract_inverted_index,publication_year,primary_location",
        }
        if self.email:
            params["mailto"] = self.email

        try:
            client = get_http_client()
            resp = await client.get(f"{self.base_url}/works", params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"OpenAlex request failed: {e}")
            return []

        results: list[OpenAlexWork] = []
        for item in data.get("results", []):
            title = item.get("title") or ""
            if not title:
                continue

            abstract = self._reconstruct_abstract(
                item.get("abstract_inverted_index")
            )

            source_name = None
            primary_loc = item.get("primary_location") or {}
            source_obj = primary_loc.get("source") or {}
            source_name = source_obj.get("display_name")

            results.append(
                OpenAlexWork(
                    title=title,
                    doi_url=item.get("doi"),
                    abstract_snippet=abstract[:400] if abstract else "",
                    publication_year=item.get("publication_year"),
                    source_name=source_name,
                    openalex_id=item.get("id", ""),
                )
            )

        logger.info(f"OpenAlex returned {len(results)} results for: {query[:60]}")
        return results

    @staticmethod
    def _reconstruct_abstract(
        inverted_index: dict[str, list[int]] | None,
    ) -> str:
        """Rebuild plain-text abstract from OpenAlex inverted index format."""
        if not inverted_index:
            return ""
        word_positions: list[tuple[int, str]] = []
        for word, positions in inverted_index.items():
            for pos in positions:
                word_positions.append((pos, word))
        word_positions.sort(key=lambda x: x[0])
        return " ".join(w for _, w in word_positions)
