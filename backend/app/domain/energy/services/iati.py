"""IATI Datastore v3 connector for funding activity evidence."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.config import get_settings
from app.core.http_client import get_http_client

settings = get_settings()
logger = logging.getLogger(__name__)

_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


@dataclass(frozen=True)
class IATIActivityRecord:
    activity_id: str
    title: str
    reporting_organization: str | None
    recipient_country: str | None
    sector: str | None
    status: str | None
    start_date: str | None
    end_date: str | None
    budget_summary: str | None
    source_url: str | None
    publisher: str


class _TTLCache:
    def __init__(self, ttl_seconds: int):
        self._ttl_seconds = ttl_seconds
        self._items: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        entry = self._items.get(key)
        if entry is None:
            return None
        expires_at, payload = entry
        if expires_at < time.time():
            self._items.pop(key, None)
            return None
        return payload

    def set(self, key: str, value: Any) -> None:
        self._items[key] = (time.time() + self._ttl_seconds, value)


class IATIService:
    """Connector for the IATI Datastore v3 API Gateway."""

    def __init__(self):
        self.base_url = "https://api.iatistandard.org/datastore"
        self.api_key = settings.iati_api_key
        self._cache = _TTLCache(ttl_seconds=600)
        self._rate_lock = asyncio.Lock()
        self._last_request_at = 0.0
        self._daily_limit = 500
        self._daily_count = 0
        self._daily_count_day = datetime.now(timezone.utc).date()

    async def search_activities(self, query: str, *, max_results: int = 10) -> list[IATIActivityRecord]:
        if not self.api_key:
            logger.info("IATI search skipped: iati_api_key not configured")
            return []
        payload = await self._request(
            path="/activity/select",
            params={
                "q": query,
                "page_size": max_results,
                "page": 1,
                "sort": "relevance desc",
            },
            cache_key=f"iati-activity:{query.strip().lower()}:{max_results}",
        )
        rows = self._extract_rows(payload)
        records: list[IATIActivityRecord] = []
        for row in rows:
            title = self._pick_text(row.get("title")) or self._pick_text(row.get("activity_title"))
            if not title:
                continue
            activity_id = (
                self._pick_text(row.get("iati_identifier"))
                or self._pick_text(row.get("id"))
                or self._pick_text(row.get("activity_id"))
                or ""
            )
            if not activity_id:
                continue
            budget_summary = self._summarize_budget(row)
            source_url = f"https://d-portal.org/q.html?aid={activity_id}" if activity_id else None
            records.append(
                IATIActivityRecord(
                    activity_id=activity_id,
                    title=title,
                    reporting_organization=self._pick_text(row.get("reporting_org"))
                    or self._pick_text(row.get("reporting_organisation"))
                    or self._pick_text(row.get("reporting_org_name")),
                    recipient_country=self._pick_text(row.get("recipient_country"))
                    or self._pick_text(row.get("recipient_country_name")),
                    sector=self._pick_text(row.get("sector"))
                    or self._pick_text(row.get("sector_name")),
                    status=self._pick_text(row.get("activity_status"))
                    or self._pick_text(row.get("activity_status_name")),
                    start_date=self._pick_text(row.get("start_date")) or self._pick_text(row.get("activity_date_start")),
                    end_date=self._pick_text(row.get("end_date")) or self._pick_text(row.get("activity_date_end")),
                    budget_summary=budget_summary,
                    source_url=source_url,
                    publisher="IATI Datastore",
                )
            )
        return records[:max_results]

    async def _request(self, path: str, params: dict[str, Any], cache_key: str) -> Any | None:
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        client = get_http_client()

        for attempt in range(3):
            await self._enforce_limits()
            try:
                resp = await client.get(
                    url,
                    params=params,
                    headers={"Ocp-Apim-Subscription-Key": self.api_key},
                    timeout=10.0,
                )
                if resp.status_code in _RETRYABLE_STATUS_CODES and attempt < 2:
                    await asyncio.sleep(2**attempt)
                    continue
                resp.raise_for_status()
                payload = resp.json()
                self._cache.set(cache_key, payload)
                return payload
            except Exception as exc:  # noqa: BLE001
                if attempt >= 2:
                    logger.warning("IATI request failed path=%s err=%s", path, exc)
                    return None
                await asyncio.sleep(2**attempt)
        return None

    async def _enforce_limits(self) -> None:
        async with self._rate_lock:
            now = time.monotonic()
            elapsed = now - self._last_request_at
            if elapsed < 1.0:
                await asyncio.sleep(1.0 - elapsed)
            self._last_request_at = time.monotonic()
            await self._increment_daily_count()

    async def _increment_daily_count(self) -> None:
        current_day = datetime.now(timezone.utc).date()
        if self._daily_count_day != current_day:
            self._daily_count_day = current_day
            self._daily_count = 0
        if self._daily_count >= self._daily_limit:
            raise RuntimeError("IATI daily request quota reached (default 500/day).")
        self._daily_count += 1

    @staticmethod
    def _extract_rows(payload: Any) -> list[dict[str, Any]]:
        if not isinstance(payload, dict):
            return []
        for key in ("results", "result", "activities", "rows", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
            if isinstance(value, dict):
                nested = value.get("results")
                if isinstance(nested, list):
                    return [item for item in nested if isinstance(item, dict)]
        return []

    @staticmethod
    def _pick_text(value: Any) -> str | None:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        if isinstance(value, dict):
            for key in ("text", "narrative", "value", "name"):
                nested = value.get(key)
                if isinstance(nested, str) and nested.strip():
                    return nested.strip()
            for nested in value.values():
                picked = IATIService._pick_text(nested)
                if picked:
                    return picked
        if isinstance(value, list):
            for item in value:
                picked = IATIService._pick_text(item)
                if picked:
                    return picked
        return None

    @staticmethod
    def _summarize_budget(row: dict[str, Any]) -> str | None:
        candidate_keys = ("budget_value", "budget", "transaction_value", "value")
        for key in candidate_keys:
            value = row.get(key)
            if value in (None, "", []):
                continue
            if isinstance(value, (int, float)):
                currency = IATIService._pick_text(row.get("currency")) or "USD"
                return f"{currency} {value:,.0f}"
            text = IATIService._pick_text(value)
            if text:
                return text
        return None
