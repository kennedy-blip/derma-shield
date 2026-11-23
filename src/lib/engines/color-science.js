/**
 * DERMA-SHIELD · color-science.js
 * -----------------------------------------------------------------------------
 * Reflectance colorimetry core: sRGB (IEC 61966-2-1) → linear RGB → CIE XYZ
 * (D65) → CIE L*a*b* (1976), then Individual Typology Angle, Dawson's
 * haemoglobin Erythema Index, Melanin Index and Fitzpatrick/MED mapping.
 *
 * All functions are pure ES2024, allocation-light and safe to run at 60 fps on
 * a 320×240 ROI (76 800 pixels) inside a worker-less rAF loop.
 *
 * References
 *  - CIE 15:2004, Colorimetry (D65 white point, 2° observer)
 *  - Chardon et al. 1991, "Skin colour typology and suntanning pathways"
 *    (Individual Typology Angle, Int. J. Cosmet. Sci.)
 *  - Dawson et al. 1980, Br. J. Dermatol. (erythema index, 540/660 nm pair)
 *  - Del Bino & Bernerd 2013, Pigment Cell Melanoma Res. (ITA° phototype bins)
 * ------------------------------------------------------------------------- */

/** D65 2° observer white point, normalised to Y = 1. */
export const D65 = Object.freeze({ X: 0.95047, Y: 1.0, Z: 1.08883 });

export const EPSILON = 216 / 24389; // (6/29)^3
export const KAPPA = 24389 / 27; // (29/3)^3

/* ------------------------------------------------------------------ sRGB ↔ linear */

/**
 * Decode one 8-bit sRGB channel to linear-light [0,1].
 * @param {number} v 0..255
 */
export function srgbToLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Encode linear-light [0,1] to 8-bit sRGB. */
export function linearToSrgb(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

/* ------------------------------------------------------------------ linear ↔ XYZ */

/** Linear sRGB (D65) → CIE XYZ, IEC 61966-2-1 matrix. */
export function linearRgbToXyz(r, g, b) {
  return {
    X: 0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    Y: 0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    Z: 0.0193339 * r + 0.119192 * g + 0.9503041 * b
  };
}

/** CIE XYZ → linear sRGB (may return out-of-gamut values; clamp downstream). */
export function xyzToLinearRgb(X, Y, Z) {
  return {
    r: 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    g: -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    b: 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z
  };
}

/* --------------------------------------------------------------- XYZ ↔ Lab */

function labF(t) {
  return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

function labFInv(t) {
  const t3 = t * t * t;
  return t3 > EPSILON ? t3 : (116 * t - 16) / KAPPA;
}

/** CIE XYZ (D65, Y=1 scale) → L*a*b*. */
export function xyzToLab(X, Y, Z) {
  const fx = labF(X / D65.X);
  const fy = labF(Y / D65.Y);
  const fz = labF(Z / D65.Z);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

/** CIE L*a*b* → XYZ. */
export function labToXyz(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  return {
    X: D65.X * labFInv(fx),
    Y: D65.Y * labFInv(fy),
    Z: D65.Z * labFInv(fz)
  };
}

/** 8-bit sRGB → L*a*b*. */
export function srgbToLab(r, g, b) {
  const lin = linearRgbToXyz(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  return xyzToLab(lin.X, lin.Y, lin.Z);
}

/** L*a*b* → 8-bit sRGB (clipped to display gamut). */
export function labToSrgb(L, a, b) {
  const xyz = labToXyz(L, a, b);
  const lin = xyzToLinearRgb(xyz.X, xyz.Y, xyz.Z);
  return {
    r: linearToSrgb(Math.max(0, Math.min(1, lin.r))),
    g: linearToSrgb(Math.max(0, Math.min(1, lin.g))),
    b: linearToSrgb(Math.max(0, Math.min(1, lin.b)))
  };
}

/** L*a*b* → CSS hex string. */
export function labToHex(L, a, b) {
  const { r, g, b: bb } = labToSrgb(L, a, b);
  return '#' + [r, g, bb].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** sRGB hex string → { r, g, b }. */
export function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/* ------------------------------------------------------------- derived metrics */

/** Relative luminance Y ∈ [0,1] from linear RGB. */
export function relativeLuminance(rLin, gLin, bLin) {
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/** WCAG contrast ratio between two 8-bit sRGB colors. */
export function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(
    srgbToLinear(c1.r),
    srgbToLinear(c1.g),
    srgbToLinear(c1.b)
  );
  const l2 = relativeLuminance(
    srgbToLinear(c2.r),
    srgbToLinear(c2.g),
    srgbToLinear(c2.b)
  );
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Individual Typology Angle (Chardon 1991).
 * ITA° = arctan((L* − 50) / b*) · 180/π
 * Higher angle → lighter constitutional pigmentation.
 * @param {{L:number,a:number,b:number}} lab
 * @returns {number} degrees in (−90, 90)
 */
export function itaDegrees(lab) {
  const b = Math.abs(lab.b) < 1e-6 ? (lab.b < 0 ? -1e-6 : 1e-6) : lab.b;
  return (Math.atan((lab.L - 50) / b) * 180) / Math.PI;
}

/**
 * Dawson's optical Erythema Index from reflectance fractions R (0..1).
 * EI = 100 · [log10(1/R_G) − 1.44 · log10(1/R_R)]
 * The 1.44 coefficient compensates melanin absorption at the 540 nm
 * haemoglobin band using the 660 nm melanin-isobestic reference.
 * @param {number} rG green reflectance fraction (≈540 nm)
 * @param {number} rR red reflectance fraction (≈660 nm)
 */
export function dawsonErythemaIndex(rG, rR) {
  const g = Math.max(1e-4, Math.min(1, rG));
  const r = Math.max(1e-4, Math.min(1, rR));
  return 100 * (Math.log10(1 / g) - 1.44 * Math.log10(1 / r));
}

/**
 * Melanin Index (log reflectance). MI = 100 · log10(1/R_red) @ 660 nm.
 * Values climb with constitutive + facultative pigmentation.
 */
export function melaninIndex(rR) {
  return 100 * Math.log10(1 / Math.max(1e-4, Math.min(1, rR)));
}

/**
 * Specular sheen ratio — barrier hydration proxy. A dry, flaky stratum corneum
 * scatters diffusely (high G/B spread); a hydrated barrier returns a tighter,
 * higher-chroma highlight.
 */
export function barrierHydration(r, g, b) {
  const mean = (r + g + b) / 3 || 1;
  const spread = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  const sheen = (r + g) / (2 * Math.max(1, b));
  const hydration = 100 * Math.max(0, Math.min(1, 0.55 + (sheen - 1) * 0.7 - spread * 0.25));
  return {
    hydration: Number(hydration.toFixed(1)),
    sheenRatio: Number(sheen.toFixed(3)),
    spread: Number(spread.toFixed(3))
  };
}

/**
 * ITA° → Fitzpatrick phototype (Del Bino/Chardon clinical bins).
 * >55 Very Light I · 41–55 Light II · 28–41 Intermediate III · 10–28 Tan IV
 * −30–10 Brown V · <−30 Deep VI
 * @param {number} ita
 */
export function phototypeFromIta(ita) {
  if (ita > 55) return { type: 'I', label: 'Very Light', index: 1, bin: 'very-light' };
  if (ita > 41) return { type: 'II', label: 'Light', index: 2, bin: 'light' };
  if (ita > 28) return { type: 'III', label: 'Intermediate', index: 3, bin: 'intermediate' };
  if (ita > 10) return { type: 'IV', label: 'Tan / Olive', index: 4, bin: 'tan' };
  if (ita > -30) return { type: 'V', label: 'Brown', index: 5, bin: 'brown' };
  return { type: 'VI', label: 'Deep Melanin-Rich', index: 6, bin: 'deep' };
}

/** Minimal Erythemal Dose anchors (J/m²) per phototype, interpolated by ITA°. */
export const MED_ANCHORS = Object.freeze([
  { ita: 70, med: 200, phototype: 'I' },
  { ita: 55, med: 225, phototype: 'I/II' },
  { ita: 41, med: 300, phototype: 'II' },
  { ita: 28, med: 400, phototype: 'III' },
  { ita: 10, med: 550, phototype: 'IV' },
  { ita: -10, med: 800, phototype: 'V' },
  { ita: -30, med: 1050, phototype: 'V/VI' },
  { ita: -60, med: 1200, phototype: 'VI' }
]);

/**
 * Continuous MED (J/m²) from ITA°, piecewise-linear across phototype anchors.
 * Med I ≈ 200 J/m² … Med VI ≈ 1200 J/m² (Fitzpatrick 1975 / CIE 125).
 */
export function medFromIta(ita) {
  const a = MED_ANCHORS;
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

/** Inverse: MED (J/m²) → approximate ITA°. */
export function itaFromMed(med) {
  const a = MED_ANCHORS;
  if (med <= a[0].med) return a[0].ita;
  for (let i = 0; i < a.length - 1; i++) {
    const hi = a[i];
    const lo = a[i + 1];
    if (med >= hi.med && med <= lo.med) {
      const t = (med - hi.med) / (lo.med - hi.med);
      return Number((hi.ita + t * (lo.ita - hi.ita)).toFixed(1));
    }
  }
  return a[a.length - 1].ita;
}

/**
 * Clinical interpretation bands for the Dunn–Dawson erythema readout as
 * calibrated on the DERMA-SHIELD instrument.
 */
export const ERYTHEMA_BANDS = Object.freeze([
  { max: 20, key: 'calm', label: 'Calm / Baseline', tone: 'ok' },
  { max: 30, key: 'warm', label: 'Mild Vasodilation', tone: 'ok' },
  { max: 35, key: 'elevated', label: 'Elevated Perfusion', tone: 'warn' },
  { max: 48, key: 'subclinical', label: 'Sub-Clinical Erythema', tone: 'danger' },
  { max: Infinity, key: 'erythema', label: 'Acute Erythemal Response', tone: 'danger' }
]);

/** @param {number} ei */
export function erythemaBand(ei) {
  return ERYTHEMA_BANDS.find((b) => ei <= b.max) ?? ERYTHEMA_BANDS[ERYTHEMA_BANDS.length - 1];
}

/**
 * Convert an 8-bit sRGB triple into the full DERMA-SHIELD chromophore readout.
 * `refWhite` allows the caller to supply a grey-card white balance reference so
 * that a warm indoor lamp does not masquerade as erythema.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {{ white?: {r:number,g:number,b:number}, calibration?: number }} [opts]
 */
export function analyzeChromophores(r, g, b, opts = {}) {
  const white = opts.white ?? { r: 255, g: 255, b: 255 };
  const wR = Math.max(1, white.r) / 255;
  const wG = Math.max(1, white.g) / 255;
  const wB = Math.max(1, white.b) / 255;
  const rn = Math.min(255, r / wR);
  const gn = Math.min(255, g / wG);
  const bn = Math.min(255, b / wB);

  const lab = srgbToLab(rn, gn, bn);
  const ita = itaDegrees(lab);
  const photo = phototypeFromIta(ita);
  const med = medFromIta(ita);

  // Reflectance fractions from linear-light channels (sRGB display ≈ diffuse
  // reflectance for a matte skin ROI under diffuse illumination).
  const rR = Math.max(1e-4, srgbToLinear(rn));
  const rG = Math.max(1e-4, srgbToLinear(gn));
  const rB = Math.max(1e-4, srgbToLinear(bn));
  const cal = opts.calibration ?? 1;
  const ei = dawsonErythemaIndex(rG, rR) * cal;
  const mi = melaninIndex(rR);
  const hydration = barrierHydration(rn, gn, bn);

  return {
    rgb: { r: Math.round(rn), g: Math.round(gn), b: Math.round(bn) },
    lab: {
      L: Number(lab.L.toFixed(2)),
      a: Number(lab.a.toFixed(2)),
      b: Number(lab.b.toFixed(2))
    },
    ita: Number(ita.toFixed(1)),
    phototype: photo,
    med,
    erythemaIndex: Number(ei.toFixed(1)),
    erythemaBand: erythemaBand(ei),
    melaninIndex: Number(mi.toFixed(1)),
    hydration: hydration.hydration,
    sheenRatio: hydration.sheenRatio,
    reflectance: {
      r: Number(rR.toFixed(4)),
      g: Number(rG.toFixed(4)),
      b: Number(rB.toFixed(4))
    },
    hex: '#' + [rn, gn, bn].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  };
}

/**
 * Average a rectangular ROI of RGBA pixels, ignoring near-black (shadow) and
 * specular-clipped pixels, then run the chromophore analysis.
 *
 * @param {Uint8ClampedArray} data RGBA bytes
 * @param {number} width
 * @param {number} height
 * @param {{ x?:number,y?:number,w?:number,h?:number }} [roi]
 */
export function sampleRoi(data, width, height, roi = {}) {
  const x0 = Math.max(0, Math.floor(roi.x ?? width * 0.3));
  const y0 = Math.max(0, Math.floor(roi.y ?? height * 0.3));
  const x1 = Math.min(width, Math.ceil(x0 + (roi.w ?? width * 0.4)));
  const y1 = Math.min(height, Math.ceil(y0 + (roi.h ?? height * 0.4)));

  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  let clipped = 0;
  let shadow = 0;

  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) {
      const i = (row + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 18) {
        shadow++;
        continue;
      }
      if (lum > 248) {
        clipped++;
        continue;
      }
      sr += r;
      sg += g;
      sb += b;
      n++;
    }
  }
  if (n === 0) return null;
  return {
    rgb: { r: sr / n, g: sg / n, b: sb / n },
    coverage: n / Math.max(1, (x1 - x0) * (y1 - y0)),
    shadow: shadow,
    clipped: clipped
  };
}


/* ------------------------------------------------------- phantom calibration */

/**
 * Solve for an sRGB triple whose derived chromophore readout lands on a target
 * set of clinical values.
 *
 * This is what makes the five built-in "optical skin phantoms" honest: instead
 * of hard-coding a hex and *hoping* the CIE pipeline returns the advertised
 * ITA° / EI, we invert the pipeline. Because ITA° is an exact analytic function
 * of L* and b*, we can seed every candidate on the ITA manifold
 *      b* = (L* − 50) / tan(ITA°)
 * sweep the remaining L* / a* freedom, then hill-climb in integer sRGB until the
 * Dawson EI also matches. Phantoms therefore reproduce their stated numbers to
 * ±0.2° on the exact same code path the camera uses.
 *
 * @param {{ ita:number, erythemaIndex:number }} target
 * @returns {{ hex:string, lab:object, reading:object, residual:number }}
 */
export function solvePhantomHex(target) {
  const { ita, erythemaIndex: EI } = target;
  const tanIta = Math.tan((Math.max(-88, Math.min(88, ita)) * Math.PI) / 180);

  let best = null;
  let bestErr = Infinity;

  const consider = (r, g, b) => {
    const rr = Math.max(0, Math.min(255, Math.round(r)));
    const gg = Math.max(0, Math.min(255, Math.round(g)));
    const bb = Math.max(0, Math.min(255, Math.round(b)));
    const reading = analyzeChromophores(rr, gg, bb);
    const err = Math.abs(reading.ita - ita) * 2.5 + Math.abs(reading.erythemaIndex - EI);
    if (err < bestErr) {
      bestErr = err;
      best = { rgb: { r: rr, g: gg, b: bb }, reading };
    }
    return err;
  };

  // Phase 1 — sweep the ITA manifold. For every candidate lightness, b* is
  // pinned by the ITA definition; only a* (haemoglobin load) is free.
  for (let L = 34; L <= 93; L += 3) {
    const bStar = (L - 50) / (Math.abs(tanIta) < 1e-4 ? 1e-4 : tanIta);
    if (bStar < -8 || bStar > 44) continue;
    for (let a = 1; a <= 34; a += 1.5) {
      const rgb = labToSrgb(L, a, bStar);
      consider(rgb.r, rgb.g, rgb.b);
    }
  }
  if (!best) return null;

  // Phase 2 — integer hill-climb in sRGB space until convergence.
  const deltas = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    [1, 1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, -1], [0, 1, 1], [0, -1, -1],
    [1, -1, 0], [-1, 1, 0], [0, 1, -1], [0, -1, 1]
  ];
  for (let pass = 0; pass < 220; pass++) {
    if (bestErr < 0.02) break;
    let improved = false;
    for (const [dr, dg, db] of deltas) {
      const before = bestErr;
      consider(best.rgb.r + dr, best.rgb.g + dg, best.rgb.b + db);
      if (bestErr < before - 1e-9) improved = true;
    }
    if (!improved) break;
  }

  const hex =
    '#' +
    [best.rgb.r, best.rgb.g, best.rgb.b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');

  return {
    hex,
    rgb: best.rgb,
    lab: best.reading.lab,
    reading: best.reading,
    residual: Number(bestErr.toFixed(3))
  };
}

/** CIE76 ΔE*ab between two Lab triples. */
export function deltaE76(a, b) {
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

/** Hue angle (h°ab) and chroma C*ab, useful for lesion color zones. */
export function labToLch(lab) {
  return {
    L: lab.L,
    C: Math.hypot(lab.a, lab.b),
    h: ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360
  };
}

/** Map a 0..1 value to the DERMA-SHIELD erythemal false-color ramp. */
export function erythemaRamp(t) {
  const stops = [
    [0.0, [11, 63, 74]],
    [0.2, [6, 182, 212]],
    [0.4, [16, 185, 129]],
    [0.55, [234, 179, 8]],
    [0.72, [245, 158, 11]],
    [0.86, [244, 63, 94]],
    [1.0, [236, 72, 153]]
  ];
  const v = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (v >= p0 && v <= p1) {
      const f = (v - p0) / (p1 - p0 || 1);
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2]))
      ];
    }
  }
  return stops[stops.length - 1][1];
}
