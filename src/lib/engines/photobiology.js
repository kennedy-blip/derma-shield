/**
 * DERMA-SHIELD · photobiology.js
 * -----------------------------------------------------------------------------
 * Offline JS mirror of the Python 3.12 photobiology package
 * (`python_photobiology/med_erythema_vitd.py` + `spf_film_kinetics.py`).
 *
 * The Python implementation is the reference (it runs on Vercel's Python
 * runtime). This mirror exists so the Android `.APK` / airplane-mode web app can
 * produce *bit-identical* dosimetry decisions without a network round-trip.
 * `scripts/parity-check.mjs` + `python_photobiology/selftest.py` assert that
 * both implementations agree across a 3-D parameter sweep.
 *
 * Physics implemented
 *  1. McKinlay–Diffey (1987) CIE erythema action spectrum, 290–400 nm.
 *  2. Doyle / CIE previtamin-D3 action spectrum, 255–330 nm.
 *  3. Kasten–Young relative optical air mass, Rayleigh + ozone (Hartley–Huggins)
 *     + Ångström aerosol attenuation over a user ozone column.
 *  4. Ground-level spectral UV irradiance → erythemal irradiance → UV Index.
 *  5. Fitzpatrick Minimal Erythemal Dose (J/m²) and burn-time integration.
 *  6. Holick previtamin-D3 synthesis (IU · min⁻¹) normalised to 10 000 IU per
 *     full-body MED, scaled by exposed BSA and the vitamin-D/erythema spectral
 *     ratio at the current solar zenith angle.
 *  7. Albedo and altitude multipliers (fresh snow 80 %, sand 25 %, water 15 %,
 *     grass 5 %; +4 % UV per 300 m ≈ 1.04^(Δm/300)).
 *  8. William's shadow-ratio clinometer: α = atan(height / shadow).
 * ------------------------------------------------------------------------- */

export const ERYTHEMA_ACTION = Object.freeze({
  290: 0.01,
  295: 0.075,
  297: 0.35,
  300: 0.65,
  303: 0.86,
  305: 0.94,
  307: 0.98,
  310: 1.0,
  313: 0.97,
  315: 0.93,
  320: 0.85,
  325: 0.78,
  330: 0.68,
  335: 0.58,
  340: 0.47,
  345: 0.37,
  350: 0.28,
  355: 0.21,
  360: 0.15,
  365: 0.1,
  370: 0.065,
  375: 0.042,
  380: 0.028,
  385: 0.019,
  390: 0.013,
  395: 0.009,
  400: 0.006
});

export const VITD_ACTION = Object.freeze({
  255: 0.0,
  260: 0.02,
  265: 0.08,
  270: 0.18,
  275: 0.35,
  280: 0.62,
  285: 0.82,
  290: 0.94,
  295: 1.0,
  297: 1.0,
  300: 0.78,
  305: 0.52,
  310: 0.34,
  315: 0.2,
  320: 0.11,
  325: 0.055,
  330: 0.02,
  335: 0.0
});

/** Ozone absorption cross-section (cm²/molecule), Hartley–Huggins band. */
export const OZONE_SIGMA = Object.freeze({
  290: 8.0e-18,
  295: 5.6e-18,
  300: 6.5e-19,
  303: 2.4e-19,
  305: 1.2e-19,
  310: 3.4e-20,
  315: 1.4e-20,
  320: 7.5e-21,
  325: 5.2e-21,
  330: 4.0e-21,
  335: 3.2e-21,
  340: 2.7e-21,
  345: 2.2e-21,
  350: 1.8e-21,
  355: 1.5e-21,
  360: 1.25e-21,
  365: 1.05e-21,
  370: 9.0e-22,
  375: 7.8e-22,
  380: 6.8e-22,
  385: 6.0e-22,
  390: 5.4e-22,
  395: 5.0e-22,
  400: 4.6e-22
});


/** Extraterrestrial (AM0) solar UV spectral irradiance, W·m⁻²·nm⁻¹. */
export const AM0_IRRADIANCE = Object.freeze({
  290: 0.045,
  295: 0.061,
  300: 0.081,
  305: 0.104,
  310: 0.132,
  315: 0.166,
  320: 0.204,
  325: 0.246,
  330: 0.294,
  335: 0.345,
  340: 0.401,
  345: 0.459,
  350: 0.516,
  355: 0.573,
  360: 0.625,
  365: 0.674,
  370: 0.716,
  375: 0.752,
  380: 0.776,
  385: 0.792,
  390: 0.803,
  395: 0.808,
  400: 0.81
});

/** 1 UV Index = 25 mW·m⁻² of CIE-erythema-weighted irradiance. */
export const UVI_TO_ERYTHEMAL_WM2 = 0.025;

/** Rayleigh optical-depth coefficient at 1 µm (Bodhaine 1999), recalibrated. */
export const RAYLEIGH_TAU = 0.02;

/** Effective ozone path factor (see the Python module for the derivation). */
export const OZONE_PATH_FACTOR = 0.52;

/** Absolute calibration of the CIE-weighted integral onto the UV Index scale. */
export const UVI_CALIBRATION = 0.18;

/** Holick: 1 full-body MED synthesises ≈10 000 IU of previtamin D3. */
export const IU_PER_FULL_BODY_MED = 10000;

/** Reference solar-zenith ratio normalisation (the Sun overhead). */
const VITD_REFERENCE_RATIO = 0.0742;

export const ALBEDO_PRESETS = Object.freeze([
  { id: 'grass', label: 'Grass / Asphalt', albedo: 0.05, icon: 'grass' },
  { id: 'water', label: 'Ocean / Open Water', albedo: 0.15, icon: 'water' },
  { id: 'sand', label: 'Beach Sand', albedo: 0.25, icon: 'sand' },
  { id: 'snow', label: 'Fresh Alpine Snow', albedo: 0.8, icon: 'snow' }
]);

export const BSA_PRESETS = Object.freeze([
  { id: 'face', label: 'Face & Hands', bsa: 0.1 },
  { id: 'tshirt', label: 'T-Shirt & Shorts', bsa: 0.35 },
  { id: 'swim', label: 'Swimwear', bsa: 0.75 },
  { id: 'full', label: 'Full Sunbathing', bsa: 0.9 }
]);

export const SPF_PRESETS = Object.freeze([
  { id: 'none', label: 'None', spf: 1 },
  { id: 'spf15', label: 'SPF 15', spf: 15 },
  { id: 'spf30', label: 'SPF 30', spf: 30 },
  { id: 'spf50', label: 'SPF 50+', spf: 50 }
]);

export const ACTIVITY_PRESETS = Object.freeze([
  { id: 'rest', label: 'Resting / Shade', sweat: 0.35, water: false },
  { id: 'walk', label: 'Walking', sweat: 0.6, water: false },
  { id: 'sport', label: 'Running / Sport', sweat: 1.0, water: false },
  { id: 'swim', label: 'Swimming', sweat: 1.0, water: true }
]);

/* ---------------------------------------------------------------- interpolation */

/** Piecewise-linear interpolation over an ascending integer-keyed table. */
export function interpTable(table, x) {
  const keys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  if (x <= keys[0]) return table[keys[0]];
  if (x >= keys[keys.length - 1]) return table[keys[keys.length - 1]];
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i];
    const k1 = keys[i + 1];
    if (x >= k0 && x <= k1) {
      const f = (x - k0) / (k1 - k0);
      return table[k0] + f * (table[k1] - table[k0]);
    }
  }
  return 0;
}

/** McKinlay–Diffey erythema action spectrum A(λ), dimensionless 0..1. */
export function erythemaAction(nm) {
  return interpTable(ERYTHEMA_ACTION, nm);
}

/** Previtamin-D3 action spectrum (Doyle / CIE), normalised to 1 at 295–297 nm. */
export function vitaminDAction(nm) {
  if (nm < 255 || nm > 335) return 0;
  return interpTable(VITD_ACTION, nm);
}

/* ----------------------------------------------------------------- solar geometry */

/** Fractional year / solar declination (Cooper 1969). */
export function solarDeclination(dayOfYear) {
  return 23.45 * Math.sin(((360 / 365) * (284 + dayOfYear) * Math.PI) / 180);
}

/** Equation of time in minutes (NOAA approximation). */
export function equationOfTime(dayOfYear) {
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/**
 * Solar zenith angle (degrees) for local solar time.
 * @param {number} latitude  degrees, north positive
 * @param {number} dayOfYear 1..365
 * @param {number} solarHour local solar hour 0..24
 */
export function solarZenith(latitude, dayOfYear, solarHour) {
  const decl = solarDeclination(dayOfYear);
  const hourAngle = 15 * (solarHour - 12);
  const lat = (latitude * Math.PI) / 180;
  const dec = (decl * Math.PI) / 180;
  const ha = (hourAngle * Math.PI) / 180;
  const cosZ = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  return (Math.acos(Math.max(-1, Math.min(1, cosZ))) * 180) / Math.PI;
}

/** Solar elevation angle (degrees). */
export function solarElevation(latitude, dayOfYear, solarHour) {
  return 90 - solarZenith(latitude, dayOfYear, solarHour);
}

/** Kasten–Young (1989) relative optical air mass. */
export function airMass(zenithDeg) {
  const z = Math.min(96.07995, Math.max(0, zenithDeg));
  return 1 / (Math.cos((z * Math.PI) / 180) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}

/** William's shadow-ratio clinometer: α = atan(height / shadowLength). */
export function solarElevationFromShadow(heightM, shadowM) {
  if (!(shadowM > 0) || !(heightM > 0)) return 0;
  return (Math.atan(heightM / shadowM) * 180) / Math.PI;
}

/** Inverse shadow ratio for rendering the shadow graphic. */
export function shadowRatioFromElevation(elevationDeg) {
  const e = Math.max(0.5, elevationDeg);
  return 1 / Math.tan((e * Math.PI) / 180);
}

/* ------------------------------------------------------------------ UV spectrum */

/**
 * Ground-level spectral UV irradiance (W·m⁻²·nm⁻¹) at 1 nm resolution.
 * @param {{ zenith?:number, ozoneDU?:number, altitudeM?:number, albedo?:number, aerosolTau?:number }} p
 * @returns {{ nm:number, e:number, ery:number, vitd:number }[]}
 */
export function groundUvSpectrum({
  zenith = 30,
  ozoneDU = 300,
  altitudeM = 0,
  albedo = 0.05,
  aerosolTau = 0.05
} = {}) {
  const m = airMass(zenith);
  // Altitude: scale the Rayleigh/aerosol path by station pressure ratio.
  const pressureRatio = Math.exp(-altitudeM / 8434);
  const mR = m * pressureRatio;
  const ozoneColumn = 2.687e16 * ozoneDU; // molec / cm²
  const out = [];

  for (let nm = 290; nm <= 400; nm++) {
    const f0 = interpTable(AM0_IRRADIANCE, nm);
    const sigma = interpTable(OZONE_SIGMA, nm);
    const tauOzone = sigma * ozoneColumn;
    const tauRayleigh = RAYLEIGH_TAU * Math.pow(nm / 1000, -4.08) * mR;
    const tauAerosol = aerosolTau * Math.pow(nm / 500, -1.3) * mR;
    // Ozone and aerosol scale with path; Rayleigh is already mass-scaled above.
    const transmit = Math.exp(-tauOzone * m * OZONE_PATH_FACTOR - tauRayleigh - tauAerosol);
    // Ground reflection adds a diffuse upwelling term onto a horizontal surface.
    const reflect = 1 + albedo * 0.5;
    const e = f0 * transmit * reflect;
    out.push({ nm, e, ery: e * erythemaAction(nm), vitd: e * vitaminDAction(nm) });
  }
  return out;
}

/**
 * Clear-sky UV Index from solar geometry.
 * Calibrated so that an overhead Sun, 300 DU ozone and sea level yields ≈12.0.
 */
export function uvIndexFromGeometry({
  elevationDeg = 60,
  ozoneDU = 300,
  altitudeM = 0,
  albedo = 0.05,
  aerosolTau = 0.05
} = {}) {
  if (elevationDeg <= 0) return 0;
  const zenith = 90 - Math.min(90, elevationDeg);
  const spectrum = groundUvSpectrum({ zenith, ozoneDU, altitudeM, albedo, aerosolTau });
  // Each spectral row is per-nanometre; the 1 nm bins integrate to a plain sum,
  // then the absolute calibration maps it onto the published UV Index scale.
  let ery = 0;
  for (const bin of spectrum) ery += bin.ery;
  return Number(((UVI_CALIBRATION * ery) / UVI_TO_ERYTHEMAL_WM2).toFixed(2));
}

/**
 * UV Index from an off-grid shadow measurement.
 * @param {{ heightM?:number, shadowM?:number, ozoneDU?:number, altitudeM?:number, albedo?:number }} p
 */
export function uvIndexFromShadow({
  heightM = 1,
  shadowM = 1,
  ozoneDU = 300,
  altitudeM = 0,
  albedo = 0.05
} = {}) {
  const elevation = solarElevationFromShadow(heightM, shadowM);
  const uvi = uvIndexFromGeometry({ elevationDeg: elevation, ozoneDU, altitudeM, albedo });
  return { elevationDeg: Number(elevation.toFixed(2)), uvIndex: uvi };
}

/** Vitamin-D / erythema spectral ratio, normalised to overhead Sun. */
export function vitaminDSpectralRatio(elevationDeg, ozoneDU = 300, altitudeM = 0, albedo = 0.05) {
  if (elevationDeg <= 0) return 0;
  const spectrum = groundUvSpectrum({
    zenith: 90 - Math.min(90, elevationDeg),
    ozoneDU,
    altitudeM,
    albedo
  });
  let ery = 0;
  let vitd = 0;
  for (const bin of spectrum) {
    ery += bin.ery;
    vitd += bin.vitd;
  }
  // 1 nm bins → values are already integrated for the sweep above.
  if (ery <= 0) return 0;
  return (vitd / ery) / VITD_REFERENCE_RATIO;
}

/** Altitude UV multiplier: +4 % per 300 m ⇒ 1.04^(Δm / 300). */
export function altitudeMultiplier(altitudeM) {
  return Math.pow(1.04, Math.max(0, altitudeM) / 300);
}

/** Surface-albedo UV multiplier for a standing person (≈ half the albedo returns). */
export function albedoMultiplier(albedo) {
  return 1 + Math.max(0, Math.min(1, albedo)) * 0.5;
}


/** Minimal Erythemal Dose anchors (J/m²) per phototype, interpolated by ITA°. */
export const MED_ANCHORS_SOLAR = Object.freeze([
  { ita: 70, med: 200 },
  { ita: 55, med: 225 },
  { ita: 41, med: 300 },
  { ita: 28, med: 400 },
  { ita: 10, med: 550 },
  { ita: -10, med: 800 },
  { ita: -30, med: 1050 },
  { ita: -60, med: 1200 }
]);

/**
 * Minimal Erythemal Dose (J/m²) from ITA°, piecewise-linear across the
 * Fitzpatrick anchors. Kept here (not only in color-science.js) so the
 * photobiology kernel is self-contained for parity testing and the APK.
 */
export function medFromIta(ita) {
  const a = MED_ANCHORS_SOLAR;
  if (ita >= a[0].ita) return a[0].med;
  for (let i = 0; i < a.length - 1; i++) {
    const hi = a[i];
    const lo = a[i + 1];
    if (ita <= hi.ita && ita >= lo.ita) {
      const t = (hi.ita - ita) / (hi.ita - lo.ita);
      return Number((hi.med + t * (lo.med - hi.med)).toFixed(1));
    }
  }
  return a[a.length - 1].med;
}

/* ------------------------------------------------------------ erythema dosimetry */

/**
 * Sunburn countdown.
 * @param {{ medJm2:number, uvIndex:number, spf?:number, albedo?:number, altitudeM?:number, altitudeInUvi?:boolean }} p
 */
export function burnDosimetry({
  medJm2,
  uvIndex,
  spf = 1,
  albedo = 0.05,
  altitudeM = 0,
  altitudeInUvi = false
}) {
  const albedoMul = albedoMultiplier(albedo);
  const altMul = altitudeInUvi ? 1 : altitudeMultiplier(altitudeM);
  const effectiveSpf = Math.max(1, spf);
  const eryWm2 = (uvIndex * UVI_TO_ERYTHEMAL_WM2 * albedoMul * altMul) / effectiveSpf;
  const jPerMin = eryWm2 * 60;
  const minutesToMed = jPerMin > 0 ? medJm2 / jPerMin : Infinity;
  return {
    erythemalWm2: Number(eryWm2.toFixed(5)),
    joulesPerMin: Number(jPerMin.toFixed(4)),
    effectiveSpf: Number(effectiveSpf.toFixed(1)),
    albedoMultiplier: Number(albedoMul.toFixed(3)),
    altitudeMultiplier: Number(altMul.toFixed(3)),
    minutesToMed: Number.isFinite(minutesToMed) ? Number(minutesToMed.toFixed(1)) : null,
    minutesToMedUnprotected:
      uvIndex > 0
        ? Number(
            (medJm2 / (uvIndex * UVI_TO_ERYTHEMAL_WM2 * albedoMul * altMul * 60)).toFixed(1)
          )
        : null
  };
}

/* ------------------------------------------------------------- vitamin D3 timer */

/**
 * Previtamin-D3 synthesis engine (Holick 2007 model, melanin-aware via MED).
 * @param {{ medJm2:number, uvIndex:number, bsaFraction?:number, spf?:number,
 *           elevationDeg?:number, albedo?:number, altitudeM?:number,
 *           ozoneDU?:number, targetIU?:number, altitudeInUvi?:boolean }} p
 */
export function vitaminDTimer({
  medJm2,
  uvIndex,
  bsaFraction = 0.35,
  spf = 1,
  elevationDeg = 55,
  albedo = 0.05,
  altitudeM = 0,
  ozoneDU = 300,
  targetIU = 1000,
  altitudeInUvi = false
}) {
  const albedoMul = albedoMultiplier(albedo);
  const altMul = altitudeInUvi ? 1 : altitudeMultiplier(altitudeM);
  const eryWm2 = uvIndex * UVI_TO_ERYTHEMAL_WM2 * albedoMul * altMul;

  // Sunscreen attenuates vitamin D synthesis far less than erythema.
  const vitaminDTransmission = Math.pow(Math.max(1, spf), -0.28);
  const spectralRatio = vitaminDSpectralRatio(elevationDeg, ozoneDU, 0, 0) || 0;
  const bsaScale = Math.max(0.02, Math.min(1.2, bsaFraction)) / 1.0;

  const medPerMin = eryWm2 > 0 ? (eryWm2 * 60) / medJm2 : 0;
  const iuPerMin =
    IU_PER_FULL_BODY_MED * medPerMin * bsaScale * spectralRatio * vitaminDTransmission;

  const minutesToTarget = iuPerMin > 0 ? targetIU / iuPerMin : Infinity;

  return {
    iuPerMin: Number(iuPerMin.toFixed(1)),
    minutesToTarget: Number.isFinite(minutesToTarget) ? Number(minutesToTarget.toFixed(1)) : null,
    spectralRatio: Number(spectralRatio.toFixed(3)),
    vitaminDTransmission: Number(vitaminDTransmission.toFixed(3)),
    bsaScale: Number(bsaScale.toFixed(3)),
    eryWm2: Number(eryWm2.toFixed(5))
  };
}

/**
 * Combined solar advisory — the object the Solar module renders.
 */
export function solarAdvisory(input) {
  const {
    uvIndex,
    ita,
    bsaFraction = 0.35,
    spf = 1,
    albedo = 0.05,
    altitudeM = 0,
    elevationDeg = 55,
    ozoneDU = 300,
    targetIU = 1000,
    altitudeInUvi = false,
    medJm2 = null
  } = input;

  // Derive MED from the ITA° angle when the caller has not already resolved it,
  // mirroring python_photobiology.solar_advisory's behaviour exactly.
  const med = medJm2 ?? medFromIta(ita);
  const burn = burnDosimetry({ medJm2: med, uvIndex, spf, albedo, altitudeM, altitudeInUvi });
  const vitd = vitaminDTimer({
    medJm2: med,
    uvIndex,
    bsaFraction,
    spf,
    elevationDeg,
    albedo,
    altitudeM,
    ozoneDU,
    targetIU,
    altitudeInUvi
  });

  // Safe window ends at the earlier of burn threshold and 1.5× vitamin-D target.
  const burnMin = burn.minutesToMed ?? Infinity;
  const vitdMin = vitd.minutesToTarget ?? Infinity;
  const safeWindowMin = Math.min(burnMin, Math.max(vitdMin, 5));
  const optimal = Math.min(burnMin * 0.9, Math.max(vitdMin * 1.15, 4));

  let band = 'safe';
  if (uvIndex >= 11) band = 'extreme';
  else if (uvIndex >= 8) band = 'very-high';
  else if (uvIndex >= 6) band = 'high';
  else if (uvIndex >= 3) band = 'moderate';
  else if (uvIndex > 0) band = 'low';

  return {
    med,
    burn,
    vitd,
    safeWindowMin: Number.isFinite(safeWindowMin) ? Number(safeWindowMin.toFixed(1)) : null,
    optimalWindowMin: Number.isFinite(optimal) ? Number(optimal.toFixed(1)) : null,
    uvBand: band,
    canSynthesize: (vitd.iuPerMin ?? 0) > 0.5
  };
}

/* ------------------------------------------------------------------- SPF kinetics */

export const FILTER_HALF_LIFE_MIN = Object.freeze({
  avobenzone_unstabilized: 55,
  avobenzone_stabilized: 260,
  octinoxate: 95,
  octocrylene: 420,
  bemotrizinol: 760,
  bisdisulizole: 1300,
  zinc_oxide: Infinity,
  titanium_dioxide: Infinity,
  ecamsule: 1500,
  ensulizole: 240,
  homosalate: 300,
  octisalate: 380,
  padimate_o: 210,
  drometrizole_trisiloxane: 620,
  trolamine_salicylate: 340,
  paba: 120
});

export const SUNSCREEN_ACTIVITY = Object.freeze({
  rest: { washTau: 92, label: 'Resting / Shade' },
  walk: { washTau: 68, label: 'Walking' },
  sport: { washTau: 44, label: 'Running / Sport' },
  swim: { washTau: 26, label: 'Swimming / Water' }
});

/**
 * Bi-exponential sunscreen film integrity.
 * I(t) = f·exp(−t/τ_fast) + (1−f)·exp(−t/τ_slow)
 * τ_fast  ← sweat / water wash-off
 * τ_slow  ← UV-filter photolysis (from the filter half-life)
 *
 * @param {{ minutes:number, spf?:number, activity?:string, filterKey?:string,
 *           waterResistanceMin?:number, coverage?:number }} p
 */
export function spfFilmIntegrity({
  minutes,
  spf = 30,
  activity = 'walk',
  filterKey = 'avobenzone_unstabilized',
  waterResistanceMin = 40,
  coverage = 1
}) {
  const t = Math.max(0, minutes);
  const act = SUNSCREEN_ACTIVITY[activity] ?? SUNSCREEN_ACTIVITY.walk;
  const halfLife = FILTER_HALF_LIFE_MIN[filterKey] ?? 300;
  // Photolysis: integrity halves every `halfLife` minutes under full sun.
  const tauSlow = Number.isFinite(halfLife) ? halfLife / Math.LN2 : 1e9;
  const waterPenalty = waterResistanceMin > 0 ? Math.max(0.55, 1 - t / (waterResistanceMin * 3.2)) : 1;
  const tauFast = Math.max(8, act.washTau * waterPenalty);

  const fFast = 0.42 + 0.18 * Math.min(1, Math.max(0, (30 - waterResistanceMin) / 30));
  const integrity = fFast * Math.exp(-t / tauFast) + (1 - fFast) * Math.exp(-t / tauSlow);
  const clamped = Math.max(0, Math.min(1, integrity)) * Math.max(0, Math.min(1.2, coverage));
  const effectiveSpf = 1 + (Math.max(1, spf) - 1) * clamped;
  const protectionRemaining =
    spf > 1 ? (100 * (effectiveSpf - 1)) / (spf - 1) : 100 * clamped;

  return {
    minutes: t,
    integrity: Number(clamped.toFixed(4)),
    protectionRemaining: Number(Math.max(0, Math.min(100, protectionRemaining)).toFixed(1)),
    effectiveSpf: Number(effectiveSpf.toFixed(1)),
    tauFast: Number(tauFast.toFixed(1)),
    tauSlow: Number.isFinite(tauSlow) ? Number(tauSlow.toFixed(1)) : null,
    photolysisHalfLife: Number.isFinite(halfLife) ? halfLife : null
  };
}

/** Full 0..horizon decay curve for the 60 fps canvas plot. */
export function spfDecayCurve({ horizon = 180, step = 2, ...params } = {}) {
  const curve = [];
  for (let t = 0; t <= horizon; t += step) {
    const s = spfFilmIntegrity({ ...params, minutes: t });
    curve.push({ t, ...s });
  }
  return curve;
}

/**
 * Reapplication alarm: the first minute at which remaining protection crosses
 * `thresholdPct` (default 40 % — the amber "SPF film degrading" band).
 */
export function reapplyMinute({ thresholdPct = 40, horizon = 480, ...params } = {}) {
  for (let t = 0; t <= horizon; t += 1) {
    const s = spfFilmIntegrity({ ...params, minutes: t });
    if (s.protectionRemaining <= thresholdPct) return t;
  }
  return null;
}

/**
 * Total UV-A / UV-B protection score for the sunscreen auditor.
 * Weighted transmission over the CIE erythema spectrum and the UVA1 band.
 */
export function spfBandLabels(uvi) {
  if (uvi >= 11) return { label: 'Extreme', tone: 'danger', advice: 'Avoid direct sun 10:00–16:00' };
  if (uvi >= 8) return { label: 'Very High', tone: 'danger', advice: 'SPF 50+, shade, hat, UV goggles' };
  if (uvi >= 6) return { label: 'High', tone: 'warn', advice: 'SPF 30+, reapply every 2 h' };
  if (uvi >= 3) return { label: 'Moderate', tone: 'warn', advice: 'SPF 15+ for extended exposure' };
  if (uvi > 0) return { label: 'Low', tone: 'ok', advice: 'Minimal protection needed' };
  return { label: 'None', tone: 'ok', advice: 'No erythemal UV at ground level' };
}
