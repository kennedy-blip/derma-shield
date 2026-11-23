"""Vercel Python runtime entrypoint for DERMA-SHIELD photobiology.

Routes (all under ``/api/derma_photobiology``):

    GET  ?action=health          → runtime + engine version + calibration report
    GET  ?action=advisory&uv_index=7.4&ita=52.4&spf=30&...  → solar advisory
    GET  ?action=spectrum&elevation=55&ozone_du=300         → 1 nm UV spectrum
    GET  ?action=shadow&height_m=1.75&shadow_m=1.2          → off-grid clinometer
    POST {action:"advisory", ...}                           → batch / JSON body
    POST {action:"audit_filters", filters:[...]}             → rule pack
    POST {action:"spf_curve", spf:30, activity:"walk", ...}  → decay curve

Design notes
------------
* Vercel's Python runtime imports a module named ``handler`` (or uses the
  ASGI/WSGI ``app`` object). This file exports **both** a WSGI ``app`` and a
  ``handler`` class shim so it works whether the project is configured with the
  legacy ``@vercel/python`` builder or the newer ``runtime: python3.12``
  auto-detection.
* Zero third-party imports. Everything is stdlib + ``python_photobiology``.
* The module is deliberately tolerant: unknown parameters fall back to the
  documented defaults rather than returning 400, because the field client may
  cache an older request shape.
"""

from __future__ import annotations

import json
import math
import sys
import time
from dataclasses import dataclass
from typing import Any, Callable, Iterable
from urllib.parse import parse_qs

# Vercel executes this file from the project root, so the package is importable.
sys.path.insert(0, __file__.rsplit("/", 2)[0] if "/api/" in __file__ else ".")

from python_photobiology import __version__ as ENGINE_VERSION  # noqa: E402
from python_photobiology.med_erythema_vitd import (  # noqa: E402
    AM0_IRRADIANCE,
    ERYTHEMA_ACTION,
    OZONE_SIGMA,
    OZONE_PATH_FACTOR,
    RAYLEIGH_TAU,
    UVI_CALIBRATION,
    UVI_TO_ERYTHEMAL_WM2,
    air_mass,
    burn_dosimetry,
    ground_uv_spectrum,
    med_from_ita,
    solar_advisory,
    solar_elevation,
    solar_elevation_from_shadow,
    solar_zenith,
    uv_index_from_geometry,
    uv_index_from_lux,
    uv_index_from_shadow,
    vitamin_d_spectral_ratio,
    vitamin_d_timer,
)
from python_photobiology.spf_film_kinetics import (  # noqa: E402
    ACTIVITY_PROFILES,
    FILTER_HALF_LIFE_MIN,
    audit_filters,
    reapply_minute,
    spf_decay_curve,
    spf_film_integrity,
)

__all__ = ["handler", "app", "HealthPayload"]

API_VERSION = "1.0.0"
BOOTED_AT = time.time()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _f(params: dict[str, list[str]], key: str, default: float) -> float:
    """Parse a float parameter defensively."""
    raw = params.get(key)
    if not raw:
        return default
    try:
        value = float(raw[0])
    except (TypeError, ValueError):
        return default
    return value if math.isfinite(value) else default


def _s(params: dict[str, list[str]], key: str, default: str) -> str:
    raw = params.get(key)
    return raw[0] if raw else default


def _b(params: dict[str, list[str]], key: str, default: bool = False) -> bool:
    raw = params.get(key)
    if not raw:
        return default
    return raw[0].lower() in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class HealthPayload:
    status: str
    api_version: str
    engine_version: str
    python_version: str
    uptime_seconds: float
    calibration: dict[str, float]
    capabilities: list[str]

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "api_version": self.api_version,
            "engine_version": self.engine_version,
            "python_version": self.python_version,
            "uptime_seconds": round(self.uptime_seconds, 1),
            "calibration": self.calibration,
            "capabilities": self.capabilities,
        }


def health() -> dict[str, Any]:
    """Runtime health + calibration report (used by the Admin inspector)."""
    return HealthPayload(
        status="ok",
        api_version=API_VERSION,
        engine_version=ENGINE_VERSION,
        python_version=sys.version.split()[0],
        uptime_seconds=time.time() - BOOTED_AT,
        calibration={
            "uvi_calibration": UVI_CALIBRATION,
            "ozone_path_factor": OZONE_PATH_FACTOR,
            "rayleigh_tau": RAYLEIGH_TAU,
            "uvi_to_erythemal_wm2": UVI_TO_ERYTHEMAL_WM2,
            "action_spectrum_anchors": float(len(ERYTHEMA_ACTION)),
            "am0_bins": float(len(AM0_IRRADIANCE)),
            "ozone_bins": float(len(OZONE_SIGMA)),
        },
        capabilities=[
            "uv_spectrum_1nm",
            "mckinlay_diffey_erythema",
            "holick_previtamin_d3",
            "fitzpatrick_med",
            "albedo_altitude_multipliers",
            "williams_shadow_clinometer",
            "biexponential_spf_kinetics",
            "sunscreen_rule_pack_14",
        ],
    ).as_dict()


# ---------------------------------------------------------------------------
# route implementations
# ---------------------------------------------------------------------------


def handle_advisory(p: dict[str, list[str]]) -> dict[str, Any]:
    """Primary dosimetry payload."""
    uv_index = _f(p, "uv_index", 7.4)
    ita = _f(p, "ita", 52.4)
    spf = _f(p, "spf", 1.0)
    albedo = _f(p, "albedo", 0.05)
    altitude_m = _f(p, "altitude_m", 0.0)
    elevation = _f(p, "elevation_deg", 55.0)
    ozone = _f(p, "ozone_du", 300.0)
    bsa = _f(p, "bsa", 0.35)
    target_iu = _f(p, "target_iu", 1000.0)
    altitude_in_uvi = _b(p, "altitude_in_uvi", False)

    advisory = solar_advisory(
        uv_index=uv_index,
        ita=ita,
        bsa_fraction=bsa,
        spf=spf,
        albedo=albedo,
        altitude_m=altitude_m,
        elevation_deg=elevation,
        ozone_du=ozone,
        target_iu=target_iu,
        altitude_in_uvi=altitude_in_uvi,
    )
    advisory["inputs"] = {
        "uv_index": uv_index,
        "ita": ita,
        "spf": spf,
        "albedo": albedo,
        "altitude_m": altitude_m,
        "elevation_deg": elevation,
        "ozone_du": ozone,
        "bsa": bsa,
        "target_iu": target_iu,
    }
    advisory["engine"] = {
        "runtime": "python3.12",
        "version": ENGINE_VERSION,
        "action_spectrum": "McKinlay–Diffey 1987 (CIE)",
        "vitd_model": "Holick 2007",
        "air_mass": "Kasten–Young 1989",
    }
    return advisory


def handle_spectrum(p: dict[str, list[str]]) -> dict[str, Any]:
    """Full 1 nm ground-level UV spectrum with both action weightings."""
    elevation = _f(p, "elevation_deg", 55.0)
    ozone = _f(p, "ozone_du", 300.0)
    altitude_m = _f(p, "altitude_m", 0.0)
    albedo = _f(p, "albedo", 0.05)
    step = max(1, int(_f(p, "step_nm", 1.0)))

    zenith = 90.0 - min(90.0, max(0.0, elevation))
    rows = ground_uv_spectrum(
        zenith=zenith,
        ozone_du=ozone,
        altitude_m=altitude_m,
        albedo=albedo,
        step_nm=step,
    )
    bin_width = float(step)
    ery = sum(r["ery"] for r in rows) * bin_width
    vitd = sum(r["vitd"] for r in rows) * bin_width
    return {
        "inputs": {
            "elevation_deg": elevation,
            "zenith_deg": round(zenith, 2),
            "ozone_du": ozone,
            "altitude_m": altitude_m,
            "albedo": albedo,
            "step_nm": step,
        },
        "optical_air_mass": round(air_mass(zenith), 3),
        "uv_index": uv_index_from_geometry(
            elevation_deg=elevation, ozone_du=ozone, altitude_m=altitude_m, albedo=albedo
        ),
        "erythemal_wm2": round(ery, 6),
        "vitamin_d_wm2": round(vitd, 6),
        "vitamin_d_spectral_ratio": round(vitamin_d_spectral_ratio(elevation, ozone), 4),
        "spectrum": [
            {
                "nm": int(r["nm"]),
                "irradiance": round(r["e"], 6),
                "erythema_weighted": round(r["ery"], 6),
                "vitd_weighted": round(r["vitd"], 6),
            }
            for r in rows
        ],
    }


def handle_shadow(p: dict[str, list[str]]) -> dict[str, Any]:
    """William's shadow-ratio clinometer → off-grid UV Index."""
    height_m = _f(p, "height_m", 1.75)
    shadow_m = _f(p, "shadow_m", 1.2)
    ozone = _f(p, "ozone_du", 300.0)
    altitude_m = _f(p, "altitude_m", 0.0)
    albedo = _f(p, "albedo", 0.05)

    result = uv_index_from_shadow(
        height_m=height_m,
        shadow_m=shadow_m,
        ozone_du=ozone,
        altitude_m=altitude_m,
        albedo=albedo,
    )
    elev = solar_elevation_from_shadow(height_m, shadow_m)
    confidence = (
        "LOW — Sun below 8°, UVB negligible"
        if elev < 8
        else "MEDIUM — near-zenith, shadow too short"
        if elev > 82
        else "HIGH — ideal William's ratio geometry"
        if shadow_m / max(0.01, height_m) > 1.4
        else "GOOD"
    )
    return {
        "inputs": {"height_m": height_m, "shadow_m": shadow_m},
        **result,
        "confidence": confidence,
        "vitamin_d_spectral_ratio": round(vitamin_d_spectral_ratio(elev, ozone), 4),
    }


def handle_lux(p: dict[str, list[str]]) -> dict[str, Any]:
    """Ambient-light-sensor fallback (lux → UV Index)."""
    lux = _f(p, "lux", 60000.0)
    elevation = _f(p, "elevation_deg", 55.0)
    altitude_m = _f(p, "altitude_m", 0.0)
    return {
        "inputs": {"lux": lux, "elevation_deg": elevation, "altitude_m": altitude_m},
        "uv_index": uv_index_from_lux(lux, elevation, altitude_m),
        "method": "sin(elevation)^2.4 gate on the 100 klx ↔ UVI 11.6 anchor",
    }


def handle_ephemeris(p: dict[str, list[str]]) -> dict[str, Any]:
    """Solar zenith/elevation for a latitude, day-of-year and solar hour."""
    latitude = _f(p, "latitude", -0.0467)
    day = int(_f(p, "day_of_year", 172.0))
    hour = _f(p, "solar_hour", 12.0)
    zenith = solar_zenith(latitude, day, hour)
    elevation = solar_elevation(latitude, day, hour)
    return {
        "inputs": {"latitude": latitude, "day_of_year": day, "solar_hour": hour},
        "zenith_deg": round(zenith, 2),
        "elevation_deg": round(elevation, 2),
        "optical_air_mass": round(air_mass(zenith), 3),
        "uv_index": uv_index_from_geometry(elevation_deg=max(0.0, elevation)),
    }


def handle_med(p: dict[str, list[str]]) -> dict[str, Any]:
    """ITA° → Fitzpatrick MED + burn/vitamin-D timers at a given UV Index."""
    ita = _f(p, "ita", 52.4)
    uv_index = _f(p, "uv_index", 7.4)
    spf = _f(p, "spf", 1.0)
    med = med_from_ita(ita)
    return {
        "inputs": {"ita": ita, "uv_index": uv_index, "spf": spf},
        "med_jm2": med,
        "burn": burn_dosimetry(med_jm2=med, uv_index=uv_index, spf=spf),
        "vitamin_d": vitamin_d_timer(med_jm2=med, uv_index=uv_index, spf=spf),
    }


def handle_spf_curve(p: dict[str, list[str]]) -> dict[str, Any]:
    """Bi-exponential sunscreen film decay curve."""
    spf = _f(p, "spf", 30.0)
    activity = _s(p, "activity", "walk")
    filter_key = _s(p, "filter_key", "avobenzone_unstabilized")
    water = _f(p, "water_resistance_min", 40.0)
    horizon = _f(p, "horizon_min", 180.0)
    step = max(1.0, _f(p, "step_min", 2.0))

    curve = spf_decay_curve(
        horizon=horizon,
        step=step,
        spf=spf,
        activity=activity,
        filter_key=filter_key,
        water_resistance_min=water,
    )
    return {
        "inputs": {
            "spf": spf,
            "activity": activity,
            "filter_key": filter_key,
            "water_resistance_min": water,
        },
        "activity_profile": ACTIVITY_PROFILES.get(activity, ACTIVITY_PROFILES["walk"]),
        "photolysis_half_life_min": (
            FILTER_HALF_LIFE_MIN.get(filter_key) if filter_key in FILTER_HALF_LIFE_MIN else None
        ),
        "reapply_minute": reapply_minute(
            spf=spf,
            activity=activity,
            filter_key=filter_key,
            water_resistance_min=water,
        ),
        "curve": curve,
    }


def handle_audit_filters(p: dict[str, list[str]], body: dict[str, Any]) -> dict[str, Any]:
    """Run the shared 14-rule photostability pack (POST body preferred)."""
    filters = body.get("filters") or p.get("filters", [""])[0].split(",")
    stabilisers = body.get("stabilisers") or p.get("stabilisers", [""])[0].split(",")
    retinoids = body.get("retinoids") or []
    acids = body.get("acids") or []
    has_iron = bool(body.get("has_iron_oxide") or _b(p, "has_iron_oxide", False))
    comedogenic = body.get("comedogenic") or {}

    clean = [f.strip().replace("-", "_") for f in filters if f and f.strip()]
    clean_stab = [s.strip().replace("-", "_") for s in stabilisers if s and s.strip()]

    return audit_filters(
        filters=clean,
        stabilisers=clean_stab,
        has_iron_oxide=has_iron,
        retinoids=[r.strip() for r in retinoids if r],
        acids=[a.strip() for a in acids if a],
        comedogenic={k.strip().replace("-", "_"): int(v) for k, v in comedogenic.items()},
    )


ROUTES: dict[str, Callable[[dict[str, list[str]]], dict[str, Any]]] = {
    "health": lambda p: health(),
    "advisory": handle_advisory,
    "spectrum": handle_spectrum,
    "shadow": handle_shadow,
    "lux": handle_lux,
    "ephemeris": handle_ephemeris,
    "med": handle_med,
    "spf_curve": handle_spf_curve,
}


# ---------------------------------------------------------------------------
# request dispatch
# ---------------------------------------------------------------------------


def dispatch(action: str, params: dict[str, list[str]], body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Pure function form of the route table (unit-testable without WSGI)."""
    started = time.perf_counter()
    body = body or {}
    if action == "audit_filters":
        payload = handle_audit_filters(params, body)
    elif action in ROUTES:
        payload = ROUTES[action](params)
    else:
        return {
            "ok": False,
            "error": f"unknown action '{action}'",
            "actions": sorted(list(ROUTES) + ["audit_filters"]),
        }
    return {
        "ok": True,
        "action": action,
        "runtime": "python3.12",
        "engine_version": ENGINE_VERSION,
        "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
        "data": payload,
    }


class handler:  # noqa: N801 - Vercel expects this exact name
    """Vercel Python runtime entrypoint.

    Supports both the legacy `BaseHTTPRequestHandler` style (via ``do_GET``) and
    the modern ``handler(request)`` callable interface. Vercel inspects the
    module for ``handler`` and, when it is a class, instantiates it per request.
    """

    headers = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}
    status_code = 200

    def __init__(self, request: Any | None = None) -> None:
        self.request = request

    # -- HTTP verbs ---------------------------------------------------------
    def do_GET(self) -> tuple[int, dict[str, str], str]:  # pragma: no cover - Vercel
        path = getattr(self.request, "path", "/")
        query = path.split("?", 1)[1] if "?" in path else ""
        params = parse_qs(query)
        action = _s(params, "action", "health")
        payload = dispatch(action, params)
        self.status_code = 200 if payload.get("ok") else 400
        return self.status_code, self.headers, json.dumps(payload)

    def do_POST(self) -> tuple[int, dict[str, str], str]:  # pragma: no cover - Vercel
        path = getattr(self.request, "path", "/")
        query = path.split("?", 1)[1] if "?" in path else ""
        params = parse_qs(query)
        try:
            raw = getattr(self.request, "body", b"{}")
            body = json.loads(raw if isinstance(raw, str) else raw.decode("utf-8") or "{}")
        except Exception:
            body = {}
        action = _s(params, "action", body.get("action", "advisory"))
        payload = dispatch(action, params, body)
        self.status_code = 200 if payload.get("ok") else 400
        return self.status_code, self.headers, json.dumps(payload)

    # -- callable interface -------------------------------------------------
    def __call__(self, request: Any = None) -> Any:  # pragma: no cover - Vercel
        self.request = request or self.request
        method = getattr(self.request, "method", "GET").upper()
        status, headers, body = (
            self.do_POST() if method == "POST" else self.do_GET()
        )
        try:
            from http.server import BaseHTTPRequestHandler  # noqa: F401

            return status, headers, body
        except Exception:  # pragma: no cover
            return {"statusCode": status, "headers": headers, "body": body}


def app(environ: dict[str, Any], start_response: Callable[..., Any]) -> Iterable[bytes]:
    """PEP-3333 WSGI shim so gunicorn/uwsgi can also mount this module."""
    method = environ.get("REQUEST_METHOD", "GET").upper()
    query = environ.get("QUERY_STRING", "")
    params = parse_qs(query)
    body: dict[str, Any] = {}
    if method == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH") or 0)
            raw = environ["wsgi.input"].read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            body = {}
    action = _s(params, "action", body.get("action", "health"))
    payload = dispatch(action, params, body)
    encoded = json.dumps(payload).encode("utf-8")
    status = "200 OK" if payload.get("ok") else "400 Bad Request"
    start_response(
        status,
        [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(encoded))),
            ("Cache-Control", "no-store"),
        ],
    )
    return [encoded]
