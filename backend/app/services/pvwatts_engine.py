"""
PVWatts Engine — Solar production estimate via NREL PVWatts V8 API.

Handles: input defaults, API call, geocoding, result parsing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

PVWATTS_TIMEOUT = 30.0
NOMINATIM_TIMEOUT = 10.0
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

MONTH_LABELS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

InputStatus = Literal["validated", "extracted", "assumed", "missing"]
InputSource = Literal["chat", "doc", "user", "assumption"]

MODULE_TYPE_LABELS = {0: "Standard", 1: "Premium", 2: "Thin Film"}
ARRAY_TYPE_LABELS = {
    0: "Fixed - Open Rack",
    1: "Fixed - Roof Mounted",
    2: "1-Axis Tracking",
    3: "1-Axis Backtracking",
    4: "2-Axis Tracking",
}

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class PVWattsInput:
    """A single input field with provenance tracking (mirrors LCOEInput)."""

    field_name: str
    label: str
    value: float | int | str | None
    unit: str
    source: InputSource
    status: InputStatus
    notes: str = ""
    rationale: str = ""
    category: str = "general"

    def to_dict(self) -> dict[str, Any]:
        return {
            "field_name": self.field_name,
            "label": self.label,
            "value": self.value,
            "unit": self.unit,
            "source": self.source,
            "status": self.status,
            "notes": self.notes,
            "rationale": self.rationale,
            "category": self.category,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> PVWattsInput:
        payload = {k: d[k] for k in cls.__dataclass_fields__ if k in d}
        if payload.get("status") == "inferred":
            payload["status"] = "extracted"
        return cls(**payload)


@dataclass
class PVWattsResult:
    ac_annual: float
    capacity_factor: float
    ac_monthly: list[float]
    solrad_monthly: list[float]
    solrad_annual: float
    poa_monthly: list[float]
    dc_monthly: list[float]
    station_info: dict[str, Any]
    assumption_count: int
    quality_label: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "ac_annual": round(self.ac_annual, 1),
            "capacity_factor": round(self.capacity_factor, 2),
            "ac_monthly": [round(v, 1) for v in self.ac_monthly],
            "solrad_monthly": [round(v, 3) for v in self.solrad_monthly],
            "solrad_annual": round(self.solrad_annual, 3),
            "poa_monthly": [round(v, 2) for v in self.poa_monthly],
            "dc_monthly": [round(v, 1) for v in self.dc_monthly],
            "station_info": self.station_info,
            "assumption_count": self.assumption_count,
            "quality_label": self.quality_label,
        }


# ---------------------------------------------------------------------------
# Input field definitions with defaults
# ---------------------------------------------------------------------------

REQUIRED_FIELDS = {"lat", "lon", "system_capacity"}

INPUT_FIELD_DEFS: list[dict[str, Any]] = [
    {"field_name": "address", "label": "Address", "unit": "", "category": "location", "default": None},
    {"field_name": "lat", "label": "Latitude", "unit": "°", "category": "location", "default": None},
    {"field_name": "lon", "label": "Longitude", "unit": "°", "category": "location", "default": None},
    {"field_name": "system_capacity", "label": "System Capacity", "unit": "kW DC", "category": "system", "default": None},
    {"field_name": "assessment_type", "label": "Assessment Type", "unit": "", "category": "system", "default": 0},
    {"field_name": "array_type", "label": "Array Type", "unit": "", "category": "system", "default": 0},
    {"field_name": "tilt", "label": "Tilt Angle", "unit": "°", "category": "orientation", "default": None},
    {"field_name": "azimuth", "label": "Azimuth", "unit": "°", "category": "orientation", "default": None},
    {"field_name": "losses", "label": "System Losses", "unit": "%", "category": "performance", "default": 14.0},
    {"field_name": "dc_ac_ratio", "label": "DC/AC Ratio", "unit": "", "category": "performance", "default": 1.2},
    {"field_name": "inv_eff", "label": "Inverter Efficiency", "unit": "%", "category": "performance", "default": 96.0},
    {"field_name": "gcr", "label": "Ground Coverage Ratio", "unit": "", "category": "performance", "default": 0.4},
]

CATEGORY_ORDER = ["location", "system", "orientation", "performance"]
CATEGORY_LABELS = {
    "location": "Location",
    "system": "System",
    "orientation": "Orientation",
    "performance": "Performance",
}


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


class PVWattsEngine:
    """Stateless helpers + async API calls for PVWatts V8."""

    @staticmethod
    def refresh_location_defaults(inputs: dict[str, PVWattsInput]) -> dict[str, PVWattsInput]:
        """Recompute tilt and azimuth from the current latitude whenever they are not
        user-validated.  Rules:
        - status == "validated"  → user explicitly set this value; never touch it.
        - status == "extracted" | "assumed" | "missing" → recompute from lat.
        This must be called after any lat/lon change (initial build AND recalculate).
        """
        lat_inp = inputs.get("lat")
        if lat_inp is None or lat_inp.value is None:
            return inputs

        lat_num = float(lat_inp.value)

        tilt_inp = inputs.get("tilt")
        if tilt_inp is not None and tilt_inp.status != "validated":
            # Round to nearest whole degree — sub-degree precision is meaningless for a rule-of-thumb default
            tilt_val = round(abs(lat_num))
            inputs["tilt"] = PVWattsInput(
                field_name="tilt",
                label="Tilt Angle",
                value=float(tilt_val),
                unit="°",
                source="assumption",
                status="assumed",
                notes=f"Default: |latitude| = {tilt_val}°",
                category="orientation",
            )

        azimuth_inp = inputs.get("azimuth")
        if azimuth_inp is not None and azimuth_inp.status != "validated":
            az_val = 180.0 if lat_num >= 0 else 0.0
            direction = "south-facing (equator)" if lat_num >= 0 else "north-facing (equator)"
            inputs["azimuth"] = PVWattsInput(
                field_name="azimuth",
                label="Azimuth",
                value=az_val,
                unit="°",
                source="assumption",
                status="assumed",
                notes=f"Default: {az_val}° ({direction})",
                category="orientation",
            )

        return inputs

    @staticmethod
    def build_default_inputs(
        known_values: dict[str, Any],
    ) -> dict[str, PVWattsInput]:
        """Build a full input set, filling gaps with defaults, then apply
        location-derived defaults for any non-validated orientation fields."""
        inputs: dict[str, PVWattsInput] = {}

        for defn in INPUT_FIELD_DEFS:
            fname = defn["field_name"]
            default_val = defn["default"]

            if fname in known_values and known_values[fname] is not None:
                val = known_values[fname]
                src = known_values.get(f"_source_{fname}", "chat")
                inputs[fname] = PVWattsInput(
                    field_name=fname,
                    label=defn["label"],
                    value=val,
                    unit=defn["unit"],
                    source=src,
                    status="extracted" if src in ("chat", "doc") else "validated",
                    notes=known_values.get(f"_notes_{fname}", ""),
                    category=defn["category"],
                )
            elif default_val is not None:
                inputs[fname] = PVWattsInput(
                    field_name=fname,
                    label=defn["label"],
                    value=default_val,
                    unit=defn["unit"],
                    source="assumption",
                    status="assumed",
                    notes=f"PVWatts default: {default_val}",
                    category=defn["category"],
                )
            else:
                inputs[fname] = PVWattsInput(
                    field_name=fname,
                    label=defn["label"],
                    value=None,
                    unit=defn["unit"],
                    source="assumption",
                    status="missing",
                    notes="",
                    category=defn["category"],
                )

        # Always recompute location-derived orientation defaults from lat
        # (overrides any LLM-extracted tilt/azimuth that wasn't user-validated)
        return PVWattsEngine.refresh_location_defaults(inputs)

    @staticmethod
    def get_missing_essentials(inputs: dict[str, PVWattsInput]) -> list[str]:
        missing = []
        for fname in REQUIRED_FIELDS:
            inp = inputs.get(fname)
            if inp is None or inp.value is None or inp.status == "missing":
                missing.append(fname)
        return missing

    @staticmethod
    def is_computable(inputs: dict[str, PVWattsInput]) -> bool:
        return len(PVWattsEngine.get_missing_essentials(inputs)) == 0

    @staticmethod
    async def call_pvwatts(inputs: dict[str, PVWattsInput]) -> PVWattsResult:
        """Call the NREL PVWatts V8 API and return parsed results."""

        def _val(name: str, fallback: float = 0.0) -> float:
            inp = inputs.get(name)
            if inp is None or inp.value is None:
                return fallback
            return float(inp.value)

        def _int_val(name: str, fallback: int = 0) -> int:
            inp = inputs.get(name)
            if inp is None or inp.value is None:
                return fallback
            return int(inp.value)

        params = {
            "api_key": settings.pvwatts_api_key,
            "lat": _val("lat"),
            "lon": _val("lon"),
            "system_capacity": _val("system_capacity"),
            "assessment_type": _int_val("assessment_type", 0),
            "array_type": _int_val("array_type", 0),
            "tilt": _val("tilt"),
            "azimuth": _val("azimuth", 180),
            "losses": _val("losses", 14),
            "dc_ac_ratio": _val("dc_ac_ratio", 1.2),
            "inv_eff": _val("inv_eff", 96),
            "gcr": _val("gcr", 0.4),
            "timeframe": "monthly",
        }

        async with httpx.AsyncClient(timeout=PVWATTS_TIMEOUT) as client:
            resp = await client.get(settings.pvwatts_base_url, params=params)

            if resp.status_code == 422:
                try:
                    body = resp.json()
                    errors = body.get("errors", [])
                    msg = "; ".join(errors) if errors else "Invalid parameters"
                except Exception:
                    msg = resp.text[:200] if resp.text else "Invalid parameters"
                raise ValueError(
                    f"PVWatts could not process this location (lat={params['lat']}, lon={params['lon']}). "
                    f"This usually means the coordinates are over ocean or outside coverage. "
                    f"Please verify the location on the map. Detail: {msg}"
                )

            resp.raise_for_status()
            data = resp.json()

        if data.get("errors"):
            raise ValueError(f"PVWatts API error: {'; '.join(data['errors'])}")

        outputs = data.get("outputs", {})
        station_info = data.get("station_info", {})

        assumption_count = sum(
            1 for i in inputs.values() if i.status == "assumed"
        )
        if assumption_count <= 2:
            quality_label = "high"
        elif assumption_count <= 5:
            quality_label = "moderate"
        else:
            quality_label = "low"

        return PVWattsResult(
            ac_annual=outputs.get("ac_annual", 0),
            capacity_factor=outputs.get("capacity_factor", 0),
            ac_monthly=outputs.get("ac_monthly", [0] * 12),
            solrad_monthly=outputs.get("solrad_monthly", [0] * 12),
            solrad_annual=outputs.get("solrad_annual", 0),
            poa_monthly=outputs.get("poa_monthly", [0] * 12),
            dc_monthly=outputs.get("dc_monthly", [0] * 12),
            station_info=station_info,
            assumption_count=assumption_count,
            quality_label=quality_label,
        )

    @staticmethod
    def _place_rank_to_zoom(place_rank: int) -> int:
        """Convert Nominatim place_rank to an appropriate map zoom level."""
        if place_rank <= 4:
            return 5   # country
        if place_rank <= 8:
            return 7   # state / province
        if place_rank <= 12:
            return 10  # county / district
        if place_rank <= 16:
            return 12  # city
        if place_rank <= 20:
            return 14  # suburb / neighbourhood
        if place_rank <= 25:
            return 15  # locality / hamlet
        if place_rank <= 26:
            return 16  # street
        return 18      # building / address

    @staticmethod
    def _format_geocode_result(r: dict, fallback_name: str = "") -> dict[str, Any]:
        place_rank = int(r.get("place_rank", 18))
        return {
            "lat": float(r["lat"]),
            "lon": float(r["lon"]),
            "display_name": r.get("display_name", fallback_name),
            "place_rank": place_rank,
            "zoom": PVWattsEngine._place_rank_to_zoom(place_rank),
        }

    @staticmethod
    async def geocode_address(address: str) -> dict[str, Any]:
        """Geocode an address using Nominatim (OpenStreetMap). Returns dict with lat, lon, display_name, zoom."""
        async with httpx.AsyncClient(timeout=NOMINATIM_TIMEOUT) as client:
            resp = await client.get(
                NOMINATIM_URL,
                params={
                    "q": address,
                    "format": "json",
                    "limit": 5,
                    "addressdetails": 1,
                    "accept-language": "en",
                },
                headers={"User-Agent": "Nitrogen-Solar-Estimate/1.0"},
            )
            resp.raise_for_status()
            results = resp.json()

        if not results:
            raise ValueError(f"No geocoding results for: {address}")

        top = results[0]
        result = PVWattsEngine._format_geocode_result(top, address)
        result["all_results"] = [
            PVWattsEngine._format_geocode_result(r) for r in results[:5]
        ]
        return result

    @staticmethod
    async def autocomplete_address(query: str) -> list[dict[str, Any]]:
        """Autocomplete/typeahead search using Nominatim. Returns list of suggestions with zoom hints."""
        if not query or len(query.strip()) < 2:
            return []
        async with httpx.AsyncClient(timeout=NOMINATIM_TIMEOUT) as client:
            resp = await client.get(
                NOMINATIM_URL,
                params={
                    "q": query,
                    "format": "json",
                    "limit": 5,
                    "addressdetails": 1,
                    "accept-language": "en",
                },
                headers={"User-Agent": "Nitrogen-Solar-Estimate/1.0"},
            )
            resp.raise_for_status()
            results = resp.json()

        return [PVWattsEngine._format_geocode_result(r) for r in results[:5]]
