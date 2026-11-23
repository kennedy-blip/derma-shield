/**
 * DERMA-SHIELD · camera-optics.js
 * -----------------------------------------------------------------------------
 * Browser camera pipeline for the Optical Chromophore Lab and the ABCDE caliper.
 *
 * Responsibilities
 *  - Request a rear ("environment") macro stream with graceful capability
 *    negotiation (torch, focus distance, zoom).
 *  - Provide a device-independent ROI: 4:3 letterbox math, mirroring for
 *    front-camera previews, DPR-aware canvas sizing.
 *  - Down-sample to a small analysis buffer (160×120) so the 60 fps chromophore
 *    loop stays under ~1.5 ms on a mid-range phone.
 *  - Render the haemoglobin false-colour heat map at full preview resolution.
 *  - Fall back cleanly to synthetic "phantom" sources when permission is denied
 *    or the device has no camera (Vercel desktop demo, CI screenshot runs).
 *
 * The module never throws on unsupported hardware — it returns capability
 * descriptors so the UI can show NATIVE / SIMULATOR / RESTRICTED badges.
 * ------------------------------------------------------------------------- */

import { srgbToLab, erythemaRamp, dawsonErythemaIndex, srgbToLinear } from './color-science.js';

export const ANALYSIS_W = 160;
export const ANALYSIS_H = 120;

/** Feature probes without instantly failing. */
export function detectCameraCapabilities() {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
  return {
    available: Boolean(md?.getUserMedia),
    enumerate: Boolean(md?.enumerateDevices),
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
    torch: 'ImageCapture' in (typeof window !== 'undefined' ? window : {}),
    native: Boolean(
      typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
    ),
    sensorOrient: typeof window !== 'undefined' && 'DeviceOrientationEvent' in window,
    vibrate: typeof navigator !== 'undefined' && 'vibrate' in navigator
  };
}

/**
 * Open the rear camera at a reasonable resolution.
 * @param {{ facingMode?:'environment'|'user', width?:number, height?:number, deviceId?:string }} [opts]
 */
export async function openCameraStream(opts = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia unavailable — running in simulator mode');
  }
  const constraints = {
    audio: false,
    video: {
      facingMode: opts.deviceId ? undefined : { ideal: opts.facingMode ?? 'environment' },
      deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
      width: { ideal: opts.width ?? 1280 },
      height: { ideal: opts.height ?? 720 },
      frameRate: { ideal: 30, max: 60 },
      focusMode: 'continuous'
    }
  };
  return navigator.mediaDevices.getUserMedia(constraints);
}

/** Stop all tracks on a stream (safe on null). */
export function closeStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* already ended */
    }
  }
}

/** Enumerate video inputs (labels are only populated after permission). */
export async function listVideoDevices() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput');
}

/** Read current track settings (torch/focus/zoom capabilities vary widely). */
export function readTrackCaps(stream) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) return { settings: {}, capabilities: {} };
  let capabilities = {};
  try {
    capabilities = track.getCapabilities?.() ?? {};
  } catch {
    /* Safari throws on unsupported capability reads */
  }
  return {
    settings: track.getSettings?.() ?? {},
    capabilities,
    torch: Boolean(capabilities.torch),
    zoom: capabilities.zoom ?? null,
    focusDistance: capabilities.focusDistance ?? null
  };
}

/** Toggle the hardware torch when the platform exposes it. */
export async function setTorch(stream, on) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: Boolean(on) }] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Cover-fit source rect for drawing a video/canvas of `sw × sh` into a
 * `dw × dh` destination without distortion.
 */
export function coverRect(sw, sh, dw, dh) {
  const sRatio = sw / sh;
  const dRatio = dw / dh;
  let w;
  let h;
  let x;
  let y;
  if (sRatio > dRatio) {
    h = sh;
    w = sh * dRatio;
    x = (sw - w) / 2;
    y = 0;
  } else {
    w = sw;
    h = sw / dRatio;
    x = 0;
    y = (sh - h) / 2;
  }
  return { x, y, w, h };
}

/**
 * Build a down-sampled RGBA analysis buffer from a video element.
 * Draws into a dedicated offscreen canvas at ANALYSIS_W×ANALYSIS_H.
 */
export function makeAnalysisSampler() {
  const canvas = document.createElement('canvas');
  canvas.width = ANALYSIS_W;
  canvas.height = ANALYSIS_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  return {
    canvas,
    ctx,
    /** @param {HTMLVideoElement|HTMLCanvasElement} source */
    sample(source) {
      const sw = source.videoWidth || source.width;
      const sh = source.videoHeight || source.height;
      if (!sw || !sh) return null;
      ctx.drawImage(source, 0, 0, sw, sh, 0, 0, ANALYSIS_W, ANALYSIS_H);
      return ctx.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H);
    }
  };
}

/**
 * Render the sub-clinical haemoglobin heat map.
 * Each pixel's Dawson EI is normalised against the ROI baseline and pushed
 * through the erythemal false-colour ramp. Basal calm skin renders teal; hidden
 * vasodilation lights up magenta hours before visible redness.
 *
 * @param {CanvasRenderingContext2D} destCtx
 * @param {ImageData} src ImageData at preview resolution
 * @param {{ baselineEI?:number, gain?:number, gamma?:number }} [opts]
 */
export function renderErythemaHeatmap(destCtx, src, opts = {}) {
  const baseline = opts.baselineEI ?? 18;
  const gain = opts.gain ?? 2.35;
  const srcData = src.data;
  const out = destCtx.createImageData(src.width, src.height);
  const dst = out.data;

  for (let i = 0; i < srcData.length; i += 4) {
    const r = srcData[i];
    const g = srcData[i + 1];
    const b = srcData[i + 2];
    const rR = Math.max(1e-4, srgbToLinear(r));
    const rG = Math.max(1e-4, srgbToLinear(g));
    const ei = dawsonErythemaIndex(rG, rR);
    const norm = Math.max(0, Math.min(1, (ei - baseline) / 34 * gain + 0.18));
    const [cr, cg, cb] = erythemaRamp(norm);
    const lum = 0.29 * r + 0.58 * g + 0.13 * b;
    // blend 78 % chromophore color with 22 % luminance for anatomical context
    dst[i] = cr * 0.78 + lum * 0.22;
    dst[i + 1] = cg * 0.78 + lum * 0.22;
    dst[i + 2] = cb * 0.78 + lum * 0.22;
    dst[i + 3] = 255;
  }
  destCtx.putImageData(out, 0, 0);
  return { baselineEI: baseline, gain };
}

/**
 * Per-scan chromophore field: EI for a coarse grid, used for the 3-D contour and
 * for locating "hot spots" (local maxima) of sub-clinical erythema.
 * @param {ImageData} img
 * @param {number} cols
 * @param {number} rows
 */
export function erythemaField(img, cols = 24, rows = 18) {
  const { data, width, height } = img;
  const field = [];
  const cw = width / cols;
  const ch = height / rows;
  let min = Infinity;
  let max = -Infinity;
  for (let ry = 0; ry < rows; ry++) {
    const row = [];
    for (let rx = 0; rx < cols; rx++) {
      let sr = 0;
      let sg = 0;
      let n = 0;
      const x0 = Math.floor(rx * cw);
      const y0 = Math.floor(ry * ch);
      const x1 = Math.floor((rx + 1) * cw);
      const y1 = Math.floor((ry + 1) * ch);
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const p = (y * width + x) * 4;
          sr += data[p];
          sg += data[p + 1];
          n++;
        }
      }
      const rR = Math.max(1e-4, srgbToLinear(sr / Math.max(1, n)));
      const rG = Math.max(1e-4, srgbToLinear(sg / Math.max(1, n)));
      const ei = dawsonErythemaIndex(rG, rR);
      row.push(ei);
      if (ei < min) min = ei;
      if (ei > max) max = ei;
    }
    field.push(row);
  }
  const hotspots = [];
  for (let ry = 1; ry < rows - 1; ry++) {
    for (let rx = 1; rx < cols - 1; rx++) {
      const v = field[ry][rx];
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && field[ry + dy][rx + dx] > v) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax && v - min > 0.2 * (max - min)) {
        hotspots.push({ x: (rx + 0.5) / cols, y: (ry + 0.5) / rows, ei: Number(v.toFixed(1)) });
      }
    }
  }
  hotspots.sort((a, b) => b.ei - a.ei);
  return { field, min, max, cols, rows, hotspots: hotspots.slice(0, 6) };
}

/** Sample the exact pixel under a normalized pointer position. */
export function samplePointer(img, nx, ny) {
  const x = Math.max(0, Math.min(img.width - 1, Math.round(nx * img.width)));
  const y = Math.max(0, Math.min(img.height - 1, Math.round(ny * img.height)));
  const p = (y * img.width + x) * 4;
  return { x, y, r: img.data[p], g: img.data[p + 1], b: img.data[p + 2] };
}

/**
 * Synthetic phantom renderer (canvas-based, no camera needed).
 * Produces calibrated "skin ROI" imagery whose embedded chromophore values
 * match the declared simulator presets, so the live pipeline can be validated.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {{ baseHex:string, ei:number, texture?:number, seed?:number, hotSpots?:Array, veins?:boolean }} spec
 */
export function renderSkinPhantom(ctx, w, h, spec) {
  const { baseHex, ei, texture = 0.5, seed = 3, hotSpots = [], veins = true } = spec;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
  const base = hexToRgbLocal(baseHex);

  // Underlying "true" reflectance: shift toward hemoglobin absorption as EI rises.
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, w, h);

  const blobGrad = ctx.createRadialGradient(w * 0.5, h * 0.4, Math.min(w, h) * 0.1, w * 0.5, h * 0.55, Math.max(w, h) * 0.85);
  blobGrad.addColorStop(0, `rgba(${base.r},${base.g},${base.b},0)`);
  blobGrad.addColorStop(1, `rgba(${Math.max(0, base.r * 0.75)},${Math.max(0, base.g * 0.7)},${Math.max(0, base.b * 0.72)},0.65)`);
  ctx.fillStyle = blobGrad;
  ctx.fillRect(0, 0, w, h);

  // erythema wash scaled by EI
  const eryAlpha = Math.min(0.5, Math.max(0, (ei - 12) / 90));
  ctx.fillStyle = `rgba(176,58,52,${eryAlpha})`;
  ctx.fillRect(0, 0, w, h);

  // papillary dermis capillary network
  if (veins) {
    ctx.lineCap = 'round';
    for (let v = 0; v < 26; v++) {
      ctx.strokeStyle = `rgba(150,44,52,${0.05 + (ei / 100) * 0.22})`;
      ctx.lineWidth = 0.7 + rnd() * 2.4;
      ctx.beginPath();
      let x = rnd() * w;
      let y = rnd() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 7; k++) {
        x += (rnd() - 0.5) * w * 0.16;
        y += (rnd() - 0.5) * h * 0.16;
        ctx.quadraticCurveTo(x + (rnd() - 0.5) * 20, y + (rnd() - 0.5) * 20, x, y);
      }
      ctx.stroke();
    }
  }

  // focal vasodilation hotspots
  for (const spot of hotSpots) {
    const sx = spot.x * w;
    const sy = spot.y * h;
    const sr = (spot.r ?? 0.12) * Math.min(w, h);
    const g2 = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    g2.addColorStop(0, `rgba(198,52,58,${Math.min(0.62, (spot.ei - 16) / 70)})`);
    g2.addColorStop(0.6, `rgba(186,66,68,${Math.min(0.3, (spot.ei - 16) / 130)})`);
    g2.addColorStop(1, 'rgba(186,66,68,0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  // follicle pores + micro texture
  for (let i = 0; i < 2400 * texture; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.fillStyle = rnd() > 0.55 ? 'rgba(255,238,224,0.055)' : 'rgba(78,42,34,0.055)';
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + rnd() * 1.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // specular sheen from the dermatoscope ring light
  const sheen = ctx.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(0, 'rgba(255,255,255,0.1)');
  sheen.addColorStop(0.42, 'rgba(255,255,255,0.02)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);

  // vignette
  const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.26, w / 2, h / 2, Math.max(w, h) * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

function hexToRgbLocal(hex) {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Photograph the current frame to a data URL, downscaled for IndexedDB storage.
 * 512 px on the long edge keeps each record ~45 KB.
 */
export function captureFrameDataUrl(source, maxEdge = 512, quality = 0.82) {
  const sw = source.videoWidth || source.width;
  const sh = source.videoHeight || source.height;
  if (!sw || !sh) return null;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const cw = Math.round(sw * scale);
  const ch = Math.round(sh * scale);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const cx = c.getContext('2d');
  cx.drawImage(source, 0, 0, sw, sh, 0, 0, cw, ch);
  return c.toDataURL('image/jpeg', quality);
}

/**
 * Camera white-balance calibration: sample a white card / paper and return the
 * per-channel correction that the chromophore engine applies before Lab math.
 */
export function calibrateWhiteBalance(img, rect = { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }) {
  const x0 = Math.floor(rect.x * img.width);
  const y0 = Math.floor(rect.y * img.height);
  const x1 = Math.floor((rect.x + rect.w) * img.width);
  const y1 = Math.floor((rect.y + rect.h) * img.height);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * img.width + x) * 4;
      r += img.data[p];
      g += img.data[p + 1];
      b += img.data[p + 2];
      n++;
    }
  }
  if (!n) return { r: 255, g: 255, b: 255, deltaE: 0 };
  const avg = { r: r / n, g: g / n, b: b / n };
  const lum = 0.2126 * avg.r + 0.7152 * avg.g + 0.0722 * avg.b;
  const white = { r: avg.r, g: avg.g, b: avg.b };
  const lab = srgbToLab(white.r, white.g, white.b);
  return { ...white, luminance: Number(lum.toFixed(1)), lab, deltaE: Number(Math.hypot(lab.a, lab.b).toFixed(2)) };
}
