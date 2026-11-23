/**
 * DERMA-SHIELD · Stat.js
 * Formatting helpers shared by every numeric readout. Keeping them here (rather
 * than inline in markup) guarantees the Python `api/derma_photobiology.py`
 * formatter and the JS UI agree on precision and sign conventions.
 */

/** Format a number with fixed precision, em-dash for null/NaN. */
export function fmt(v, digits = 1, dash = '—') {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v)) return dash;
  return Number(v).toFixed(digits);
}

/** Minutes → "1 h 24 m" / "48 m" / "—". */
export function fmtMinutes(min) {
  if (min == null || !Number.isFinite(min)) return '—';
  if (min > 60 * 24) return '> 24 h';
  if (min < 1) return '< 1 m';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`;
}

/** Compact integer with grouping. */
export function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

/** Seconds → mm:ss (used by the live exposure stopwatch). */
export function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Signed value with explicit + prefix. */
export function fmtSigned(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${Number(v).toFixed(digits)}`;
}

/** Percentage with 0–100 clamps. */
export function fmtPct(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.max(0, Math.min(100, v)).toFixed(digits)} %`;
}

/** Human date/time (local). */
export function fmtWhen(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** Risk tone → accent token. */
export const TONE_COLOR = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  info: 'var(--accent)'
};
