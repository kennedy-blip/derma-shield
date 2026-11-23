"""Sunscreen film photostability kinematics and the shared rules pack.

The film on skin is modelled as a bi-exponential decay with two independent
loss channels:

    I(t) = f_fast · exp(-t / τ_fast) + (1 - f_fast) · exp(-t / τ_slow)

``τ_fast``  sweat / water wash-off — driven by activity level and the label's
            water-resistance claim (80 min ratings roughly triple τ_fast).
``τ_slow``  UV-filter photolysis — derived from the filter's half-life under
            1 MED of simulated sunlight, so an unstabilised avobenzone film
            (t½ ≈ 55 min) collapses while bemotrizinol (t½ ≈ 760 min) holds.

The effective SPF at time *t* uses the standard dose-additivity relation
SPF_eff(t) = 1 + (SPF_label - 1)·I(t), and "protection remaining" is reported as
a percentage of the label claim so the UI can drive a single reapply threshold.

The rule pack (:func:`audit_filters`) is the Python twin of
``src/lib/engines/sunscreen-auditor.js``. Both emit identical finding IDs, so a
formulation audited offline in the APK and online on Vercel cannot disagree.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict

__all__ = [
    "FILTER_HALF_LIFE_MIN",
    "ACTIVITY_PROFILES",
    "spf_film_integrity",
    "spf_decay_curve",
    "reapply_minute",
    "audit_filters",
    "REEF_BANNED_FILTERS",
    "PHOTOSTABILISERS",
]

#: Photolysis half-life (minutes) of an applied film of each filter.
FILTER_HALF_LIFE_MIN: dict[str, float] = {
    "avobenzone_unstabilized": 55.0,
    "avobenzone_stabilized": 260.0,
    "octinoxate": 95.0,
    "octocrylene": 420.0,
    "bemotrizinol": 760.0,
    "bisdisulizole": 1300.0,
    "zinc_oxide": math.inf,
    "titanium_dioxide": math.inf,
    "ecamsule": 1500.0,
    "ensulizole": 240.0,
    "homosalate": 300.0,
    "octisalate": 380.0,
    "padimate_o": 210.0,
    "drometrizole_trisiloxane": 620.0,
    "trolamine_salicylate": 340.0,
    "paba": 120.0,
}

#: Fast-decay time constant (minutes) per activity level.
ACTIVITY_PROFILES: dict[str, dict[str, float | str]] = {
    "rest": {"wash_tau": 92.0, "label": "Resting / Shade"},
    "walk": {"wash_tau": 68.0, "label": "Walking"},
    "sport": {"wash_tau": 44.0, "label": "Running / Sport"},
    "swim": {"wash_tau": 26.0, "label": "Swimming / Water"},
}

REEF_BANNED_FILTERS: frozenset[str] = frozenset({"oxybenzone", "octinoxate"})

PHOTOSTABILISERS: frozenset[str] = frozenset(
    {
        "bemotrizinol",
        "octocrylene",
        "tinosorb_s",
        "desm",
        "bisoctrizole",
        "drometrizole_trisiloxane",
        "bisdisulizole",
        "ecamsule",
        "dhhb",
    }
)


def spf_film_integrity(
    minutes: float,
    spf: float = 30.0,
    activity: str = "walk",
    filter_key: str = "avobenzone_unstabilized",
    water_resistance_min: float = 40.0,
    coverage: float = 1.0,
) -> dict[str, float | None]:
    """Film integrity in [0, 1] after ``minutes`` of exposure.

    Parameters
    ----------
    minutes
        Elapsed exposure time in minutes.
    spf
        Label SPF of the product.
    activity
        One of ``rest``, ``walk``, ``sport``, ``swim``.
    filter_key
        Key into :data:`FILTER_HALF_LIFE_MIN`.
    water_resistance_min
        Label claim in minutes; 0 means "not water resistant".
    coverage
        Application thickness fraction (0.5 = half the tested 2 mg/cm^2 dose).
    """
    t = max(0.0, minutes)
    profile = ACTIVITY_PROFILES.get(activity, ACTIVITY_PROFILES["walk"])
    half_life = FILTER_HALF_LIFE_MIN.get(filter_key, 300.0)

    tau_slow = half_life / math.log(2) if math.isfinite(half_life) else 1e9
    water_penalty = (
        max(0.55, 1.0 - t / (water_resistance_min * 3.2))
        if water_resistance_min > 0
        else 1.0
    )
    tau_fast = max(8.0, float(profile["wash_tau"]) * water_penalty)

    f_fast = 0.42 + 0.18 * min(1.0, max(0.0, (30.0 - water_resistance_min) / 30.0))
    integrity = f_fast * math.exp(-t / tau_fast) + (1 - f_fast) * math.exp(-t / tau_slow)
    clamped = max(0.0, min(1.0, integrity)) * max(0.0, min(1.2, coverage))

    effective_spf = 1.0 + (max(1.0, spf) - 1.0) * clamped
    protection = (
        100.0 * (effective_spf - 1.0) / (spf - 1.0) if spf > 1 else 100.0 * clamped
    )

    return {
        "minutes": t,
        "integrity": round(clamped, 4),
        "protection_remaining": round(max(0.0, min(100.0, protection)), 1),
        "effective_spf": round(effective_spf, 1),
        "tau_fast": round(tau_fast, 1),
        "tau_slow": round(tau_slow, 1) if math.isfinite(tau_slow) else None,
        "photolysis_half_life": half_life if math.isfinite(half_life) else None,
    }


def spf_decay_curve(
    horizon: float = 180.0, step: float = 2.0, **kwargs
) -> list[dict[str, float | None]]:
    """Sample :func:`spf_film_integrity` from 0 to ``horizon`` minutes."""
    curve: list[dict[str, float | None]] = []
    t = 0.0
    while t <= horizon + 1e-9:
        curve.append(spf_film_integrity(minutes=t, **kwargs))
        t += step
    return curve


def reapply_minute(
    threshold_pct: float = 40.0, horizon: float = 480.0, **kwargs
) -> int | None:
    """First whole minute at which remaining protection crosses the threshold."""
    for t in range(0, int(horizon) + 1):
        state = spf_film_integrity(minutes=float(t), **kwargs)
        if float(state["protection_remaining"] or 0.0) <= threshold_pct:
            return t
    return None


# ---------------------------------------------------------------------------
# Formulation rules pack
# ---------------------------------------------------------------------------


def audit_filters(
    filters: list[str],
    stabilisers: list[str] | None = None,
    has_iron_oxide: bool = False,
    retinoids: list[str] | None = None,
    acids: list[str] | None = None,
    comedogenic: dict[str, int] | None = None,
) -> dict:
    """Run the shared 14-rule photostability pack over a resolved filter set.

    ``filters`` should use canonical ids (``avobenzone``, ``octinoxate``,
    ``zinc_oxide`` ...). Finding IDs match the JavaScript auditor exactly.
    """
    stabilisers = stabilisers or []
    retinoids = retinoids or []
    acids = acids or []
    comedogenic = comedogenic or {}

    findings: list[dict] = []
    fset = set(filters)
    has_stab = bool(set(stabilisers) & PHOTOSTABILISERS)
    unmodified_stab = set(stabilisers) & PHOTOSTABILISERS

    if "avobenzone" in fset and not has_stab:
        findings.append(
            {
                "id": "PHOTO-1",
                "severity": "critical",
                "title": "Unstabilised Avobenzone - UVA protection collapses in sunlight",
                "detail": (
                    "Avobenzone without a triplet quencher undergoes keto-enol "
                    "tautomerism and loses up to 60 percent of its UVA1 absorbance "
                    "within 60 minutes. Add bemotrizinol, octocrylene or DESM."
                ),
                "metrics": {"half_life_min": 55},
            }
        )
    elif "avobenzone" in fset and has_stab:
        findings.append(
            {
                "id": "PHOTO-1b",
                "severity": "good",
                "title": "Avobenzone is photostabilised",
                "detail": "Quencher pool: " + ", ".join(sorted(unmodified_stab)),
                "metrics": {"stabilisers": len(unmodified_stab)},
            }
        )

    for partner in ("octinoxate", "padimate_o", "cinoxate"):
        if "avobenzone" in fset and partner in fset:
            findings.append(
                {
                    "id": "PHOTO-2",
                    "severity": "critical",
                    "title": f"[2+2] cycloaddition partner detected - {partner}",
                    "detail": (
                        "The cinnamate family consumes avobenzone through triplet "
                        "energy transfer and [2+2] cycloaddition, gutting the UVA1 "
                        "band even when the SPF number looks healthy."
                    ),
                    "metrics": {"uva_half_life_min": 42},
                }
            )

    if "oxybenzone" in fset:
        findings.append(
            {
                "id": "PHOTO-4",
                "severity": "warning",
                "title": "Oxybenzone (Benzophenone-3) present",
                "detail": (
                    "Photolabile, a frequent contact photoallergen, with measurable "
                    "endocrine activity and a reef-toxin ban in Hawaii and Palau."
                ),
                "metrics": {"coral_risk": 5, "endocrine_risk": 4},
            }
        )

    has_uva1 = any(
        f in {"zinc_oxide", "bemotrizinol", "bisoctrizole", "dhhb", "ecamsule"}
        for f in fset
    ) or ("avobenzone" in fset and has_stab)
    has_uvb = any(
        f in {"octinoxate", "octocrylene", "homosalate", "octisalate", "ensulizole",
              "ethylhexyl_triazone", "zinc_oxide", "titanium_dioxide"}
        for f in fset
    )

    if filters and not has_uva1:
        findings.append(
            {
                "id": "PHOTO-5",
                "severity": "critical",
                "title": "UVA1 gap - no filter covers 360-400 nm",
                "detail": (
                    "Long-wave UVA1 drives dermal collagenase and pigment "
                    "darkening; a high SPF number is not broad-spectrum protection."
                ),
                "metrics": {"uva1_coverage": 0},
            }
        )
    if filters and not has_uvb:
        findings.append(
            {
                "id": "PHOTO-6",
                "severity": "warning",
                "title": "UVB coverage is thin",
                "detail": "No UVB-band filter resolved; sunburn protection will be low.",
                "metrics": {},
            }
        )
    if not filters:
        findings.append(
            {
                "id": "PHOTO-0",
                "severity": "info",
                "title": "Not a sunscreen - no approved UV filter resolved",
                "detail": "This is a treatment product; pair it with a broad-spectrum SPF.",
                "metrics": {},
            }
        )

    if retinoids or acids:
        findings.append(
            {
                "id": "PHOTO-8",
                "severity": "critical",
                "title": "Photosensitising active - mandatory morning SPF 50",
                "detail": (
                    "Retinoids and AHAs raise erythemal UV sensitivity by roughly "
                    "+35 percent during the first two weeks of use."
                ),
                "metrics": {"erythemal_sensitivity_gain": 35},
            }
        )

    if "methylisothiazolinone" in fset:
        findings.append(
            {
                "id": "PHOTO-10",
                "severity": "warning",
                "title": "Methylisothiazolinone (MIT) preservative",
                "detail": "Leading cause of cosmetic contact dermatitis; EU-banned in leave-on.",
                "metrics": {},
            }
        )

    load = sum(v for v in comedogenic.values() if v >= 3)
    if load >= 6:
        findings.append(
            {
                "id": "PHOTO-11",
                "severity": "warning" if load >= 8 else "info",
                "title": f"Comedogenic load - aggregate {load}",
                "detail": (
                    "Pore-clogging esters detected: "
                    + ", ".join(f"{k} ({v}/5)" for k, v in comedogenic.items() if v >= 3)
                ),
                "metrics": {"aggregate": load},
            }
        )

    if fset & REEF_BANNED_FILTERS:
        findings.append(
            {
                "id": "PHOTO-12",
                "severity": "warning",
                "title": "Reef-toxin filters detected",
                "detail": (
                    "Banned in Hawaii / Key West / Palau; implicated in coral "
                    "bleaching and larval deformity."
                ),
                "metrics": {"filters": sorted(fset & REEF_BANNED_FILTERS)},
            }
        )

    order = {"critical": 0, "warning": 1, "info": 2, "good": 3}
    findings.sort(key=lambda f: order.get(f["severity"], 9))

    weights = {"critical": 26, "warning": 13, "info": 4, "good": -6}
    penalty = sum(weights.get(f["severity"], 0) for f in findings)
    score = max(0, min(100, int(round(62 - penalty))))

    return {
        "filters": sorted(fset),
        "stabilisers": sorted(unmodified_stab),
        "findings": findings,
        "score": score if filters else None,
        "broad_spectrum": has_uva1 and has_uvb,
        "is_sunscreen": bool(filters),
    }
