"""Self-test + parity harness for the Python photobiology kernel.

Run with::

    python3 python_photobiology/selftest.py            # unit assertions
    python3 python_photobiology/selftest.py --json     # machine-readable export

The JSON mode emits a parameter sweep (`PARITY_GRID`) that
``scripts/parity-check.mjs`` replays through the JavaScript mirror
(`src/lib/engines/photobiology.js`) and diffs. Any divergence fails CI, which is
what lets the Android APK claim bit-identical dosimetry while offline.
"""

from __future__ import annotations

import json
import math
import sys

sys.path.insert(0, str(__file__.rsplit("/", 2)[0]))

from python_photobiology.med_erythema_vitd import (  # noqa: E402
    air_mass,
    albedo_multiplier,
    altitude_multiplier,
    burn_dosimetry,
    erythema_action,
    med_from_ita,
    solar_advisory,
    solar_elevation_from_shadow,
    solar_zenith,
    uv_index_from_geometry,
    uv_index_from_shadow,
    vitamin_d_spectral_ratio,
    vitamin_d_timer,
)
from python_photobiology.spf_film_kinetics import (  # noqa: E402
    audit_filters,
    reapply_minute,
    spf_decay_curve,
    spf_film_integrity,
)

#: Parameter sweep replayed by the JS parity harness.
PARITY_GRID = {
    "uv_index": [0.0, 1.5, 3.0, 5.5, 7.4, 9.0, 11.5, 14.0],
    "ita": [70.0, 55.0, 52.4, 41.0, 28.0, 21.5, 10.0, -10.0, -34.0, -60.0],
    "spf": [1.0, 15.0, 30.0, 50.0],
    "albedo": [0.05, 0.15, 0.25, 0.8],
    "altitude_m": [0.0, 800.0, 1650.0, 3000.0, 4000.0],
    "elevation_deg": [10.0, 30.0, 55.0, 75.0, 90.0],
    "bsa": [0.1, 0.35, 0.75, 0.9],
}


def assert_close(actual, expected, tol, label):
    if actual is None or (isinstance(expected, (int, float)) and actual is None):
        raise AssertionError(f"{label}: actual is None")
    if abs(float(actual) - float(expected)) > tol:
        raise AssertionError(f"{label}: {actual} != {expected} (±{tol})")


def test_action_spectra():
    assert_close(erythema_action(310), 1.0, 1e-6, "erythema peak")
    assert erythema_action(290) < erythema_action(300)
    assert erythema_action(400) < 0.01
    print("  ✓ erythemal action spectrum anchored at 310 nm")


def test_air_mass():
    assert_close(air_mass(0), 1.0, 1e-3, "air mass at zenith")
    # Kasten-Young gives m ≈ 38 at 90° elevation horizon
    assert 35 < air_mass(90) < 40, air_mass(90)
    print("  ✓ Kasten-Young air mass")


def test_solar_geometry():
    # Equator, equinox, solar noon → elevation ≈ 90°
    assert_close(solar_zenith(0.0, 80, 12.0), 0.0, 1.5, "equinox noon zenith")
    # Nairobi, June solstice noon → elevation ≈ 66.5°
    elev = 90 - solar_zenith(-1.29, 172, 12.0)
    assert 63 < elev < 70, elev
    print("  ✓ solar geometry (equinox + Nairobi solstice)")


def test_shadow_clinometer():
    assert_close(solar_elevation_from_shadow(1, 1), 45.0, 1e-6, "45° shadow")
    r = uv_index_from_shadow(height_m=1.75, shadow_m=0.9, altitude_m=1650)
    assert r["elevation_deg"] > 60
    assert r["uv_index"] > 3
    print(f"  ✓ William's shadow clinometer → α {r['elevation_deg']}° UVI {r['uv_index']}")


def test_uv_index_monotonic():
    prev = -1.0
    for elev in (5, 15, 30, 45, 60, 75, 90):
        uvi = uv_index_from_geometry(elevation_deg=elev, ozone_du=300)
        assert uvi >= prev, (elev, uvi, prev)
        prev = uvi
    overhead = uv_index_from_geometry(elevation_deg=90, ozone_du=300)
    assert 9 < overhead < 16, overhead
    print(f"  ✓ UV Index monotonic in elevation · overhead {overhead}")


def test_uv_index_altitude_ozone():
    low = uv_index_from_geometry(elevation_deg=60, altitude_m=0)
    high = uv_index_from_geometry(elevation_deg=60, altitude_m=3000)
    assert high > low, (low, high)
    thin = uv_index_from_geometry(elevation_deg=60, ozone_du=250)
    thick = uv_index_from_geometry(elevation_deg=60, ozone_du=400)
    assert thin > thick, (thin, thick)
    print(f"  ✓ altitude {low:.2f}→{high:.2f} · ozone 250DU {thin:.2f} > 400DU {thick:.2f}")


def test_multipliers():
    assert_close(altitude_multiplier(300), 1.04, 1e-9, "altitude +4%/300m")
    assert_close(altitude_multiplier(0), 1.0, 1e-9, "altitude sea level")
    assert_close(albedo_multiplier(0.8), 1.4, 1e-9, "snow albedo")
    assert_close(albedo_multiplier(0.05), 1.025, 1e-9, "grass albedo")
    print("  ✓ altitude +4 %/300 m and albedo multipliers")


def test_med():
    assert_close(med_from_ita(70), 200, 1e-6, "MED type I")
    assert_close(med_from_ita(-60), 1200, 1e-6, "MED type VI")
    mid = med_from_ita(28)
    assert 395 <= mid <= 405, mid
    # MED must fall monotonically as ITA° rises (lighter skin = lower threshold),
    # i.e. the sequence is non-increasing when walking from deep to light.
    prev = math.inf
    for ita in (-60, -30, -10, 0, 10, 28, 41, 55, 70):
        m = med_from_ita(ita)
        assert m <= prev, (ita, m, prev)
        prev = m
    print("  ✓ Fitzpatrick MED 200-1200 J/m² monotonic in ITA°")


def test_burn_dosimetry():
    d = burn_dosimetry(med_jm2=300, uv_index=8, spf=1)
    # 8 UVI → 0.2 W/m² → 12 J/m²/min → 25 min to 300 J/m²
    assert 24 < d["minutes_to_med"] < 26, d["minutes_to_med"]
    protected = burn_dosimetry(med_jm2=300, uv_index=8, spf=30)
    assert protected["minutes_to_med"] > d["minutes_to_med"] * 25
    print(f"  ✓ burn dosimetry · {d['minutes_to_med']} min unprotected, {protected['minutes_to_med']} min SPF30")


def test_vitamin_d():
    v = vitamin_d_timer(med_jm2=300, uv_index=8, bsa_fraction=0.35, elevation_deg=60)
    assert v["iu_per_min"] > 0
    assert v["minutes_to_target"] is not None
    # sunscreen must attenuate vitamin D far less than erythema
    with_spf = vitamin_d_timer(med_jm2=300, uv_index=8, spf=50, elevation_deg=60)
    assert with_spf["iu_per_min"] > v["iu_per_min"] / 6, (
        with_spf["iu_per_min"], v["iu_per_min"]
    )
    ratio_low = vitamin_d_spectral_ratio(15)
    ratio_high = vitamin_d_spectral_ratio(85)
    assert ratio_high > ratio_low
    print(f"  ✓ Holick synthesis {v['iu_per_min']} IU/min → {v['minutes_to_target']} min for 1000 IU")


def test_advisory_consistency():
    a = solar_advisory(uv_index=7.4, ita=52.4, bsa_fraction=0.35, spf=30, altitude_m=1650)
    assert a["minutes_to_med"] is not None
    assert a["minutes_to_vitd"] is not None
    assert a["safe_window_min"] <= a["minutes_to_med"]
    assert a["band"] == "high"
    assert a["phototype"] == "II"
    print(
        f"  ✓ advisory · MED {a['minutes_to_med']} min · vitD {a['minutes_to_vitd']} min · band {a['band']}"
    )


def test_spf_kinetics():
    s0 = spf_film_integrity(minutes=0, spf=30)
    assert_close(s0["protection_remaining"], 100.0, 0.2, "t=0 protection")
    s60 = spf_film_integrity(minutes=60, spf=30, filter_key="avobenzone_unstabilized")
    s60s = spf_film_integrity(minutes=60, spf=30, filter_key="avobenzone_stabilized")
    assert s60s["protection_remaining"] > s60["protection_remaining"]
    swim = spf_film_integrity(minutes=60, spf=30, activity="swim")
    rest = spf_film_integrity(minutes=60, spf=30, activity="rest")
    assert rest["protection_remaining"] > swim["protection_remaining"]
    stable = spf_film_integrity(minutes=180, spf=30, filter_key="zinc_oxide")
    assert stable["protection_remaining"] > swim["protection_remaining"]
    print(
        f"  ✓ bi-exponential film · unstable {s60['protection_remaining']}% vs "
        f"stable {s60s['protection_remaining']}% at 60 min"
    )


def test_reapply_and_curve():
    r = reapply_minute(threshold_pct=40, spf=30, filter_key="avobenzone_unstabilized")
    assert r is not None and 30 < r < 90, r
    curve = spf_decay_curve(horizon=120, step=10, spf=30)
    assert len(curve) == 13, len(curve)
    assert curve[0]["protection_remaining"] >= curve[-1]["protection_remaining"]
    print(f"  ✓ reapply alarm at {r} min · decay curve monotone")


def test_rule_pack():
    bad = audit_filters(
        filters=["avobenzone", "octinoxate", "oxybenzone", "homosalate"],
        stabilisers=[],
    )
    ids = {f["id"] for f in bad["findings"]}
    assert {"PHOTO-1", "PHOTO-2", "PHOTO-4", "PHOTO-12"} <= ids, ids
    assert not bad["broad_spectrum"]

    good = audit_filters(
        filters=["zinc_oxide", "bemotrizinol", "dhhb"],
        stabilisers=["bemotrizinol"],
        has_iron_oxide=True,
    )
    good_ids = {f["id"] for f in good["findings"]}
    assert "PHOTO-1" not in good_ids
    assert "PHOTO-2" not in good_ids
    assert good["broad_spectrum"]
    assert good["score"] is not None and good["score"] > bad["score"]
    print(f"  ✓ rule pack · unstable score {bad['score']} < stable {good['score']}")


def export_parity():
    """Emit the parameter sweep the JS mirror must reproduce."""
    cases = []
    for uvi in PARITY_GRID["uv_index"]:
        for ita in PARITY_GRID["ita"]:
            for spf in PARITY_GRID["spf"]:
                for albedo in PARITY_GRID["albedo"]:
                    for alt in PARITY_GRID["altitude_m"]:
                        for elev in PARITY_GRID["elevation_deg"]:
                            for bsa in PARITY_GRID["bsa"]:
                                adv = solar_advisory(
                                    uv_index=uvi,
                                    ita=ita,
                                    bsa_fraction=bsa,
                                    spf=spf,
                                    albedo=albedo,
                                    altitude_m=alt,
                                    elevation_deg=elev,
                                )
                                cases.append(
                                    {
                                        "in": {
                                            "uv_index": uvi,
                                            "ita": ita,
                                            "spf": spf,
                                            "albedo": albedo,
                                            "altitude_m": alt,
                                            "elevation_deg": elev,
                                            "bsa": bsa,
                                        },
                                        "out": {
                                            "med": adv["med"],
                                            "minutes_to_med": adv["minutes_to_med"],
                                            "minutes_to_vitd": adv["minutes_to_vitd"],
                                            "iu_per_min": adv["iu_per_min"],
                                            "safe_window_min": adv["safe_window_min"],
                                        },
                                    }
                                )
    spf_cases = []
    for key in ("avobenzone_unstabilized", "avobenzone_stabilized", "zinc_oxide", "octinoxate"):
        for act in ("rest", "walk", "sport", "swim"):
            for min_ in (0, 30, 60, 120, 180):
                spf_cases.append(
                    {
                        "in": {"minutes": min_, "spf": 30, "activity": act, "filter_key": key},
                        "out": spf_film_integrity(
                            minutes=min_, spf=30, activity=act, filter_key=key
                        ),
                    }
                )
    print(
        json.dumps(
            {"solar_cases": cases, "spf_cases": spf_cases, "cases": len(cases)},
            indent=0,
        )
    )


def main(argv: list[str]) -> int:
    if "--json" in argv:
        export_parity()
        return 0

    tests = [
        test_action_spectra,
        test_air_mass,
        test_solar_geometry,
        test_shadow_clinometer,
        test_uv_index_monotonic,
        test_uv_index_altitude_ozone,
        test_multipliers,
        test_med,
        test_burn_dosimetry,
        test_vitamin_d,
        test_advisory_consistency,
        test_spf_kinetics,
        test_reapply_and_curve,
        test_rule_pack,
    ]
    print(f"DERMA-SHIELD photobiology self-test ({len(tests)} suites)")
    failures = 0
    for fn in tests:
        try:
            fn()
        except AssertionError as exc:
            failures += 1
            print(f"  ✗ {fn.__name__}: {exc}")
    print(f"\n{'PASS' if failures == 0 else 'FAIL'} — {len(tests) - failures}/{len(tests)} suites")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
