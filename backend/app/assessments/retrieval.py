"""Tiered evidence retrieval for assessment assessments (RAG, OpenAlex, web)."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.assumptions import suggest_assumption_candidates

logger = logging.getLogger(__name__)


async def retrieve_evidence(
    queries: list[str],
    db: AsyncSession,
    initiative_id: UUID,
    max_facts: int = 15,
) -> tuple[str, list[dict]]:
    """Run tiered retrieval (RAG + OpenAlex + web) for a list of queries.

    Returns (context_str_for_prompt, numbered_citations_list).
    Citations are deduplicated by source title.
    """
    from app.adapters import get_adapter_registry
    from app.core.execution_context import ExecutionContext

    retrieval_adapter = get_adapter_registry().get("retrieval")
    if retrieval_adapter is None:
        raise RuntimeError("retrieval adapter is not registered.")
    ctx = ExecutionContext(
        user_id="system",
        user_email=None,
        initiative_id=initiative_id,
        initiative_role=None,
        ai_access_granted=True,
        is_byok=False,
        request_id=f"assessment-retrieval:{initiative_id}",
    )
    all_facts: list = []
    seen_titles: set[str] = set()

    for query in queries:
        try:
            adapter_result = await retrieval_adapter.execute(
                ctx,
                db,
                {
                    "query": query,
                    "initiative_id": str(initiative_id),
                    "include_openalex": True,
                    "include_web_search": True,
                    "include_llm_fallback": False,
                    "require_citation": False,
                },
            )
            for fact in adapter_result.output.get("facts", []):
                source_title = fact.get("source_title", "")
                if source_title and source_title not in seen_titles:
                    seen_titles.add(source_title)
                    all_facts.append(fact)
        except Exception as exc:
            logger.warning(f"Retrieval failed for query '{query[:60]}': {exc}")

    all_facts = all_facts[:max_facts]
    citations: list[dict] = []
    context_lines: list[str] = []
    for i, fact in enumerate(all_facts, start=1):
        citations.append({
            "number": i,
            "source_type": fact.get("source_type", ""),
            "source_title": fact.get("source_title", ""),
            "source_url": fact.get("source_url", "") or "",
            "publisher": fact.get("publisher", "") or "",
            "excerpt": (fact.get("content", "") or "")[:300],
        })
        context_lines.append(
            f"[{i}] {fact.get('source_title', '')}"
            + (f" ({fact.get('publisher', '')})" if fact.get("publisher") else "")
            + f": {(fact.get('content', '') or '')[:400]}"
        )

    assumption_candidates = suggest_assumption_candidates(all_facts)
    if assumption_candidates:
        logger.info(
            "retrieval produced %d assumption candidate(s) from external evidence",
            len(assumption_candidates),
        )

    context_str = "\n".join(context_lines) if context_lines else ""
    return context_str, citations
