"""McKinlay-Diffey erythemal irradiance, Fitzpatrick MED, Holick previtamin-D3
synthesis, albedo/altitude UV multipliers and William's shadow clinometer.

This is a dependency-free, deterministic reimplementation of the radiative-
transfer chain that DERMA-SHIELD uses for solar dosimetry. The same equations
exist as a JavaScript mirror in ``src/lib/engines/photobiology.js`` so the
Android APK works fully offline and produces bit-for-bit identical numbers.

References
----------
McKinlay & Diffey (1987), "A reference action spectrum for ultraviolet induced
    erythema in human skin", CIE J. 6(1):17-22.
Kasten & Young (1989), "Revised optical air mass tables and approximation
    formula", Appl. Opt. 28(22):4735-4738.
Holick (2007), "Vitamin D deficiency", N. Engl. J. Med. 357:266-281.
Fitzpatrick (1975), "Soleil et peau", J. Med. Esthet. 2:33-34.
Bodhaine et al. (1999), "On Rayleigh optical depth calculations", JTECH 16.

Units: wavelengths in nm, irradiances in W m^-2 nm^-1, doses in J m^-2.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from typing import Iterable, Mapping

__all__ = [
    "ERYTHEMA_ACTION",
    "VITAMIN_D_ACTION",
    "OZONE_SIGMA",
    "AM0_IRRADIANCE",
    "UVI_TO_ERYTHEMAL_WM2",
    "IU_PER_FULL_BODY_MED",
    "erythema_action",
    "vitamin_d_action",
    "solar_declination",
    "solar_zenith",
    "solar_elevation",
    "air_mass",
    "solar_elevation_from_shadow",
    "shadow_ratio_from_elevation",
    "ground_uv_spectrum",
    "uv_index_from_geometry",
    "uv_index_from_shadow",
    "uv_index_from_lux",
    "vitamin_d_spectral_ratio",
    "altitude_multiplier",
    "albedo_multiplier",
    "med_from_ita",
    "burn_dosimetry",
    "vitamin_d_timer",
    "solar_advisory",
    "SolarAdvisory",
]

# ---------------------------------------------------------------------------
# 1. Action spectra
# ---------------------------------------------------------------------------

#: CIE erythema action spectrum S(λ), McKinlay & Diffey 1987, normalised to 1
#: at 298 nm. Expressed as (nm, weight) pairs and linearly interpolated.
ERYTHEMA_ACTION: tuple[tuple[int, float], ...] = (
    (290, 0.010), (295, 0.075), (297, 0.350), (300, 0.650), (303, 0.860),
    (305, 0.940), (307, 0.980), (310, 1.000), (313, 0.970), (315, 0.930),
    (320, 0.850), (325, 0.780), (330, 0.680), (335, 0.580), (340, 0.470),
    (345, 0.370), (350, 0.280), (355, 0.210), (360, 0.150), (365, 0.100),
    (370, 0.065), (375, 0.042), (380, 0.028), (385, 0.019), (390, 0.013),
    (395, 0.009), (400, 0.006),
)

#: Previtamin-D3 action spectrum (Doyle / CIE), normalised to 1 at 295-297 nm.
VITAMIN_D_ACTION: tuple[tuple[int, float], ...] = (
    (255, 0.00), (260, 0.02), (265, 0.08), (270, 0.18), (275, 0.35),
    (280, 0.62), (285, 0.82), (290, 0.94), (295, 1.00), (297, 1.00),
    (300, 0.78), (305, 0.52), (310, 0.34), (315, 0.20), (320, 0.11),
    (325, 0.055), (330, 0.02), (335, 0.00),
)

#: Ozone absorption cross-section, cm^2 molecule^-1 (Hartley-Huggins band).
OZONE_SIGMA: Mapping[int, float] = {
    290: 8.00e-18, 295: 5.60e-18, 300: 6.50e-19, 303: 2.40e-19, 305: 1.20e-19,
    310: 3.40e-20, 315: 1.40e-20, 320: 7.50e-21, 325: 5.20e-21, 330: 4.00e-21,
    335: 3.20e-21, 340: 2.70e-21, 345: 2.20e-21, 350: 1.80e-21, 355: 1.50e-21,
    360: 1.25e-21, 365: 1.05e-21, 370: 9.00e-22, 375: 7.80e-22, 380: 6.80e-22,
    385: 6.00e-22, 390: 5.40e-22, 395: 5.00e-22, 400: 4.60e-22,
}

#: Extraterrestrial (AM0) solar UV spectral irradiance, W m^-2 nm^-1.
AM0_IRRADIANCE: Mapping[int, float] = {
    290: 0.045, 295: 0.061, 300: 0.081, 305: 0.104, 310: 0.132,
    315: 0.166, 320: 0.204, 325: 0.246, 330: 0.294, 335: 0.345,
    340: 0.401, 345: 0.459, 350: 0.516, 355: 0.573, 360: 0.625,
    365: 0.674, 370: 0.716, 375: 0.752, 380: 0.776, 385: 0.792,
    390: 0.803, 395: 0.808, 400: 0.810,
}

#: One UV Index unit = 25 mW m^-2 of CIE-erythema-weighted irradiance.
UVI_TO_ERYTHEMAL_WM2: float = 0.025

#: Rayleigh optical-depth coefficient at 1 µm (Bodhaine et al. 1999), scaled for
#: the effective overhead column of a 300 DU, sea-level, clear-sky atmosphere.
RAYLEIGH_TAU: float = 0.020

#: Ozone path geometry factor. The naive m_ozone = m_rayleigh over-attenuates
#: UVB by roughly a factor of two versus the effective overhead column, so the
#: path is scaled here and the whole chain is anchored to the published UV Index
#: envelope (UVI 12.7 at a 90° Sun, 2.5 at 30°, 0.2 at 15°).
OZONE_PATH_FACTOR: float = 0.52

#: Absolute calibration constant. Anchors the CIE-weighted spectral integral to
#: the UV Index scale: overhead Sun, 300 DU, sea level, grass albedo → UVI ≈ 12.7.
UVI_CALIBRATION: float = 0.18

#: Holick: one full-body MED synthesises ≈ 10 000 IU of previtamin D3.
IU_PER_FULL_BODY_MED: float = 10_000.0

#: Vitamin-D / erythema spectral ratio for an overhead Sun, used to normalise.
_VITD_REFERENCE_RATIO: float = 0.0742


def _interp(table: Iterable[tuple[int, float]], x: float) -> float:
    """Piecewise-linear interpolation over an ascending (key, value) table."""
    pts = list(table)
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            f = (x - x0) / (x1 - x0)
            return y0 + f * (y1 - y0)
    return 0.0


def _interp_map(table: Mapping[int, float], x: float) -> float:
    return _interp(sorted(table.items()), x)


def erythema_action(nm: float) -> float:
    """CIE erythema action spectrum S(λ) in [0, 1]."""
    return _interp(ERYTHEMA_ACTION, nm)


def vitamin_d_action(nm: float) -> float:
    """Previtamin-D3 synthesis action spectrum, zero outside 255-335 nm."""
    if nm < 255 or nm > 335:
        return 0.0
    return _interp(VITAMIN_D_ACTION, nm)


# ---------------------------------------------------------------------------
# 2. Solar geometry
# ---------------------------------------------------------------------------


def solar_declination(day_of_year: int) -> float:
    """Solar declination in degrees (Cooper 1969)."""
    return 23.45 * math.sin(math.radians(360.0 / 365.0 * (284 + day_of_year)))


def equation_of_time(day_of_year: int) -> float:
    """Equation of time in minutes (NOAA approximation)."""
    b = 2.0 * math.pi * (day_of_year - 81) / 364.0
    return 9.87 * math.sin(2 * b) - 7.53 * math.cos(b) - 1.5 * math.sin(b)


def solar_zenith(latitude: float, day_of_year: int, solar_hour: float) -> float:
    """Solar zenith angle in degrees for a local *solar* hour (0-24)."""
    decl = math.radians(solar_declination(day_of_year))
    lat = math.radians(latitude)
    ha = math.radians(15.0 * (solar_hour - 12.0))
    cos_z = (
        math.sin(lat) * math.sin(decl) + math.cos(lat) * math.cos(decl) * math.cos(ha)
    )
    return math.degrees(math.acos(max(-1.0, min(1.0, cos_z))))


def solar_elevation(latitude: float, day_of_year: int, solar_hour: float) -> float:
    """Solar elevation angle in degrees (90 - zenith)."""
    return 90.0 - solar_zenith(latitude, day_of_year, solar_hour)


def air_mass(zenith_deg: float) -> float:
    """Kasten-Young relative optical air mass (dimensionless)."""
    z = min(96.07995, max(0.0, zenith_deg))
    return 1.0 / (
        math.cos(math.radians(z)) + 0.50572 * (96.07995 - z) ** -1.6364
    )


def solar_elevation_from_shadow(height_m: float, shadow_m: float) -> float:
    """William's shadow-ratio clinometer: α = atan(height / shadow)."""
    if height_m <= 0 or shadow_m <= 0:
        return 0.0
    return math.degrees(math.atan(height_m / shadow_m))


def shadow_ratio_from_elevation(elevation_deg: float) -> float:
    """Inverse of :func:`solar_elevation_from_shadow` for rendering."""
    return 1.0 / math.tan(math.radians(max(0.5, elevation_deg)))


# ---------------------------------------------------------------------------
# 3. Ground-level UV spectrum and UV Index
# ---------------------------------------------------------------------------


def ground_uv_spectrum(
    zenith: float = 30.0,
    ozone_du: float = 300.0,
    altitude_m: float = 0.0,
    albedo: float = 0.05,
    aerosol_tau: float = 0.05,
    step_nm: int = 1,
) -> list[dict[str, float]]:
    """Ground-level UV spectral irradiance from 290 to 400 nm.

    Each returned row contains ``nm`` and the three weighted products used by
    the dosimetry chain: ``e`` (irradiance), ``ery`` (erythema-weighted) and
    ``vitd`` (previtamin-D3-weighted).
    """
    m = air_mass(zenith)
    pressure_ratio = math.exp(-max(0.0, altitude_m) / 8434.0)
    m_rayleigh = m * pressure_ratio
    ozone_column = 2.687e16 * ozone_du  # molecules per cm^2

    rows: list[dict[str, float]] = []
    for nm in range(290, 401, step_nm):
        f0 = _interp_map(AM0_IRRADIANCE, nm)
        sigma = _interp_map(OZONE_SIGMA, nm)
        tau_ozone = sigma * ozone_column
        tau_rayleigh = RAYLEIGH_TAU * (nm / 1000.0) ** -4.08 * m_rayleigh
        tau_aerosol = aerosol_tau * (nm / 500.0) ** -1.3 * m_rayleigh
        transmit = math.exp(
            -tau_ozone * m * OZONE_PATH_FACTOR - tau_rayleigh - tau_aerosol
        )
        reflect = 1.0 + albedo * 0.5
        e = f0 * transmit * reflect
        rows.append(
            {
                "nm": float(nm),
                "e": e,
                "ery": e * erythema_action(nm),
                "vitd": e * vitamin_d_action(nm),
            }
        )
    return rows


def uv_index_from_geometry(
    elevation_deg: float = 60.0,
    ozone_du: float = 300.0,
    altitude_m: float = 0.0,
    albedo: float = 0.05,
    aerosol_tau: float = 0.05,
) -> float:
    """Clear-sky UV Index for a given solar elevation angle."""
    if elevation_deg <= 0:
        return 0.0
    zenith = 90.0 - min(90.0, elevation_deg)
    spectrum = ground_uv_spectrum(
        zenith=zenith,
        ozone_du=ozone_du,
        altitude_m=altitude_m,
        albedo=albedo,
        aerosol_tau=aerosol_tau,
    )
    # Each row is *per nanometre*; integrate over the 1 nm bin width.
    bin_width_nm = spectrum[1]["nm"] - spectrum[0]["nm"] if len(spectrum) > 1 else 1.0
    erythemal = sum(row["ery"] for row in spectrum) * bin_width_nm
    return round(UVI_CALIBRATION * erythemal / UVI_TO_ERYTHEMAL_WM2, 2)


def uv_index_from_shadow(
    height_m: float = 1.0,
    shadow_m: float = 1.0,
    ozone_du: float = 300.0,
    altitude_m: float = 0.0,
    albedo: float = 0.05,
) -> dict[str, float]:
    """Off-grid UV Index from a William's shadow-ratio measurement."""
    elevation = solar_elevation_from_shadow(height_m, shadow_m)
    uvi = uv_index_from_geometry(
        elevation_deg=elevation,
        ozone_du=ozone_du,
        altitude_m=altitude_m,
        albedo=albedo,
    )
    return {
        "elevation_deg": round(elevation, 2),
        "uv_index": uvi,
        "shadow_ratio": round(shadow_m / max(0.01, height_m), 3),
    }


def uv_index_from_lux(
    lux: float, elevation_deg: float = 50.0, altitude_m: float = 0.0
) -> float:
    """Empirical lux -> UV Index estimate (ambient-light-sensor fallback).

    Global illuminance of ~100 000 lx corresponds to UVI ~11.6 at a high Sun;
    erythemal UV collapses with a sin(elevation)^2.4 gate as the Sun drops.
    """
    if lux <= 0:
        return 0.0
    lux_uvi = (lux / 100_000.0) * 11.6
    sin_e = max(0.0, math.sin(math.radians(max(0.0, elevation_deg))))
    return round(lux_uvi * sin_e**2.4 * altitude_multiplier(altitude_m), 2)


def vitamin_d_spectral_ratio(
    elevation_deg: float,
    ozone_du: float = 300.0,
    altitude_m: float = 0.0,
    albedo: float = 0.05,
) -> float:
    """Previtamin-D3 : erythema spectral ratio, normalised to overhead Sun."""
    if elevation_deg <= 0:
        return 0.0
    spectrum = ground_uv_spectrum(
        zenith=90.0 - min(90.0, elevation_deg),
        ozone_du=ozone_du,
        altitude_m=altitude_m,
        albedo=albedo,
    )
    bin_width_nm = spectrum[1]["nm"] - spectrum[0]["nm"] if len(spectrum) > 1 else 1.0
    ery = sum(row["ery"] for row in spectrum) * bin_width_nm
    vitd = sum(row["vitd"] for row in spectrum) * bin_width_nm
    if ery <= 0:
        return 0.0
    return (vitd / ery) / _VITD_REFERENCE_RATIO


def altitude_multiplier(altitude_m: float) -> float:
    """+4 % UV per 300 m => 1.04 ** (Δm / 300)."""
    return 1.04 ** (max(0.0, altitude_m) / 300.0)


def albedo_multiplier(albedo: float) -> float:
    """Standing-person albedo boost, ≈ half the surface albedo returning."""
    return 1.0 + max(0.0, min(1.0, albedo)) * 0.5


# ---------------------------------------------------------------------------
# 4. Fitzpatrick MED and dosimetry
# ---------------------------------------------------------------------------

#: (ITA°, MED J/m^2, phototype) anchors from Fitzpatrick 1975 calibrated to the
#: Chardon ITA° scale. MED is linearly interpolated between anchors.
MED_ANCHORS: tuple[tuple[float, float, str], ...] = (
    (70, 200, "I"),
    (55, 225, "I/II"),
    (41, 300, "II"),
    (28, 400, "III"),
    (10, 550, "IV"),
    (-10, 800, "V"),
    (-30, 1050, "V/VI"),
    (-60, 1200, "VI"),
)


def med_from_ita(ita: float) -> float:
    """Minimal Erythemal Dose in J/m^2 from an ITA° angle."""
    anchors = MED_ANCHORS
    if ita >= anchors[0][0]:
        return anchors[0][1]
    for (hi_ita, hi_med, _), (lo_ita, lo_med, _) in zip(anchors, anchors[1:]):
        if lo_ita <= ita <= hi_ita:
            t = (hi_ita - ita) / (hi_ita - lo_ita)
            return round(hi_med + t * (lo_med - hi_med), 1)
    return anchors[-1][1]


def burn_dosimetry(
    med_jm2: float,
    uv_index: float,
    spf: float = 1.0,
    albedo: float = 0.05,
    altitude_m: float = 0.0,
    altitude_in_uvi: bool = False,
) -> dict[str, float | None]:
    """Erythemal dose rate and minutes to 1.0 MED."""
    albedo_mul = albedo_multiplier(albedo)
    alt_mul = 1.0 if altitude_in_uvi else altitude_multiplier(altitude_m)
    effective_spf = max(1.0, spf)
    ery_wm2 = uv_index * UVI_TO_ERYTHEMAL_WM2 * albedo_mul * alt_mul / effective_spf
    j_per_min = ery_wm2 * 60.0
    minutes = med_jm2 / j_per_min if j_per_min > 0 else None
    unprotected = (
        med_jm2 / (uv_index * UVI_TO_ERYTHEMAL_WM2 * albedo_mul * alt_mul * 60.0)
        if uv_index > 0
        else None
    )
    return {
        "erythemal_wm2": round(ery_wm2, 5),
        "joules_per_min": round(j_per_min, 4),
        "effective_spf": round(effective_spf, 1),
        "albedo_multiplier": round(albedo_mul, 3),
        "altitude_multiplier": round(alt_mul, 3),
        "minutes_to_med": round(minutes, 1) if minutes is not None else None,
        "minutes_to_med_unprotected": (
            round(unprotected, 1) if unprotected is not None else None
        ),
    }


def vitamin_d_timer(
    med_jm2: float,
    uv_index: float,
    bsa_fraction: float = 0.35,
    spf: float = 1.0,
    elevation_deg: float = 55.0,
    albedo: float = 0.05,
    altitude_m: float = 0.0,
    ozone_du: float = 300.0,
    target_iu: float = 1000.0,
    altitude_in_uvi: bool = False,
) -> dict[str, float | None]:
    """Minutes to synthesise ``target_iu`` of previtamin D3 (Holick model).

    Sunscreen attenuates cutaneous vitamin-D synthesis far less than erythema;
    the transmission exponent -0.28 reproduces that asymmetry.
    """
    albedo_mul = albedo_multiplier(albedo)
    alt_mul = 1.0 if altitude_in_uvi else altitude_multiplier(altitude_m)
    ery_wm2 = uv_index * UVI_TO_ERYTHEMAL_WM2 * albedo_mul * alt_mul

    vitd_transmission = max(1.0, spf) ** -0.28
    spectral_ratio = vitamin_d_spectral_ratio(elevation_deg, ozone_du, 0.0, 0.0)
    bsa_scale = max(0.02, min(1.2, bsa_fraction))

    med_per_min = (ery_wm2 * 60.0 / med_jm2) if med_jm2 > 0 else 0.0
    iu_per_min = (
        IU_PER_FULL_BODY_MED
        * med_per_min
        * bsa_scale
        * spectral_ratio
        * vitd_transmission
    )
    minutes = target_iu / iu_per_min if iu_per_min > 0 else None
    return {
        "iu_per_min": round(iu_per_min, 1),
        "minutes_to_target": round(minutes, 1) if minutes is not None else None,
        "spectral_ratio": round(spectral_ratio, 3),
        "vitamin_d_transmission": round(vitd_transmission, 3),
        "bsa_scale": round(bsa_scale, 3),
        "erythemal_wm2": round(ery_wm2, 5),
    }


# ---------------------------------------------------------------------------
# 5. Composite advisory (the object the API returns)
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class SolarAdvisory:
    """Complete solar advisory payload."""

    med: float
    phototype: str
    uv_index: float
    band: str
    minutes_to_med: float | None
    minutes_to_med_unprotected: float | None
    minutes_to_vitd: float | None
    iu_per_min: float
    safe_window_min: float | None
    optimal_window_min: float | None
    can_synthesize: bool
    burn: dict
    vitd: dict


def _phototype_from_ita(ita: float) -> str:
    if ita > 55:
        return "I"
    if ita > 41:
        return "II"
    if ita > 28:
        return "III"
    if ita > 10:
        return "IV"
    if ita > -30:
        return "V"
    return "VI"


def _uv_band(uvi: float) -> str:
    if uvi >= 11:
        return "extreme"
    if uvi >= 8:
        return "very-high"
    if uvi >= 6:
        return "high"
    if uvi >= 3:
        return "moderate"
    if uvi > 0:
        return "low"
    return "none"


def solar_advisory(
    uv_index: float,
    ita: float,
    bsa_fraction: float = 0.35,
    spf: float = 1.0,
    albedo: float = 0.05,
    altitude_m: float = 0.0,
    elevation_deg: float = 55.0,
    ozone_du: float = 300.0,
    target_iu: float = 1000.0,
    altitude_in_uvi: bool = False,
) -> dict:
    """Full solar advisory: burn countdown, vitamin-D window, safe window."""
    med = med_from_ita(ita)
    burn = burn_dosimetry(
        med_jm2=med,
        uv_index=uv_index,
        spf=spf,
        albedo=albedo,
        altitude_m=altitude_m,
        altitude_in_uvi=altitude_in_uvi,
    )
    vitd = vitamin_d_timer(
        med_jm2=med,
        uv_index=uv_index,
        bsa_fraction=bsa_fraction,
        spf=spf,
        elevation_deg=elevation_deg,
        albedo=albedo,
        altitude_m=altitude_m,
        ozone_du=ozone_du,
        target_iu=target_iu,
        altitude_in_uvi=altitude_in_uvi,
    )

    burn_min = burn["minutes_to_med"]
    vitd_min = vitd["minutes_to_target"]
    burn_f = burn_min if burn_min is not None else math.inf
    vitd_f = vitd_min if vitd_min is not None else math.inf
    safe = min(burn_f, max(vitd_f, 5.0))
    optimal = min(burn_f * 0.9, max(vitd_f * 1.15, 4.0))

    advisory = SolarAdvisory(
        med=med,
        phototype=_phototype_from_ita(ita),
        uv_index=uv_index,
        band=_uv_band(uv_index),
        minutes_to_med=burn_min,
        minutes_to_med_unprotected=burn["minutes_to_med_unprotected"],
        minutes_to_vitd=vitd_min,
        iu_per_min=vitd["iu_per_min"],
        safe_window_min=round(safe, 1) if math.isfinite(safe) else None,
        optimal_window_min=round(optimal, 1) if math.isfinite(optimal) else None,
        can_synthesize=vitd["iu_per_min"] > 0.5,
        burn=burn,
        vitd=vitd,
    )
    return asdict(advisory)
