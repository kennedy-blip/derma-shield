#!/usr/bin/env node
/**
 * DERMA-SHIELD · parity-check.mjs
 * -----------------------------------------------------------------------------
 * Verifies that the JavaScript photobiology mirror
 * (`src/lib/engines/photobiology.js`) reproduces the Python 3.12 reference
 * kernel (`python_photobiology/`) across the full parameter sweep.
 *
 * Why this exists
 * ---------------
 * The Android `.APK` runs 100 % offline and therefore cannot call the Vercel
 * Python function. Instead it uses the JS mirror. If the two engines drift, a
 * user could receive a different "minutes to 1.0 MED" on the beach than in the
 * clinic — unacceptable for a dosing instrument. This harness makes drift a CI
 * failure.
 *
 * Usage
 *   node scripts/parity-check.mjs              # full sweep
 *   node scripts/parity-check.mjs --quick      # CI-friendly subset
 *   node scripts/parity-check.mjs --json       # machine-readable report
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  solarAdvisory,
  spfFilmIntegrity,
  medFromIta,
  uvIndexFromGeometry,
  uvIndexFromShadow,
  erythemaAction,
  vitaminDAction,
  airMass
} from '../src/lib/engines/photobiology.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const quick = process.argv.includes('--quick');
const asJson = process.argv.includes('--json');

/** Call the Python self-test in JSON export mode. */
function pythonSweep() {
  const out = execFileSync('python3', ['python_photobiology/selftest.py', '--json'], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8'
  });
  return JSON.parse(out);
}

/** Relative error, treating null/Infinity consistently across languages. */
function relErr(a, b) {
  if (a == null && b == null) return 0;
  if (a == null || b == null) return Number.POSITIVE_INFINITY;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / scale;
}

const report = { checks: 0, failures: [], maxRelErr: 0, byField: {} };

function check(field, py, js, tolerance, ctx) {
  report.checks++;
  const err = relErr(py, js);
  report.byField[field] ??= { checks: 0, maxErr: 0 };
  report.byField[field].checks++;
  if (err > report.byField[field].maxErr) report.byField[field].maxErr = err;
  if (err > report.maxRelErr) report.maxRelErr = err;
  if (err > tolerance) {
    report.failures.push({ field, py, js, relErr: err, tolerance, ctx });
  }
}

/* ---------------------------------------------------------------- 1. Sweep */
console.log('⟳ Running Python reference sweep…');
const py = pythonSweep();
console.log(`  Python emitted ${py.cases} solar cases + ${py.spf_cases.length} SPF cases`);

const cases = quick
  ? py.solar_cases.filter((_, i) => i % 37 === 0)
  : py.solar_cases;

console.log(`⟳ Replaying ${cases.length} solar cases through the JS mirror…`);

for (const { in: inp, out: want } of cases) {
  const got = solarAdvisory({
    uvIndex: inp.uv_index,
    ita: inp.ita,
    bsaFraction: inp.bsa,
    spf: inp.spf,
    albedo: inp.albedo,
    altitudeM: inp.altitude_m,
    elevationDeg: inp.elevation_deg
  });
  const ctx = inp;
  check('med', want.med, got.med, 1e-6, ctx);
  check('minutes_to_med', want.minutes_to_med, got.burn.minutesToMed, 1e-3, ctx);
  check('minutes_to_vitd', want.minutes_to_vitd, got.vitd.minutesToTarget, 1e-3, ctx);
  check('iu_per_min', want.iu_per_min, got.vitd.iuPerMin, 1e-3, ctx);
  check('safe_window_min', want.safe_window_min, got.safeWindowMin, 1e-3, ctx);
}

/* ------------------------------------------------------------ 2. SPF curves */
console.log(`⟳ Replaying ${py.spf_cases.length} SPF film cases…`);
const KEY = {
  avobenzone_unstabilized: 'avobenzone_unstabilized',
  avobenzone_stabilized: 'avobenzone_stabilized',
  zinc_oxide: 'zinc_oxide',
  octinoxate: 'octinoxate'
};
for (const { in: inp, out: want } of py.spf_cases) {
  const got = spfFilmIntegrity({
    minutes: inp.minutes,
    spf: inp.spf,
    activity: inp.activity,
    filterKey: KEY[inp.filter_key] ?? inp.filter_key
  });
  check('spf_protection', want.protection_remaining, got.protectionRemaining, 1e-3, inp);
  check('spf_integrity', want.integrity, got.integrity, 1e-3, inp);
  check('spf_effective', want.effective_spf, got.effectiveSpf, 1e-3, inp);
}

/* --------------------------------------------------- 3. Spot-check constants */
/**
 * Recompute the scalar reference table by delegating to Python once, so this
 * file never duplicates a numeric constant.
 */
function buildReference() {
  const script = `
import json, sys
sys.path.insert(0, '.')
from python_photobiology.med_erythema_vitd import (
    erythema_action, vitamin_d_action, air_mass, med_from_ita, uv_index_from_geometry,
)
out = {
  "erythema": {str(n): erythema_action(n) for n in (290,295,300,305,310,315,320,330,340,350,360,370,380,390,400)},
  "vitd": {str(n): vitamin_d_action(n) for n in (255,280,295,300,310,320,330,335)},
  "airmass": {str(z): air_mass(z) for z in (0,15,30,45,60,75,85,90)},
  "med": {str(i): med_from_ita(i) for i in (-60,-30,-10,0,10,28,41,55,70)},
  "uvi": {str(e): uv_index_from_geometry(elevation_deg=e) for e in (0,5,10,15,20,30,45,60,75,90)},
}
print(json.dumps(out))
`;
  const raw = execFileSync('python3', ['-c', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  return JSON.parse(raw);
}


console.log('⟳ Spot-checking action spectra, air mass, MED and UV Index…');
let pyReference = { erythema: {}, vitd: {}, airmass: {}, med: {}, uvi: {} };
try {
  pyReference = buildReference();
} catch (err) {
  console.warn(`  ! Python reference unavailable (${err.message.split('\n')[0]})`);
}

for (const nm of [290, 295, 300, 305, 310, 315, 320, 330, 340, 350, 360, 370, 380, 390, 400]) {
  check(`erythema@${nm}`, pyReference.erythema[nm], erythemaAction(nm), 1e-9, { nm });
}
for (const nm of [255, 280, 295, 300, 310, 320, 330, 335]) {
  check(`vitd@${nm}`, pyReference.vitd[nm], vitaminDAction(nm), 1e-9, { nm });
}
for (const z of [0, 15, 30, 45, 60, 75, 85, 90]) {
  check(`airmass@${z}`, pyReference.airmass[z], airMass(z), 1e-9, { z });
}
for (const ita of [-60, -30, -10, 0, 10, 28, 41, 55, 70]) {
  check(`med@${ita}`, pyReference.med[ita], medFromIta(ita), 1e-9, { ita });
}
for (const elev of [0, 5, 10, 15, 20, 30, 45, 60, 75, 90]) {
  check(`uvi@${elev}`, pyReference.uvi[elev], uvIndexFromGeometry({ elevationDeg: elev }), 2e-3, { elev });
}

/* ----------------------------------------------------------------- 4. Report */
const summary = {
  checks: report.checks,
  failures: report.failures.length,
  maxRelErr: Number(report.maxRelErr.toExponential(3)),
  byField: Object.fromEntries(
    Object.entries(report.byField).map(([k, v]) => [k, Number(v.maxErr.toExponential(2))])
  ),
  samples: report.failures.slice(0, 8)
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('\n── JS ↔ Python parity ─────────────────────────────');
  for (const [field, maxErr] of Object.entries(summary.byField)) {
    const flag = maxErr > 1e-3 ? '✗' : '✓';
    console.log(`  ${flag} ${field.padEnd(22)} max Δ ${maxErr}`);
  }
  console.log(`\n  ${summary.checks} comparisons · ${summary.failures} failures · max Δ ${summary.maxRelErr}`);
  if (summary.failures) {
    console.log('\n  First divergences:');
    for (const s of summary.samples) {
      console.log(`   · ${s.field}: py=${s.py} js=${s.js} Δ=${s.relErr.toExponential(2)}`);
    }
  }
}

if (summary.failures > 0) process.exitCode = 1;
