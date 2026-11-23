"""DERMA-SHIELD photobiology package.

Pure-Python 3.12 photobiology kernel that backs the Vercel Python runtime.

Modules
-------
med_erythema_vitd
    McKinlay-Diffey erythemal action spectrum, Kasten-Young air mass, ozone and
    Rayleigh attenuation, Fitzpatrick MED, Holick previtamin-D3 synthesis,
    albedo/altitude multipliers and William's shadow clinometer.
spf_film_kinetics
    Bi-exponential sunscreen film breakdown (sweat wash-off + UV photolysis),
    reapplication scheduling and a 14-rule photostability rule pack shared with
    the JavaScript auditor so offline and online verdicts cannot diverge.

All numeric constants are traced to primary literature in the module docstrings.
Zero third-party dependencies: the package runs on a bare CPython 3.12.
"""

from .med_erythema_vitd import (  # noqa: F401
    erythema_action,
    vitamin_d_action,
    air_mass,
    solar_zenith,
    solar_elevation,
    uv_index_from_geometry,
    uv_index_from_shadow,
    med_from_ita,
    burn_dosimetry,
    vitamin_d_timer,
    solar_advisory,
)
from .spf_film_kinetics import (  # noqa: F401
    spf_film_integrity,
    spf_decay_curve,
    reapply_minute,
    audit_filters,
)

__all__ = [
    "erythema_action",
    "vitamin_d_action",
    "air_mass",
    "solar_zenith",
    "solar_elevation",
    "uv_index_from_geometry",
    "uv_index_from_shadow",
    "med_from_ita",
    "burn_dosimetry",
    "vitamin_d_timer",
    "solar_advisory",
    "spf_film_integrity",
    "spf_decay_curve",
    "reapply_minute",
    "audit_filters",
]

__version__ = "1.0.0"
