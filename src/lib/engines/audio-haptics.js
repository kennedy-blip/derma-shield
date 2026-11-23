/**
 * DERMA-SHIELD · audio-haptics.js
 * -----------------------------------------------------------------------------
 * Reapplication alarms need to work with the phone in a beach bag. This module
 * synthesises short, distinguishable chimes with the Web Audio API (no asset
 * download, no network) and drives navigator.vibrate / Capacitor Haptics.
 *
 * Tones are tuned to a pentatonic ladder so alarms never sound harsh:
 *   vitamin-d-achieved  → rising perfect fifth (G5 → D6)
 *   spf-reapply         → two-note triple pulse (A5, A5, E6)
 *   burn-warning        → low descending minor third (F5 → D5)
 *   scan-confirm        → single soft blip (C6)
 *   vault-unlock        → two-note major third (E5 → G#5)
 * ------------------------------------------------------------------------- */

const PATTERNS = {
  'vitamin-d-achieved': {
    notes: [
      { f: 784.0, t: 0.0, d: 0.16, g: 0.16 },
      { f: 1174.7, t: 0.17, d: 0.34, g: 0.14 }
    ],
    vibrate: [28, 60, 28, 60, 60]
  },
  'spf-reapply': {
    notes: [
      { f: 880.0, t: 0.0, d: 0.12, g: 0.15 },
      { f: 880.0, t: 0.2, d: 0.12, g: 0.15 },
      { f: 1318.5, t: 0.4, d: 0.3, g: 0.13 }
    ],
    vibrate: [40, 80, 40, 80, 120]
  },
  'burn-warning': {
    notes: [
      { f: 698.5, t: 0.0, d: 0.22, g: 0.17 },
      { f: 587.3, t: 0.24, d: 0.42, g: 0.14 }
    ],
    vibrate: [90, 50, 90]
  },
  'scan-confirm': {
    notes: [{ f: 1046.5, t: 0.0, d: 0.1, g: 0.1 }],
    vibrate: [18]
  },
  'vault-unlock': {
    notes: [
      { f: 659.3, t: 0.0, d: 0.12, g: 0.12 },
      { f: 830.6, t: 0.13, d: 0.26, g: 0.1 }
    ],
    vibrate: [22, 40, 22]
  },
  'scan-error': {
    notes: [
      { f: 311.1, t: 0.0, d: 0.18, g: 0.16 },
      { f: 233.1, t: 0.2, d: 0.3, g: 0.14 }
    ],
    vibrate: [120, 60, 120]
  }
};

let ctx = null;
let master = null;

function ensureContext() {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    // A gentle low-pass keeps the synth chime from sounding piercing outdoors.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6200;
    lp.Q.value = 0.4;
    master.connect(lp).connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

async function resumeIfSuspended() {
  if (ctx?.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      /* user gesture required */
    }
  }
}

/**
 * Play a synthesized chime.
 * @param {keyof typeof PATTERNS} name
 * @param {{ volume?:number, enabled?:boolean }} [opts]
 */
export async function playChime(name, opts = {}) {
  if (opts.enabled === false) return false;
  const pattern = PATTERNS[name];
  if (!pattern) return false;
  const ac = ensureContext();
  if (!ac) return false;
  await resumeIfSuspended();

  const now = ac.currentTime;
  for (const note of pattern.notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(note.f, now + note.t);
    // Soft attack, exponential decay — bell-like without recording assets.
    gain.gain.setValueAtTime(0.0001, now + note.t);
    gain.gain.exponentialRampToValueAtTime(note.g * (opts.volume ?? 1), now + note.t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.t + note.d);
    osc.connect(gain).connect(master);
    osc.start(now + note.t);
    osc.stop(now + note.t + note.d + 0.02);
  }
  return true;
}

/**
 * Vibration + native haptics. Silently no-ops on desktop Safari.
 * @param {string} name
 * @param {{ enabled?:boolean }} [opts]
 */
export async function triggerHaptics(name, opts = {}) {
  if (opts.enabled === false) return false;
  const pattern = PATTERNS[name]?.vibrate ?? [24];
  let fired = false;

  // Capacitor Haptics (native .APK)
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (cap?.Plugins?.Haptics) {
    try {
      await cap.Plugins.Haptics.impact({ style: 'MEDIUM' });
      fired = true;
    } catch {
      /* fall through */
    }
  }
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      fired = navigator.vibrate(pattern) || fired;
    } catch {
      /* blocked */
    }
  }
  return fired;
}

/** Fire the full alarm (chime + haptics) with one call. */
export async function alarm(name, opts = {}) {
  const [sound, haptic] = await Promise.all([
    playChime(name, { enabled: opts.sound !== false }),
    triggerHaptics(name, { enabled: opts.haptic !== false })
  ]);
  return { sound, haptic };
}

/** Continuous rising "UV meter" tone used while sweeping the shadow clinometer. */
export function createClinometerTone() {
  const ac = ensureContext();
  if (!ac) return { start() {}, stop() {}, setElevation() {} };
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 440;
  gain.gain.value = 0.0001;
  osc.connect(gain).connect(master);
  let running = false;
  return {
    start() {
      if (running) return;
      running = true;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.05, ac.currentTime + 0.15);
    },
    stop() {
      if (!running) return;
      running = false;
      try {
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.12);
        osc.stop(ac.currentTime + 0.15);
      } catch {
        /* already stopped */
      }
    },
    /** Map elevation 0–90° onto a two-octave glide. */
    setElevation(deg) {
      const f = 220 * Math.pow(2, Math.max(0, Math.min(90, deg)) / 45);
      osc.frequency.setTargetAtTime(f, ac.currentTime, 0.05);
    }
  };
}

/** Unlock the audio context from a user gesture (required on iOS). */
export async function unlockAudio() {
  const ac = ensureContext();
  if (!ac) return false;
  await resumeIfSuspended();
  return ac.state === 'running';
}

export const CHIME_NAMES = Object.keys(PATTERNS);
