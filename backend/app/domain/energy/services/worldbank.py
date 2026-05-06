"""World Bank external evidence connectors.

Provides narrow search connectors for:
- Open Data country indicators
- Documents & Reports metadata search
- Projects & Operations metadata search
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

from app.config import get_settings
from app.core.http_client import get_http_client

settings = get_settings()
logger = logging.getLogger(__name__)

_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


@dataclass(frozen=True)
class WorldBankIndicatorRecord:
    indicator_key: str
    indicator_code: str
    indicator_name: str
    country_name: str
    country_code: str
    year: int
    value: float | int | None
    source_url: str


@dataclass(frozen=True)
class WorldBankDocumentRecord:
    document_id: str
    title: str
    year: int | None
    document_type: str | None
    summary: str
    source_url: str | None
    publisher: str


@dataclass(frozen=True)
class WorldBankProjectRecord:
    project_id: str
    project_name: str
    country_name: str | None
    approval_year: int | None
    status: str | None
    financing_amount: float | None
    summary: str
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

    def set(self, key: str, payload: Any) -> None:
        self._items[key] = (time.time() + self._ttl_seconds, payload)


class _WorldBankBaseService:
    def __init__(self, cache_ttl_seconds: int = 300):
        self._cache = _TTLCache(cache_ttl_seconds)

    async def _get_json(self, url: str, params: dict[str, Any], cache_key: str) -> Any | None:
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        client = get_http_client()
        for attempt in range(3):
            try:
                resp = await client.get(url, params=params, timeout=10.0)
                if resp.status_code in _RETRYABLE_STATUS_CODES and attempt < 2:
                    await asyncio.sleep(2**attempt)
                    continue
                resp.raise_for_status()
                payload = resp.json()
                self._cache.set(cache_key, payload)
                return payload
            except Exception as exc:  # noqa: BLE001
                if attempt >= 2:
                    logger.warning("World Bank request failed url=%s err=%s", url, exc)
                    return None
                await asyncio.sleep(2**attempt)
        return None


class WorldBankIndicatorService(_WorldBankBaseService):
    """Connector for World Bank Open Data indicator retrieval."""

    INDICATOR_MAP: dict[str, str] = {
        "electricity_access_total": "EG.ELC.ACCS.ZS",
        "electricity_access_rural": "EG.ELC.ACCS.RU.ZS",
        "electricity_access_urban": "EG.ELC.ACCS.UR.ZS",
        "clean_cooking_access": "EG.CFT.ACCS.ZS",
        "population_total": "SP.POP.TOTL",
        "gdp_per_capita": "NY.GDP.PCAP.CD",
        "inflation": "FP.CPI.TOTL.ZG",
        "poverty_headcount": "SI.POV.DDAY",
    }

    def __init__(self):
        super().__init__(cache_ttl_seconds=300)
        self.base_url = settings.worldbank_api_base.rstrip("/")

    async def search_indicators(
        self,
        query: str,
        *,
        country_hint: str | None = None,
        latest_only: bool = True,
    ) -> list[WorldBankIndicatorRecord]:
        country = (country_hint or await self._extract_country(query) or "").strip()
        if not country:
            return []

        country_code = await self._resolve_country_code(country)
        if not country_code:
            return []

        selected = self._select_indicators(query)
        records: list[WorldBankIndicatorRecord] = []
        for indicator_key, indicator_code in selected.items():
            params = {"format": "json", "mrv": 8 if latest_only else 20}
            endpoint = f"{self.base_url}/country/{country_code}/indicator/{indicator_code}"
            cache_key = f"indicator:{country_code}:{indicator_code}:{params['mrv']}"
            payload = await self._get_json(endpoint, params=params, cache_key=cache_key)
            if not isinstance(payload, list) or len(payload) < 2:
                continue
            rows = payload[1] or []
            if not isinstance(rows, list):
                continue
            normalized = self._normalize_indicator_rows(rows, indicator_key, indicator_code)
            if normalized:
                records.extend(normalized[:1] if latest_only else normalized)
        return records

    def _select_indicators(self, query: str) -> dict[str, str]:
        lowered = query.lower()
        buckets = {
            "electricity_access": ("electricity", "grid access", "electrification"),
            "clean_cooking_access": ("clean cooking", "cooking fuels", "cookstove"),
            "population_total": ("population", "demographics"),
            "gdp_per_capita": ("gdp", "income", "economic output"),
            "inflation": ("inflation", "consumer price"),
            "poverty_headcount": ("poverty", "headcount"),
            "electricity_access_rural": ("rural electricity",),
            "electricity_access_urban": ("urban electricity",),
        }
        selected_keys: set[str] = set()
        for key, triggers in buckets.items():
            if any(trigger in lowered for trigger in triggers):
                selected_keys.add(key)

        if not selected_keys:
            selected_keys = {"electricity_access_total", "population_total", "gdp_per_capita"}
        return {key: self.INDICATOR_MAP[key] for key in selected_keys if key in self.INDICATOR_MAP}

    def _normalize_indicator_rows(
        self,
        rows: list[dict[str, Any]],
        indicator_key: str,
        indicator_code: str,
    ) -> list[WorldBankIndicatorRecord]:
        normalized: list[WorldBankIndicatorRecord] = []
        for row in rows:
            year_str = str(row.get("date") or "")
            try:
                year = int(year_str)
            except ValueError:
                continue
            country_data = row.get("country") or {}
            indicator_data = row.get("indicator") or {}
            country_name = country_data.get("value") or country_data.get("id") or "Unknown"
            country_code = country_data.get("id") or ""
            value = row.get("value")
            indicator_name = indicator_data.get("value") or indicator_code
            normalized.append(
                WorldBankIndicatorRecord(
                    indicator_key=indicator_key,
                    indicator_code=indicator_code,
                    indicator_name=indicator_name,
                    country_name=country_name,
                    country_code=country_code,
                    year=year,
                    value=value,
                    source_url=f"https://data.worldbank.org/indicator/{indicator_code}",
                )
            )
        normalized.sort(key=lambda item: item.year, reverse=True)
        return normalized

    async def _extract_country(self, query: str) -> str | None:
        countries = await self._load_country_catalog()
        lowered = query.lower()
        matches = [name for name in countries.keys() if name in lowered]
        if not matches:
            return None
        matches.sort(key=len, reverse=True)
        return matches[0]

    async def _resolve_country_code(self, country_name: str) -> str | None:
        countries = await self._load_country_catalog()
        lowered = country_name.lower().strip()
        if lowered in countries:
            return countries[lowered]
        return None

    async def _load_country_catalog(self) -> dict[str, str]:
        cache_key = "country-catalog"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        endpoint = f"{self.base_url}/country"
        payload = await self._get_json(
            endpoint,
            params={"format": "json", "per_page": 400},
            cache_key="country-catalog-request",
        )
        countries: dict[str, str] = {}
        rows = payload[1] if isinstance(payload, list) and len(payload) > 1 else []
        if isinstance(rows, list):
            for row in rows:
                name = (row.get("name") or "").lower()
                iso3 = row.get("id") or ""
                if name and iso3:
                    countries[name] = iso3
        # Include commonly used short aliases.
        alias_map = {
            "drc": "COD",
            "congo drc": "COD",
            "ivory coast": "CIV",
            "laos": "LAO",
            "tanzania": "TZA",
            "uganda": "UGA",
            "kenya": "KEN",
        }
        countries.update(alias_map)
        self._cache.set(cache_key, countries)
        return countries


class WorldBankDocumentService(_WorldBankBaseService):
    """Metadata search for World Bank Documents & Reports."""

    def __init__(self):
        super().__init__(cache_ttl_seconds=300)
        self.base_url = settings.worldbank_search_base.rstrip("/")

    async def search_documents(self, query: str, *, max_results: int = 8) -> list[WorldBankDocumentRecord]:
        endpoint = f"{self.base_url}/wds"
        params = {
            "format": "json",
            "rows": max_results,
            "qterm": query,
            "fl": "id,display_title,docty,docdt,url,pdfurl,abstracts",
        }
        payload = await self._get_json(
            endpoint,
            params=params,
            cache_key=f"wds:{query.strip().lower()}:{max_results}",
        )
        documents = self._extract_result_rows(payload, "documents")
        records: list[WorldBankDocumentRecord] = []
        for item in documents:
            title = self._pick(item, ["display_title", "title"])
            if not title:
                continue
            date_raw = self._pick(item, ["docdt", "date"])
            year = int(date_raw[:4]) if isinstance(date_raw, str) and len(date_raw) >= 4 and date_raw[:4].isdigit() else None
            doc_type = self._pick(item, ["docty", "doc_type"])
            summary = self._pick(item, ["abstracts", "abstract", "listing_relative_url"]) or ""
            source_url = self._pick(item, ["url", "pdfurl"])
            if not source_url:
                doc_id = str(self._pick(item, ["id", "_id"]) or "").strip()
                if doc_id:
                    source_url = f"https://documents.worldbank.org/en/publication/documents-reports/documentdetail/{doc_id}"
            records.append(
                WorldBankDocumentRecord(
                    document_id=str(self._pick(item, ["id", "_id"]) or ""),
                    title=title,
                    year=year,
                    document_type=doc_type,
                    summary=str(summary)[:700],
                    source_url=source_url,
                    publisher="World Bank Documents & Reports",
                )
            )
        return records[:max_results]

    @staticmethod
    def _extract_result_rows(payload: Any, top_key: str) -> list[dict[str, Any]]:
        if not isinstance(payload, dict):
            return []
        root = payload.get(top_key)
        if isinstance(root, dict):
            return [value for value in root.values() if isinstance(value, dict)]
        if isinstance(root, list):
            return [item for item in root if isinstance(item, dict)]
        return []

    @staticmethod
    def _pick(item: dict[str, Any], keys: list[str]) -> Any | None:
        for key in keys:
            value = item.get(key)
            if value not in (None, ""):
                return value
        return None


class WorldBankProjectService(_WorldBankBaseService):
    """Metadata search for World Bank Projects & Operations."""

    def __init__(self):
        super().__init__(cache_ttl_seconds=300)
        self.base_url = settings.worldbank_search_base.rstrip("/")

    async def search_projects(self, query: str, *, max_results: int = 8) -> list[WorldBankProjectRecord]:
        endpoint = f"{self.base_url}/projects"
        params = {
            "format": "json",
            "rows": max_results,
            "qterm": query,
            "fl": (
                "id,project_name,countryshortname,boardapprovaldate,project_status_name,"
                "totalamt,project_url,project_abstract"
            ),
        }
        payload = await self._get_json(
            endpoint,
            params=params,
            cache_key=f"wb-projects:{query.strip().lower()}:{max_results}",
        )
        projects = WorldBankDocumentService._extract_result_rows(payload, "projects")
        records: list[WorldBankProjectRecord] = []
        for item in projects:
            name = WorldBankDocumentService._pick(item, ["project_name", "display_title"])
            if not name:
                continue
            approval_date = WorldBankDocumentService._pick(item, ["boardapprovaldate", "approvalfy"])
            approval_year = None
            if isinstance(approval_date, str) and len(approval_date) >= 4 and approval_date[:4].isdigit():
                approval_year = int(approval_date[:4])
            amount = item.get("totalamt")
            amount_float: float | None
            try:
                amount_float = float(amount) if amount not in (None, "") else None
            except (TypeError, ValueError):
                amount_float = None
            records.append(
                WorldBankProjectRecord(
                    project_id=str(WorldBankDocumentService._pick(item, ["id", "project_id"]) or ""),
                    project_name=name,
                    country_name=WorldBankDocumentService._pick(item, ["countryshortname", "countryname"]),
                    approval_year=approval_year,
                    status=WorldBankDocumentService._pick(item, ["project_status_name", "status"]),
                    financing_amount=amount_float,
                    summary=str(WorldBankDocumentService._pick(item, ["project_abstract", "abstract"]) or "")[:700],
                    source_url=(
                        WorldBankDocumentService._pick(item, ["project_url", "url"])
                        or (
                            f"https://projects.worldbank.org/en/projects-operations/project-detail/"
                            f"{WorldBankDocumentService._pick(item, ['id', 'project_id'])}"
                            if WorldBankDocumentService._pick(item, ["id", "project_id"])
                            else None
                        )
                    ),
                    publisher="World Bank Projects & Operations",
                )
            )
        return records[:max_results]
