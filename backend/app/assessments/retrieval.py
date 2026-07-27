"""Tiered evidence retrieval for assessment assessments (RAG, OpenAlex, web)."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.variables import suggest_variable_candidates

logger = logging.getLogger(__name__)


async def retrieve_evidence(
    queries: list[str],
    db: AsyncSession | None,
    project_id: UUID | None,
    max_facts: int = 15,
    *,
    user_id: str | None = None,
) -> tuple[str, list[dict]]:
    """Run tiered retrieval (RAG + OpenAlex + web) for a list of queries.

    Returns (context_str_for_prompt, numbered_citations_list).
    Citations are deduplicated by source title.

    ``user_id`` must be a real app user when ``db`` is provided — usage/web-search
    billing writes to ``usage_records`` which FKs to ``users``. A synthetic
    ``system`` id poisons the session and breaks assessment population.
    """
    if db is None or project_id is None:
        return "", []

    if not isinstance(project_id, UUID):
        try:
            project_id = UUID(str(project_id))
        except (TypeError, ValueError):
            return "", []

    from app.adapters import get_adapter_registry
    from app.core.execution_context import ExecutionContext

    retrieval_adapter = get_adapter_registry().get("retrieval")
    if retrieval_adapter is None:
        raise RuntimeError("retrieval adapter is not registered.")
    # Prefer the acting/starter user; never bill as "system" (no users row).
    billing_user_id = (user_id or "").strip()
    if not billing_user_id or billing_user_id.startswith("system"):
        billing_user_id = ""
        logger.warning(
            "retrieve_evidence called without a billable user_id for project %s; "
            "web/LLM usage will not be attributed",
            project_id,
        )
    ctx = ExecutionContext(
        # Empty string skips usage_records writes (see record_usage / web_search guards).
        # Never use "system" — that FK-fails against users and poisons the session.
        user_id=billing_user_id,
        user_email=None,
        project_id=project_id,
        initiative_role=None,
        ai_access_granted=True,
        is_byok=False,
        request_id=f"assessment-retrieval:{project_id}",
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
                    "project_id": str(project_id),
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

    variable_candidates = suggest_variable_candidates(all_facts)
    if variable_candidates:
        logger.info(
            "retrieval produced %d variable candidate(s) from external evidence",
            len(variable_candidates),
        )

    context_str = "\n".join(context_lines) if context_lines else ""
    return context_str, citations
