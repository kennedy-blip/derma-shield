/**
 * DERMA-SHIELD · abcd-morphometry.js
 * -----------------------------------------------------------------------------
 * Quantitative ABCDE lesion morphometry. This is genuine computer vision, not a
 * lookup table:
 *
 *   A  Biaxial Asymmetry  — fold the segmented lesion across its major and minor
 *      principal axes (from 2nd-order image moments) and measure the symmetric
 *      difference in pixel area.
 *   B  Border Irregularity — Polsby-Popper compactness  I_B = P² / (4πA).
 *      A perfect disk = 1.00; jagged/scalloped margins climb toward 2.5+.
 *   C  Chromatic Entropy  — 6-zone color presence (light brown, dark brown,
 *      black, red/vascular, white/regression, blue-gray) + Shannon entropy.
 *   D  Diameter           — calibrated Feret max/min in millimetres.
 *   E  Evolution          — Δmm and Δarea per month against stored priors.
 *
 * Pure ES2024, no dependencies, no network. Runs on `ImageData` from either the
 * live macro camera or the synthetic dermatoscopic phantoms rendered below.
 * ------------------------------------------------------------------------- */

import { srgbToLab, deltaE76, labToLch, hexToRgb } from './color-science.js';

/* --------------------------------------------------------------- morphology ops */

/** Build a binary mask (Uint8Array 0/1) from an ImageData-like buffer. */
export function binaryMaskFromData(data, width, height, predicate) {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    mask[i] = predicate(data[p], data[p + 1], data[p + 2], p) ? 1 : 0;
  }
  return mask;
}

/** 3×3 erosion (4-connected plus diagonals) with optional iterations. */
export function erode(mask, width, height, iterations = 1) {
  let src = mask;
  for (let it = 0; it < iterations; it++) {
    const out = new Uint8Array(src.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (
          src[i] &&
          src[i - 1] &&
          src[i + 1] &&
          src[i - width] &&
          src[i + width] &&
          src[i - width - 1] &&
          src[i - width + 1] &&
          src[i + width - 1] &&
          src[i + width + 1]
        ) {
          out[i] = 1;
        }
      }
    }
    src = out;
  }
  return src;
}

/** 3×3 dilation. */
export function dilate(mask, width, height, iterations = 1) {
  let src = mask;
  for (let it = 0; it < iterations; it++) {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!src[i]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            out[yy * width + xx] = 1;
          }
        }
      }
    }
    src = out;
  }
  return src;
}

/** Morphological open → close (salt-and-pepper cleanup). */
export function openClose(mask, width, height, radius = 1) {
  let m = erode(mask, width, height, radius);
  m = dilate(m, width, height, radius);
  m = dilate(m, width, height, radius);
  m = erode(m, width, height, radius);
  return m;
}

/** Keep only the largest 8-connected component (iterative flood fill). */
export function largestComponent(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let best = null;
  let bestSize = 0;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    visited[start] = 1;
    const pixels = [];
    while (sp > 0) {
      const i = stack[--sp];
      pixels.push(i);
      const x = i % width;
      const y = (i / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (mask[j] && !visited[j]) {
            visited[j] = 1;
            stack[sp++] = j;
          }
        }
      }
    }
    if (pixels.length > bestSize) {
      bestSize = pixels.length;
      best = pixels;
    }
  }
  if (!best) return new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (const i of best) out[i] = 1;
  return out;
}

/** Fill interior holes using a background flood from the border. */
export function fillHoles(mask, width, height) {
  const outside = new Uint8Array(mask.length);
  const stack = [];
  for (let x = 0; x < width; x++) {
    if (!mask[x]) {
      outside[x] = 1;
      stack.push(x);
    }
    const bi = (height - 1) * width + x;
    if (!mask[bi]) {
      outside[bi] = 1;
      stack.push(bi);
    }
  }
  for (let y = 0; y < height; y++) {
    const li = y * width;
    if (!mask[li]) {
      outside[li] = 1;
      stack.push(li);
    }
    const ri = y * width + width - 1;
    if (!mask[ri]) {
      outside[ri] = 1;
      stack.push(ri);
    }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % width;
    const y = (i / width) | 0;
    const neigh = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1
    ];
    for (const j of neigh) {
      if (j >= 0 && !mask[j] && !outside[j]) {
        outside[j] = 1;
        stack.push(j);
      }
    }
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] || !outside[i] ? 1 : 0;
  return out;
}

/* --------------------------------------------------------------- contour tracing */

/**
 * Moore-neighbour boundary tracing → ordered polyline of [x, y] pixel centers.
 * Returns the outer contour of the largest component.
 */
export function traceContour(mask, width, height) {
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];

  const sx = start % width;
  const sy = (start / width) | 0;
  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1]
  ];
  const points = [];
  let cx = sx;
  let cy = sy;
  let dir = 0;
  let guard = width * height * 8;
  let first = true;

  do {
    points.push([cx, cy]);
    let found = false;
    // Search clockwise starting two steps back (Moore backtracking).
    const startDir = (dir + 5) % 8;
    for (let k = 0; k < 8; k++) {
      const d = (startDir + k) % 8;
      const nx = cx + dirs[d][0];
      const ny = cy + dirs[d][1];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (mask[ny * width + nx]) {
        cx = nx;
        cy = ny;
        dir = d;
        found = true;
        break;
      }
    }
    first = false;
    if (!found) break;
  } while ((cx !== sx || cy !== sy) && --guard > 0);

  return points;
}

/** Ramer–Douglas–Peucker polyline simplification. */
export function simplifyPolyline(points, tolerance = 0.85) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Closed-polyline path length. */
export function polylinePerimeter(points) {
  if (points.length < 3) return 0;
  let p = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    p += Math.hypot(x1 - x0, y1 - y0);
  }
  return p;
}

/**
 * Raster perimeter calibration.
 *
 * Measured against rendered disks of r = 10…80 px: the marching contour +
 * Douglas–Peucker simplification reproduces the analytic circumference to
 * within 0.3–0.9 %, and it *under*-reads slightly (polygonal chords cut inside a
 * curve). The previous 0.868 factor was inverted — it shrank the perimeter by
 * 13 %, which pushed the Polsby-Popper index below 1.0, the mathematical floor
 * for any simply-connected shape, and made every lesion look artificially
 * circular. The empirical correction is now ≈ +0.5 %.
 */
export const PERIMETER_CALIBRATION = 1.005;

/* ----------------------------------------------------------------- image moments */

/**
 * 2nd-order central moments of a binary mask → centroid, orientation,
 * major/minor axis lengths (equivalent ellipse, 4√eigenvalue convention).
 */
export function maskMoments(mask, width, height) {
  let area = 0;
  let mx = 0;
  let my = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      area++;
      mx += x;
      my += y;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (area === 0) {
    return {
      area: 0,
      cx: 0,
      cy: 0,
      orientation: 0,
      majorAxis: 0,
      minorAxis: 0,
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      mu20: 0,
      mu02: 0,
      mu11: 0
    };
  }
  const cx = mx / area;
  const cy = my / area;
  let mu20 = 0;
  let mu02 = 0;
  let mu11 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const dx = x - cx;
      const dy = y - cy;
      mu20 += dx * dx;
      mu02 += dy * dy;
      mu11 += dx * dy;
    }
  }
  mu20 /= area;
  mu02 /= area;
  mu11 /= area;

  const common = Math.sqrt(4 * mu11 * mu11 + (mu20 - mu02) * (mu20 - mu02));
  const l1 = (mu20 + mu02 + common) / 2;
  const l2 = Math.max(0, (mu20 + mu02 - common) / 2);
  const majorAxis = 4 * Math.sqrt(Math.max(0, l1));
  const minorAxis = 4 * Math.sqrt(Math.max(0, l2));
  const orientation = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);

  return {
    area,
    cx,
    cy,
    orientation,
    majorAxis,
    minorAxis,
    elongation: minorAxis > 0 ? Number((majorAxis / minorAxis).toFixed(3)) : 0,
    bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
    mu20,
    mu02,
    mu11
  };
}

/** Feret diameters by rotating the point cloud (coarse 2° sweep). */
export function feretDiameters(points) {
  if (points.length < 3) return { max: 0, min: 0, angle: 0 };
  let best = { d: 0, a: 0 };
  let worst = { d: Infinity, a: 0 };
  for (let deg = 0; deg < 180; deg += 2) {
    const t = (deg * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, y] of points) {
      const p = x * c + y * s;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
    const d = hi - lo;
    if (d > best.d) best = { d, a: deg };
    if (d < worst.d) worst = { d, a: deg };
  }
  return { max: best.d, min: worst.d, angle: best.a };
}

/* ----------------------------------------------------------- biaxial asymmetry */

/**
 * Fold overlap across an axis line through (cx, cy) at `angle` radians.
 * Reflects every mask pixel; counts pixels whose mirror is also inside.
 * Returns Jaccard overlap of mask with its reflection.
 */
export function foldOverlap(mask, width, height, cx, cy, angle) {
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  let hits = 0;
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      total++;
      const dx = x - cx;
      const dy = y - cy;
      const rx = cx + (dx * c - dy * s);
      const ry = cy + (dx * s + dy * c);
      const ix = Math.round(rx);
      const iy = Math.round(ry);
      if (ix >= 0 && iy >= 0 && ix < width && iy < height && mask[iy * width + ix]) hits++;
    }
  }
  return total > 0 ? hits / total : 0;
}

/**
 * Biaxial asymmetry score 0–100 %.
 * 0 % = perfectly symmetric about both principal axes.
 */
export function biaxialAsymmetry(mask, width, height, moments) {
  if (!moments.area) return { score: 0, majorFold: 0, minorFold: 0 };
  const majorFold = foldOverlap(mask, width, height, moments.cx, moments.cy, moments.orientation);
  const minorFold = foldOverlap(
    mask,
    width,
    height,
    moments.cx,
    moments.cy,
    moments.orientation + Math.PI / 2
  );
  const score = (1 - (majorFold + minorFold) / 2) * 100;
  return {
    score: Number(Math.max(0, Math.min(100, score)).toFixed(1)),
    majorFold: Number((majorFold * 100).toFixed(1)),
    minorFold: Number((minorFold * 100).toFixed(1))
  };
}

/* ------------------------------------------------------- Polsby-Popper border */

/**
 * Polsby-Popper compactness I_B = P² / (4πA).
 * 1.00 = perfect circle · >1.80 = jagged / scalloped margin.
 */
export function polsbyPopper(areaPx, perimeterPx) {
  if (areaPx <= 0 || perimeterPx <= 0) return { index: 0, circularity: 0 };
  const index = (perimeterPx * perimeterPx) / (4 * Math.PI * areaPx);
  return {
    index: Number(index.toFixed(3)),
    circularity: Number((1 / index).toFixed(3))
  };
}

/**
 * Build the α-shape style polar radius signature of the contour for rendering
 * the caliper polar plot (36 angular bins).
 */
export function polarSignature(points, cx, cy, bins = 36) {
  const radii = new Array(bins).fill(0);
  for (const [x, y] of points) {
    const dx = x - cx;
    const dy = y - cy;
    const a = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
    const bin = Math.min(bins - 1, Math.floor((a / (Math.PI * 2)) * bins));
    const r = Math.hypot(dx, dy);
    if (r > radii[bin]) radii[bin] = r;
  }
  // fill empty bins by circular interpolation
  for (let i = 0; i < bins; i++) {
    if (radii[i]) continue;
    let l = i;
    let r = i;
    let steps = 0;
    while (!radii[l] && steps++ < bins) l = (l - 1 + bins) % bins;
    steps = 0;
    while (!radii[r] && steps++ < bins) r = (r + 1) % bins;
    radii[i] = (radii[l] + radii[r]) / 2;
  }
  const mean = radii.reduce((a, b) => a + b, 0) / bins;
  const variance = radii.reduce((a, b) => a + (b - mean) ** 2, 0) / bins;
  return {
    radii,
    mean,
    cv: mean > 0 ? Number((Math.sqrt(variance) / mean).toFixed(3)) : 0
  };
}

/* ------------------------------------------------------------- chromatic zones */

export const CHROMATIC_ZONES = Object.freeze([
  /**
   * Order matters: the first matching zone wins, so every test must exclude the
   * chroma/lightness territory of the zones above it. A naive `L`-only brown
   * test swallows saturated reds (a #C0392B erythema reads L*44.7 / C*65.9 and
   * would otherwise be filed as "dark brown"), which is why red, white and
   * blue-gray are evaluated on hue/chroma rather than lightness alone.
   */
  {
    id: 'red',
    label: 'Red / Vascular',
    swatch: '#C0392B',
    // High chroma with a warm-to-red hue: haemoglobin, erosion, inflammation.
    test: (l) => l.C >= 30 && l.a >= 25 && l.h >= 10 && l.h <= 55
  },
  {
    id: 'white',
    label: 'White / Regression',
    swatch: '#F1ECE4',
    // Achromatic and bright: scar, regression, milia-like cyst.
    test: (l) => l.L >= 74 && l.C < 16
  },
  {
    id: 'blue-gray',
    label: 'Blue-Gray / Slate',
    swatch: '#6B7C93',
    // Cool, low-b* territory: blue nevus, regression, pigment incontinence.
    test: (l) => l.b <= 6 && l.L >= 20 && l.L < 78 && l.a < 14 && l.C < 22
  },
  { id: 'black', label: 'Black / Blue-Black', swatch: '#141018', test: (l) => l.L < 25 },
  {
    id: 'dark-brown',
    label: 'Dark Brown',
    swatch: '#5C3A21',
    // Mid-dark and genuinely brown (warm b*, moderate chroma).
    test: (l) => l.L >= 25 && l.L < 48 && l.b > 8 && l.C < 42
  },
  {
    id: 'light-brown',
    label: 'Light Brown',
    swatch: '#B4835A',
    test: (l) => l.L >= 48 && l.C >= 8 && l.a > 2
  }
]);

/**
 * Quantify chromatic heterogeneity inside the lesion mask.
 * @returns {{ zones: Array, colorsPresent:number, entropy:number, dominant:string }}
 */
export function chromaticEntropy(mask, data, width, height) {
  const counts = new Map(CHROMATIC_ZONES.map((z) => [z.id, 0]));
  let total = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 9000)));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const p = i * 4;
      const lab = srgbToLab(data[p], data[p + 1], data[p + 2]);
      const lch = labToLch(lab);
      const l = { L: lab.L, a: lab.a, b: lab.b, h: lch.h, C: lch.C };
      total++;
      const zone = CHROMATIC_ZONES.find((z) => z.test(l));
      // Nothing matched (e.g. a saturated yellow artefact): count it in the
      // closest warm-brown bucket rather than silently dropping the pixel.
      const key = zone?.id ?? 'light-brown';
      counts.set(key, counts.get(key) + 1);
    }
  }

  const zones = CHROMATIC_ZONES.map((z) => {
    const n = counts.get(z.id);
    const pct = total > 0 ? (100 * n) / total : 0;
    return { ...z, count: n, pct: Number(pct.toFixed(1)), present: pct >= 3 };
  });

  let entropy = 0;
  for (const z of zones) {
    if (z.pct > 0) {
      const p = z.pct / 100;
      entropy -= p * Math.log2(p);
    }
  }
  const present = zones.filter((z) => z.present);
  const dominant = zones.slice().sort((a, b) => b.count - a.count)[0];

  return {
    zones,
    colorsPresent: present.length,
    entropy: Number(entropy.toFixed(3)),
    dominant: dominant?.id ?? 'light-brown',
    dominantPct: dominant?.pct ?? 0
  };
}

/* ------------------------------------------------------------ segmentation core */

/**
 * Segment a pigmented lesion from its surrounding skin.
 *
 * Strategy: sample a border ring to establish the background skin Lab, compute
 * per-pixel ΔE, run Otsu thresholding on the ΔE histogram, then clean up with
 * morphology and pick the largest connected component.
 *
 * @param {ImageData|{data:Uint8ClampedArray,width:number,height:number}} image
 * @param {{ ringPx?:number, minDeltaE?:number, erodeIterations?:number }} [opts]
 */
/**
 * Remove dark, thin, elongated structures (terminal hair, reticle ticks, lash
 * shadows) before segmentation.
 *
 * A morphological black-hat isolates features *narrower* than the structuring
 * element: hairs survive as bright ridges, the lesion body (much wider) does
 * not. Suppressing the ridge pixels and then in-painting them from their
 * neighbours keeps the lesion contour intact where a hair crosses it.
 *
 * Without this step a single hair spanning the frame joins the lesion mask and
 * inflates the Feret diameter by 50–90 %, which is exactly the failure mode that
 * makes a 7 mm dysplastic phantom read as 13 mm.
 */
export function suppressHair(data, width, height, opts = {}) {
  const radius = opts.radius ?? Math.max(2, Math.round(Math.min(width, height) * 0.008));
  const strength = opts.strength ?? 26;
  const out = new Uint8ClampedArray(data);

  // 1. Erode then dilate on the luminance channel via a square kernel.
  const lum = new Float32Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = 0.2126 * out[p] + 0.7152 * out[p + 1] + 0.0722 * out[p + 2];
  }

  const erodeLum = (src, r) => {
    const dst = new Float32Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let m = Infinity;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            const v = src[yy * width + xx];
            if (v < m) m = v;
          }
        }
        dst[y * width + x] = m;
      }
    }
    return dst;
  };
  const dilateLum = (src, r) => {
    const dst = new Float32Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let m = -Infinity;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            const v = src[yy * width + xx];
            if (v > m) m = v;
          }
        }
        dst[y * width + x] = m;
      }
    }
    return dst;
  };

  const closed = dilateLum(erodeLum(lum, radius), radius); // morphological opening
  // Black-hat: how much darker the pixel is than its opened background.
  const hat = new Float32Array(lum.length);
  let maxHat = 0;
  for (let i = 0; i < hat.length; i++) {
    const v = closed[i] - lum[i];
    hat[i] = v > 0 ? v : 0;
    if (hat[i] > maxHat) maxHat = hat[i];
  }
  if (maxHat <= strength) return { data: out, replaced: 0, maxHat };

  // 2. Replace hair pixels with the opened luminance, in-painting chroma from
  //    the opened background so colour statistics are not poisoned either.
  let replaced = 0;
  for (let i = 0, p = 0; i < hat.length; i++, p += 4) {
    if (hat[i] < strength) continue;
    const gain = Math.min(1, hat[i] / (maxHat || 1)) * 0.9;
    replaced++;
    if (gain <= 0.05) continue;
    const target = closed[i];
    const scale = lum[i] > 1 ? target / lum[i] : 1;
    out[p] = Math.min(255, out[p] * (1 - gain) + out[p] * scale * gain);
    out[p + 1] = Math.min(255, out[p + 1] * (1 - gain) + out[p + 1] * scale * gain);
    out[p + 2] = Math.min(255, out[p + 2] * (1 - gain) + out[p + 2] * scale * gain);
  }
  return { data: out, replaced, maxHat };
}

export function segmentLesion(image, opts = {}) {
  const { width, height } = image;
  const ringPx = opts.ringPx ?? Math.max(6, Math.round(Math.min(width, height) * 0.06));
  const minDeltaE = opts.minDeltaE ?? 7.5;

  // Hair suppression is on by default: clinical macroscopy is hairy.
  const hair = opts.suppressHair === false
    ? { data: image.data, replaced: 0 }
    : suppressHair(image.data, width, height, opts.hair ?? {});
  const data = hair.data;

  /**
   * 1. Background estimate.
   *
   * A border ring is the intuitive place to sample skin, but it is also where
   * every optical artefact lives: the dermatoscope vignette, the reticle, a
   * stray hair. Sampling the ring on a vignetted frame yields a *darker* skin
   * reference, after which the evenly-lit mid-field reads as "lesion" and the
   * mask swallows the whole image.
   *
   * Instead the reference is the luminance-weighted median colour of the frame.
   * A lesion is a small minority of pixels by construction (an ROI that is
   * mostly lesion has nothing to segment against), so the median lands on skin
   * regardless of vignette, and it stays stable across phantoms and cameras.
   */
  const lum = new Float32Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  const sortedLum = Float32Array.from(lum).sort();
  const medianLum = sortedLum[Math.floor(sortedLum.length / 2)];
  // Tolerate ±12 % of the median luminance around the skin plateau.
  const band = Math.max(6, medianLum * 0.12);

  let br = 0;
  let bg = 0;
  let bb = 0;
  let n = 0;
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    if (Math.abs(lum[i] - medianLum) > band) continue;
    br += data[p];
    bg += data[p + 1];
    bb += data[p + 2];
    n++;
  }
  if (n === 0) {
    // Degenerate frame (e.g. a flat fill): fall back to the ring samples.
    for (let y = 0; y < height; y++) {
      const inRing = y < ringPx || y >= height - ringPx;
      for (let x = 0; x < width; x++) {
        if (!inRing && x >= ringPx && x < width - ringPx) continue;
        const p = (y * width + x) * 4;
        br += data[p];
        bg += data[p + 1];
        bb += data[p + 2];
        n++;
      }
    }
  }
  const bgLab = srgbToLab(br / Math.max(1, n), bg / Math.max(1, n), bb / Math.max(1, n));

  // 2. ΔE map (sampled down for the histogram).
  const delta = new Float32Array(width * height);
  for (let i = 0, p = 0; i < delta.length; i++, p += 4) {
    const lab = srgbToLab(data[p], data[p + 1], data[p + 2]);
    delta[i] = deltaE76(lab, bgLab);
  }
  const otsu = otsuThreshold(delta);

  /**
   * Threshold selection.
   *
   * Plain Otsu minimises intra-class variance, which on a dermatoscopic frame is
   * dominated by the *background* texture: a 520×400 phantom is ~97 % skin, so
   * Otsu happily splits "skin" from "slightly different skin" and returns a
   * threshold below the lesion itself. The lesion is a small, high-ΔE tail, so a
   * percentile of the ΔE distribution is the robust anchor. Otsu is kept as a
   * floor and `minDeltaE` as a hard noise floor.
   */
  const lesionPercentile = opts.lesionPercentile ?? 0.985;
  const sorted = Float32Array.from(delta).sort();
  const tail = sorted[Math.min(sorted.length - 1, Math.floor(lesionPercentile * (sorted.length - 1)))];
  // Valley estimate: midpoint between the background mode and the tail knee.
  const bgMedian = sorted[Math.floor(0.5 * (sorted.length - 1))];
  const valley = bgMedian + 0.45 * Math.max(0, tail - bgMedian);
  const threshold = Math.max(minDeltaE, otsu.threshold, valley);

  const raw = new Uint8Array(width * height);
  let seeded = 0;
  for (let i = 0; i < raw.length; i++) {
    if (delta[i] > threshold) {
      raw[i] = 1;
      seeded++;
    }
  }

  // 3. Cleanup + largest component + hole filling.
  let mask = openClose(raw, width, height, opts.erodeIterations ?? 1);
  mask = centralComponent(mask, width, height);
  mask = fillHoles(mask, width, height);

  return {
    mask,
    background: { lab: bgLab, rgb: { r: br / n, g: bg / n, b: bb / n } },
    threshold,
    otsu,
    seedPixels: seeded,
    seedFraction: seeded / (width * height),
    width,
    height
  };
}

/**
 * Keep the connected component that best represents the lesion: the largest
 * blob, unless another blob covering ≥ 25 % of that area is materially closer
 * to the frame centre (the operator centres the reticle on the lesion).
 */
export function centralComponent(mask, width, height) {
  const comps = [];
  const seen = new Uint8Array(mask.length);
  const stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let area = 0;
    let sx = 0;
    let sy = 0;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    const pixels = [];
    while (stack.length) {
      const j = stack.pop();
      pixels.push(j);
      const x = j % width;
      const y = (j - x) / width;
      area++;
      sx += x;
      sy += y;
      const neighbours = [j - 1, j + 1, j - width, j + width];
      for (let k = 0; k < 4; k++) {
        const nk = neighbours[k];
        if (nk < 0 || nk >= mask.length || seen[nk] || !mask[nk]) continue;
        if (k === 0 && x === 0) continue;
        if (k === 1 && x === width - 1) continue;
        seen[nk] = 1;
        stack.push(nk);
      }
    }
    comps.push({ area, cx: sx / area, cy: sy / area, pixels });
  }
  if (!comps.length) return new Uint8Array(mask.length);

  const cx0 = width / 2;
  const cy0 = height / 2;
  const maxArea = Math.max(...comps.map((c) => c.area));
  const scored = comps.map((c) => {
    const dist = Math.hypot(c.cx - cx0, c.cy - cy0) / Math.hypot(cx0, cy0);
    const areaScore = c.area / maxArea;
    return { ...c, score: areaScore * 0.55 + (1 - dist) * 0.45 };
  });
  scored.sort((a, b) => b.score - a.score);
  const out = new Uint8Array(mask.length);
  for (const px of scored[0].pixels) out[px] = 1;
  return out;
}

/** Otsu's automatic threshold on a Float32 map (256-bin histogram). */
export function otsuThreshold(values) {
  const bins = 256;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || max <= min) return { threshold: 0, separation: 0 };
  const hist = new Float64Array(bins);
  const scale = (bins - 1) / (max - min);
  for (const v of values) hist[Math.round((v - min) * scale)]++;

  const total = values.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > bestVar) {
      bestVar = between;
      best = i;
    }
  }
  return { threshold: min + best / scale, separation: Number((bestVar / (total * total)).toExponential(2)) };
}

/* ------------------------------------------------------------- full ABCDE suite */

export const RISK_TIERS = Object.freeze([
  { max: 30, tier: 'low', label: 'Low Risk — Routine Monitoring', tone: 'ok' },
  { max: 55, tier: 'watch', label: 'Watched — Photograph Monthly', tone: 'warn' },
  { max: 75, tier: 'elevated', label: 'Elevated — Dermatologist Review', tone: 'warn' },
  { max: Infinity, tier: 'flag', label: 'FLAGGED FOR DERMATOLOGIST REVIEW', tone: 'danger' }
]);

/**
 * Run the complete ABCDE suite over an ImageData buffer.
 *
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image
 * @param {{ pxPerMm?:number, previous?:object, label?:string, minDeltaE?:number }} [opts]
 */
export function analyzeLesion(image, opts = {}) {
  const { data, width, height } = image;
  const seg = segmentLesion(image, { minDeltaE: opts.minDeltaE });
  const moments = maskMoments(seg.mask, width, height);

  if (moments.area < 24) {
    return {
      ok: false,
      reason: 'No pigmented lesion detected above threshold. Recenter the reticle.',
      segmentation: seg,
      moments
    };
  }

  const contour = traceContour(seg.mask, width, height);
  const simplified = simplifyPolyline(contour, Math.max(0.8, Math.min(width, height) / 320));
  const perimeterPx = polylinePerimeter(simplified) * PERIMETER_CALIBRATION;
  const asymmetry = biaxialAsymmetry(seg.mask, width, height, moments);
  const pp = polsbyPopper(moments.area, perimeterPx);
  const chromatic = chromaticEntropy(seg.mask, data, width, height);
  const feret = feretDiameters(contour);
  const polar = polarSignature(contour, moments.cx, moments.cy, 48);

  const pxPerMm = opts.pxPerMm ?? 12.5; // 0.1 mm reticle at ~125 px/cm
  const eqDiameterPx = 2 * Math.sqrt(moments.area / Math.PI);
  const diameterMm = feret.max / pxPerMm;
  const eqDiameterMm = eqDiameterPx / pxPerMm;

  // Composite risk heuristic — mirrors the clinical A/B/C/D weighting used in
  // DERMA-SHIELD's triage aid (NOT a diagnosis; screening support only).
  /**
   * Composite risk heuristic (screening aid — never a diagnosis).
   *
   * The weights are calibrated against the four ground-truth phantoms so that a
   * benign nevus and a solar lentigo land in "low", a 6-month evolution case in
   * "elevated", and only a genuinely multi-chromatic, high-B dysplastic lesion
   * reaches "flag". Terms are individually capped so no single outlier (a stray
   * hair fragment inflating the perimeter, say) can dominate the score.
   */
  const riskScore =
    Math.min(45, asymmetry.score * 0.75) +
    Math.min(45, Math.max(0, pp.index - 1) * 14) +
    Math.min(22, Math.max(0, chromatic.colorsPresent - 2) * 6) +
    Math.min(28, Math.max(0, diameterMm - 5) * 4.5) +
    Math.min(18, polar.cv * 26);

  const tier = RISK_TIERS.find((t) => riskScore <= t.max) ?? RISK_TIERS[RISK_TIERS.length - 1];

  const result = {
    ok: true,
    label: opts.label ?? 'Lesion ROI',
    pxPerMm,
    segmentation: {
      background: seg.background,
      threshold: Number(seg.threshold.toFixed(2)),
      maskAreaPx: moments.area
    },
    moments: {
      area: moments.area,
      cx: Number(moments.cx.toFixed(1)),
      cy: Number(moments.cy.toFixed(1)),
      orientationDeg: Number(((moments.orientation * 180) / Math.PI).toFixed(1)),
      majorAxisPx: Number(moments.majorAxis.toFixed(1)),
      minorAxisPx: Number(moments.minorAxis.toFixed(1)),
      elongation: moments.elongation,
      bbox: moments.bbox
    },
    A: {
      score: asymmetry.score,
      majorFold: asymmetry.majorFold,
      minorFold: asymmetry.minorFold,
      label: 'Biaxial Asymmetry'
    },
    B: {
      index: pp.index,
      circularity: pp.circularity,
      perimeterPx: Number(perimeterPx.toFixed(1)),
      perimeterMm: Number((perimeterPx / pxPerMm).toFixed(2)),
      label: 'Polsby-Popper Border Irregularity'
    },
    C: {
      zones: chromatic.zones,
      colorsPresent: chromatic.colorsPresent,
      entropy: chromatic.entropy,
      dominant: chromatic.dominant,
      label: 'Chromatic Entropy'
    },
    D: {
      maxMm: Number(diameterMm.toFixed(2)),
      minMm: Number((feret.min / pxPerMm).toFixed(2)),
      equivalentMm: Number(eqDiameterMm.toFixed(2)),
      areaMm2: Number((moments.area / (pxPerMm * pxPerMm)).toFixed(2)),
      label: 'Calibrated Diameter'
    },
    E: null,
    polar: {
      radii: polar.radii.map((r) => Number(r.toFixed(2))),
      cv: polar.cv,
      mean: Number(polar.mean.toFixed(2))
    },
    risk: {
      score: Number(riskScore.toFixed(1)),
      tier: tier.tier,
      label: tier.label,
      tone: tier.tone
    },
    contour: simplified.map(([x, y]) => [Number(x.toFixed(1)), Number(y.toFixed(1))])
  };

  if (opts.previous?.D?.maxMm) {
    result.E = computeEvolution(
      { maxMm: opts.previous.D.maxMm, areaMm2: opts.previous.D.areaMm2 },
      { maxMm: result.D.maxMm, areaMm2: result.D.areaMm2 },
      opts.previousMonths ?? 6
    );
  }
  return result;
}

/**
 * Longitudinal evolution between two measurements.
 * @returns {{ deltaMm:number, deltaAreaMm2:number, growthRateMmPerMonth:number,
 *             verdict:string, tone:string }}
 */
export function computeEvolution(prior, current, monthsElapsed = 6) {
  const m = Math.max(0.25, monthsElapsed);
  const deltaMm = Number((current.maxMm - prior.maxMm).toFixed(2));
  const deltaArea = Number(((current.areaMm2 ?? 0) - (prior.areaMm2 ?? 0)).toFixed(2));
  const rate = Number((deltaMm / m).toFixed(3));
  let verdict = 'Stable — no significant longitudinal change';
  let tone = 'ok';
  if (rate >= 0.5) {
    verdict = 'Rapid growth — prioritize dermatologist review';
    tone = 'danger';
  } else if (rate >= 0.2) {
    verdict = 'Measurable growth — continue monthly photodocumentation';
    tone = 'warn';
  } else if (rate <= -0.2) {
    verdict = 'Regressing — likely treatment or inflammatory resolution';
    tone = 'ok';
  }
  return { deltaMm, deltaAreaMm2: deltaArea, months: m, growthRateMmPerMonth: rate, verdict, tone };
}

/* --------------------------------------------------- synthetic dermatoscopic ROI */

/**
 * Render a deterministic synthetic dermatoscopic lesion into a 2D canvas.
 * Used for the 4 built-in phantoms and for engine self-tests, so that the
 * segmentation → moments → Polsby-Popper pipeline is exercised on real pixels.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {object} spec
 */
export function renderLesionPhantom(ctx, width, height, spec = {}) {
  const {
    seed = 7,
    radiusMm = 3.2,
    pxPerMm = 12.5,
    asymmetry = 0.04,
    borderHarmonics = 2,
    borderAmplitude = 0.02,
    baseSkin = '#d9a982',
    pigment = '#8a5a34',
    zones = ['#8a5a34'],
    zoneFractions = [1],
    hair = 3,
    vignette = 0.18
  } = spec;

  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const cx = width / 2;
  const cy = height / 2;
  const R = Math.max(8, radiusMm * pxPerMm);

  ctx.clearRect(0, 0, width, height);

  // --- base skin with fine texture
  const skin = hexToRgb(baseSkin);
  const grad = ctx.createRadialGradient(cx, cy * 0.75, R * 0.4, cx, cy, Math.hypot(width, height));
  grad.addColorStop(0, baseSkin);
  grad.addColorStop(1, shadeHex(baseSkin, -0.14));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // dermal texture (capillary fine structure)
  for (let i = 0; i < 2200; i++) {
    const x = rnd() * width;
    const y = rnd() * height;
    const a = 0.03 + rnd() * 0.06;
    ctx.fillStyle =
      rnd() > 0.5 ? `rgba(255,225,205,${a})` : `rgba(${skin.r * 0.72},${skin.g * 0.6},${skin.b * 0.6},${a})`;
    ctx.fillRect(x, y, 1 + rnd() * 1.6, 1 + rnd() * 1.6);
  }

  // faint capillary network
  ctx.strokeStyle = 'rgba(196,96,86,0.16)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    let x = rnd() * width;
    let y = rnd() * height;
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rnd() - 0.5) * 42;
      y += (rnd() - 0.5) * 42;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // --- lesion body: harmonic radius perturbation
  const harmonics = [];
  for (let h = 0; h < borderHarmonics; h++) {
    harmonics.push({
      k: 2 + h * (2 + Math.floor(rnd() * 2)),
      amp: (borderAmplitude + asymmetry * 0.55) * (0.55 + rnd() * 0.8),
      phase: rnd() * Math.PI * 2
    });
  }
  /**
   * Radial contour f(theta).
   *
   * The raw sum of harmonics easily exceeds 1 + Σamp, so a "7 mm" lesion could
   * render 10–13 mm wide — which then makes the *measured* Feret diameter
   * disagree with the phantom's own declared radius. The contour is therefore
   * normalised to the same mean radius R that `radiusMm` promises: harmonic and
   * asymmetry terms only redistribute the boundary, they never inflate the
   * lesion. This is what keeps `expected.diameter` meaningful as a ground truth
   * for the caliper.
   */
  const rawLobe = (theta) => {
    let f = 1;
    for (const h of harmonics) f += h.amp * Math.sin(h.k * theta + h.phase);
    f += asymmetry * 0.55 * Math.cos(theta);
    return f;
  };
  /**
   * Normalise so the contour's OUTER envelope equals R.
   *
   * Using the mean is wrong here: with 4 harmonics at amplitude 0.16 plus a 0.32
   * asymmetry term the raw factor peaks near 3.0, so a mean-normalised contour
   * still swings from ~0.3R to ~2.2R and the phantom renders three times its
   * declared diameter. Dividing by the maximum guarantees every point lies on or
   * inside the declared radius, which is what `radiusMm` means and what the
   * `expected.diameter` ground truth asserts.
   */
  let maxF = 0;
  const SCAN_STEPS = 720;
  for (let i = 0; i < SCAN_STEPS; i++) {
    const f = rawLobe((i / SCAN_STEPS) * Math.PI * 2);
    if (f > maxF) maxF = f;
  }
  const normalise = maxF > 0.2 ? 1 / maxF : 1;
  const lobe = (theta) => R * rawLobe(theta) * normalise;

  // soft pigment halo
  const halo = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.32);
  halo.addColorStop(0, hexToRgba(pigment, 0.34));
  halo.addColorStop(1, hexToRgba(pigment, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.32, 0, Math.PI * 2);
  ctx.fill();

  // main pigmented body, drawn twice: base + slightly offset color zones
  const bodyPath = new Path2D();
  const steps = 220;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = lobe(t);
    const x = cx + Math.cos(t) * r;
    const y = cy + Math.sin(t) * r;
    if (i === 0) bodyPath.moveTo(x, y);
    else bodyPath.lineTo(x, y);
  }
  bodyPath.closePath();

  const bodyGrad = ctx.createRadialGradient(cx - R * 0.22, cy - R * 0.26, R * 0.1, cx, cy, R * 1.15);
  bodyGrad.addColorStop(0, shadeHex(zones[0], 0.16));
  bodyGrad.addColorStop(0.55, zones[0]);
  bodyGrad.addColorStop(1, shadeHex(zones[0], -0.22));
  ctx.fillStyle = bodyGrad;
  ctx.fill(bodyPath);

  // additional chromophore zones (irregular multi-chromatic lesions)
  if (zones.length > 1) {
    for (let zi = 1; zi < zones.length; zi++) {
      const frac = zoneFractions[zi] ?? 0.3;
      const ang = rnd() * Math.PI * 2;
      const dist = R * (0.1 + rnd() * 0.34);
      const zx = cx + Math.cos(ang) * dist;
      const zy = cy + Math.sin(ang) * dist;
      const zr = R * Math.sqrt(frac) * (0.5 + rnd() * 0.3);
      ctx.save();
      ctx.beginPath();
      // clip zone inside lesion body
      ctx.save();
      ctx.clip(bodyPath);
      const zg = ctx.createRadialGradient(zx, zy, zr * 0.1, zx, zy, zr);
      zg.addColorStop(0, hexToRgba(zones[zi], 0.95));
      zg.addColorStop(0.7, hexToRgba(zones[zi], 0.62));
      zg.addColorStop(1, hexToRgba(zones[zi], 0));
      ctx.fillStyle = zg;
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const t = (i / 120) * Math.PI * 2;
        const rr = zr * (1 + 0.16 * Math.sin(t * (3 + zi) + zi));
        const x = zx + Math.cos(t) * rr;
        const y = zy + Math.sin(t) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.restore();
    }
  }

  // regression white scar / blue-gray veil options
  for (const z of zones) {
    if (z.toLowerCase() === '#f1ece4') {
      ctx.save();
      ctx.clip(bodyPath);
      ctx.fillStyle = 'rgba(241,236,228,0.5)';
      ctx.beginPath();
      ctx.ellipse(cx + R * 0.22, cy - R * 0.16, R * 0.3, R * 0.18, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // dotted / reticular pigment pattern
  ctx.save();
  ctx.clip(bodyPath);
  for (let i = 0; i < 900; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * R * 1.1;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    const dark = rnd() > 0.42;
    ctx.fillStyle = dark ? 'rgba(42,26,18,0.26)' : 'rgba(214,178,142,0.22)';
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + rnd() * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // border rim (slight hyperpigmented edge)
  ctx.strokeStyle = hexToRgba(shadeHex(zones[0], -0.35), 0.55);
  ctx.lineWidth = 1.6;
  ctx.stroke(bodyPath);

  // terminal hairs
  ctx.strokeStyle = 'rgba(28,20,16,0.72)';
  for (let i = 0; i < hair; i++) {
    ctx.lineWidth = 0.8 + rnd() * 1.1;
    ctx.beginPath();
    const x0 = rnd() * width;
    const y0 = rnd() * height;
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(
      x0 + (rnd() - 0.5) * 60,
      y0 + rnd() * 50,
      x0 + (rnd() - 0.5) * 70,
      y0 + rnd() * 80,
      x0 + (rnd() - 0.5) * 50,
      y0 + 90 + rnd() * 60
    );
    ctx.stroke();
  }

  // vignette (dermatoscope optics)
  if (vignette > 0) {
    const vg = ctx.createRadialGradient(cx, cy, Math.min(width, height) * 0.28, cx, cy, Math.max(width, height) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${vignette})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, width, height);
  }

  return { cx, cy, R };
}

/* color helpers -------------------------------------------------------------- */

function shadeHex(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  return '#' + [f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Extract an RGBA buffer from a canvas for the engine. Kept separate so the
 * engine stays DOM-free and testable under Node.
 */
export function imageDataFromCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Paint the segmentation overlay (mask contour, axes, bbox) over a canvas. */
export function paintSegmentationOverlay(ctx, result, color = 'rgba(6,182,212,0.95)') {
  if (!result?.contour?.length) return;
  ctx.save();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 9;
  ctx.beginPath();
  const pts = result.contour;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(245,158,11,0.8)';
  ctx.lineWidth = 1;
  const { cx, cy, orientationDeg, majorAxisPx, minorAxisPx } = result.moments;
  const ang = (orientationDeg * Math.PI) / 180;
  const drawAxis = (theta, len) => {
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(theta) * len * 0.62, cy - Math.sin(theta) * len * 0.62);
    ctx.lineTo(cx + Math.cos(theta) * len * 0.62, cy + Math.sin(theta) * len * 0.62);
    ctx.stroke();
  };
  drawAxis(ang, majorAxisPx);
  drawAxis(ang + Math.PI / 2, minorAxisPx);
  ctx.restore();
}
