/**
 * DERMA-SHIELD · sensor-bridge.js
 * -----------------------------------------------------------------------------
 * Unified sensor abstraction over three interchangeable backends:
 *
 *  1. NATIVE KOTLIN — Capacitor plugin `UvLuxBarometer` (UvLuxBarometerPlugin.kt)
 *     exposes TYPE_LIGHT lux, TYPE_PRESSURE altitude, and TYPE_ROTATION_VECTOR
 *     shadow clinometer. Preferred inside the .APK.
 *  2. WEB SENSORS — AmbientLightSensor (Chromium), DeviceOrientationEvent for
 *     the gyro specular + clinometer, BatteryStatus for the low-GPU governor.
 *  3. SIMULATOR — deterministic synthetic telemetry so the whole product remains
 *     demonstrable on a desktop Vercel session and in CI screenshots.
 *
 * The bridge also performs the off-grid UV Index estimate:
 *   UV Index ≈ f(lux, solar elevation) with a wavelength-weighted calibration
 *   and an altitude boost of +4 % per 300 m. When a lux sensor is absent it
 *   degrades to shadow-ratio + solar geometry (pure off-grid math).
 * ----------------------------------------------------------------------------- */

import {
  uvIndexFromShadow,
  uvIndexFromGeometry,
  solarElevationFromShadow,
  altitudeMultiplier,
  solarZenith,
  airMass,
  ALBEDO_PRESETS
} from './photobiology.js';

export const SENSOR_STATES = Object.freeze({
  NATIVE: 'NATIVE KOTLIN',
  WEB: 'WEB ACTIVE',
  SIM: 'SIMULATOR ACTIVE',
  RESTRICTED: 'RESTRICTED'
});

/**
 * Empirical lux → erythemal UV conversion.
 *
 * A clear-sky global illuminance of 100,000 lx corresponds to a UV Index around
 * 11–12 at solar noon at the equator. UV/visible ratios collapse at low sun and
 * under cloud, so the estimate is gated by solar elevation: below ~12° the
 * UVB fraction is negligible regardless of lux.
 */
export function uvIndexFromLux(lux, elevationDeg = 50, altitudeM = 0) {
  if (!(lux > 0)) return 0;
  const luxUvi = (lux / 100000) * 11.6;
  // Elevation gate: erythemal UV scales roughly with sin(elev)^2.4.
  const sinE = Math.max(0, Math.sin((Math.max(0, elevationDeg) * Math.PI) / 180));
  const gate = Math.pow(sinE, 2.4);
  const alt = altitudeMultiplier(altitudeM);
  return Number((luxUvi * gate * alt).toFixed(2));
}

/** Barometric altitude from sea-level pressure (ISA): h = 44330(1 − (p/p0)^0.19). */
export function altitudeFromPressure(hPa, seaLevelHPa = 1013.25) {
  if (!(hPa > 0)) return 0;
  return Number((44330 * (1 - Math.pow(hPa / seaLevelHPa, 0.1903))).toFixed(1));
}

/** ISA sea-level pressure correction for a known altitude. */
export function seaLevelPressure(hPa, altitudeM) {
  return hPa / Math.pow(1 - altitudeM / 44330, 5.255);
}

/**
 * Device tilt → shadow clinometer input.
 * We measure the *pitch* of the phone when the operator aligns the screen edge
 * with the shadow tip; elevation = 90° − |pitch| in the flat-along-shadow pose.
 */
export function elevationFromPitch(pitchDeg, rollDeg = 0) {
  const p = Math.abs(pitchDeg);
  const r = Math.abs(rollDeg);
  const combined = Math.min(90, Math.hypot(p, r * 0.35));
  return Number(Math.max(0, 90 - combined).toFixed(1));
}

/**
 * Sensor telemetry store. Svelte 5 runes-friendly: `createSensorBridge()` returns
 * a plain object with `read()` + `subscribe()`; the component wraps it in $state.
 */
export function createSensorBridge(options = {}) {
  const state = {
    backend: SENSOR_STATES.SIM,
    lux: null,
    pressureHpa: null,
    altitudeM: options.altitudeM ?? 1650, // default: Nairobi-adjacent highland demo
    pitch: 0,
    roll: 0,
    heading: 0,
    battery: null,
    solarElevationDeg: null,
    shadowRatio: null,
    uvIndexOffgrid: null,
    source: 'simulator',
    lastUpdate: 0,
    permission: 'idle',
    error: null
  };

  const listeners = new Set();
  const emit = () => {
    state.lastUpdate = Date.now();
    for (const fn of listeners) fn(state);
  };

  let lightSensor = null;
  let orientationHandler = null;
  let batteryRef = null;

  async function attachNative() {
    const cap = typeof window !== 'undefined' ? window.Capacitor : null;
    if (!cap?.Plugins?.UvLuxBarometer) {
      state.backend = SENSOR_STATES.RESTRICTED;
      state.error = 'Native UvLuxBarometer plugin not registered';
      emit();
      return false;
    }
    try {
      const plugin = cap.Plugins.UvLuxBarometer;
      await plugin.start({ intervalMs: 900 });
      plugin.addListener('sensorUpdate', (reading) => {
        state.lux = reading.lux ?? state.lux;
        state.pressureHpa = reading.pressureHpa ?? state.pressureHpa;
        state.altitudeM = reading.altitudeM ?? state.altitudeM;
        state.pitch = reading.pitch ?? state.pitch;
        state.roll = reading.roll ?? state.roll;
        state.heading = reading.heading ?? state.heading;
        state.backend = SENSOR_STATES.NATIVE;
        state.source = 'TYPE_LIGHT + TYPE_PRESSURE + TYPE_ROTATION_VECTOR';
        recompute();
        emit();
      });
      state.backend = SENSOR_STATES.NATIVE;
      return true;
    } catch (err) {
      state.error = String(err?.message ?? err);
      emit();
      return false;
    }
  }

  async function attachWeb() {
    let attached = false;

    // AmbientLightSensor (Chromium behind a flag on most builds)
    try {
      if ('AmbientLightSensor' in window) {
        lightSensor = new window.AmbientLightSensor({ frequency: 2 });
        lightSensor.addEventListener('reading', () => {
          state.lux = lightSensor.illuminance;
          state.source = 'AmbientLightSensor';
          recompute();
          emit();
        });
        lightSensor.start();
        attached = true;
      }
    } catch (err) {
      state.error = String(err?.message ?? err);
    }

    // Orientation for the clinometer + gyro specular
    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      const handler = (ev) => {
        if (ev.beta == null && ev.gamma == null) return;
        state.pitch = ev.beta ?? state.pitch;
        state.roll = ev.gamma ?? state.roll;
        state.heading = ev.alpha ?? state.heading;
        recompute();
        emit();
      };
      window.addEventListener('deviceorientation', handler, { passive: true });
      orientationHandler = handler;
      attached = true;
    }

    // Battery governor input
    try {
      if (navigator.getBattery) {
        batteryRef = await navigator.getBattery();
        state.battery = {
          level: batteryRef.level,
          charging: batteryRef.charging,
          lowPower: batteryRef.level < 0.18 && !batteryRef.charging
        };
      }
    } catch {
      /* not supported */
    }

    state.backend = attached ? SENSOR_STATES.WEB : SENSOR_STATES.SIM;
    return attached;
  }

  function recompute() {
    const elevation =
      state.pitch || state.roll
        ? elevationFromPitch(state.pitch, state.roll)
        : state.solarElevationDeg;
    if (elevation != null) state.solarElevationDeg = elevation;

    if (state.lux != null && elevation != null) {
      state.uvIndexOffgrid = uvIndexFromLux(state.lux, elevation, state.altitudeM ?? 0);
    } else if (state.shadowRatio != null && state.shadowRatio > 0) {
      const r = uvIndexFromShadow({
        heightM: 1,
        shadowM: state.shadowRatio,
        altitudeM: state.altitudeM ?? 0
      });
      state.solarElevationDeg = r.elevationDeg;
      state.uvIndexOffgrid = r.uvIndex;
    } else if (elevation != null) {
      state.uvIndexOffgrid = uvIndexFromGeometry({
        elevationDeg: elevation,
        altitudeM: state.altitudeM ?? 0
      });
    }
  }

  return {
    state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async start() {
      state.permission = 'requesting';
      emit();
      const native = await attachNative();
      if (!native) await attachWeb();
      if (!state.lux) {
        // no hardware light sensor → simulator keeps the product usable
        state.backend = state.backend === SENSOR_STATES.NATIVE ? state.backend : SENSOR_STATES.SIM;
        state.source = 'Simulated TYPE_LIGHT (60 000 lx) + barometric altimeter';
        state.lux = state.lux ?? 60000;
        state.pressureHpa = state.pressureHpa ?? 1013.25 * Math.pow(1 - (state.altitudeM ?? 0) / 44330, 5.255);
      }
      state.permission = 'granted';
      recompute();
      emit();
      return state;
    },
    stop() {
      if (lightSensor) {
        try {
          lightSensor.stop();
        } catch {
          /* noop */
        }
        lightSensor = null;
      }
      if (orientationHandler) {
        window.removeEventListener('deviceorientation', orientationHandler);
        orientationHandler = null;
      }
      emit();
    },
    /** Manual shadow clinometer entry (William's ratio). */
    setShadowRatio(ratio) {
      state.shadowRatio = Math.max(0.02, Number(ratio) || 0.02);
      recompute();
      emit();
    },
    setManualElevation(deg) {
      state.solarElevationDeg = Math.max(0, Math.min(90, Number(deg) || 0));
      state.shadowRatio = null;
      recompute();
      emit();
    },
    setLux(lux) {
      state.lux = Math.max(0, Number(lux) || 0);
      recompute();
      emit();
    },
    setAltitude(m) {
      state.altitudeM = Math.max(0, Number(m) || 0);
      state.pressureHpa = 1013.25 * Math.pow(1 - state.altitudeM / 44330, 5.255);
      recompute();
      emit();
    },
    /** Ask the OS for motion permission (iOS 13+ requires a user gesture). */
    async requestMotionPermission() {
      const anyDo = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null;
      if (anyDo?.requestPermission) {
        try {
          const res = await anyDo.requestPermission();
          state.permission = res === 'granted' ? 'granted' : 'denied';
          return res === 'granted';
        } catch {
          state.permission = 'denied';
          return false;
        }
      }
      state.permission = 'granted';
      return true;
    }
  };
}

/**
 * Compute the off-grid UV advisory block, including the Shadow-Ratio graphic
 * geometry and a confidence estimate for the reading.
 */
export function shadowClinometerReport({ heightM = 1, shadowM = 1, altitudeM = 0, albedo = 0.05, ozoneDU = 300 }) {
  const elevation = solarElevationFromShadow(heightM, shadowM);
  const uvi = uvIndexFromGeometry({ elevationDeg: elevation, altitudeM, albedo, ozoneDU });
  const am = airMass(90 - elevation);
  const confidence =
    elevation < 8
      ? 'LOW — Sun below 8°, UVB negligible'
      : elevation > 82
        ? 'MEDIUM — near-zenith, shadow too short to measure precisely'
        : shadowM > 1.4
          ? 'HIGH — ideal William’s ratio geometry'
          : 'GOOD';
  return {
    elevationDeg: Number(elevation.toFixed(2)),
    shadowRatio: Number((shadowM / Math.max(0.01, heightM)).toFixed(3)),
    uvIndex: Number(uvi.toFixed(2)),
    opticalAirMass: Number(am.toFixed(2)),
    confidence,
    albedoLabel: ALBEDO_PRESETS.find((a) => Math.abs(a.albedo - albedo) < 0.01)?.label ?? 'Custom surface'
  };
}

/**
 * Estimate today's solar elevation for a location + wall-clock time without any
 * API. Used as the baseline before a shadow reading.
 */
export function estimateSolarElevationNow(latitude, longitude, when = new Date()) {
  const start = Date.UTC(when.getUTCFullYear(), 0, 0);
  const day = Math.floor((when.getTime() - start) / 86400000);
  const solarHour =
    ((when.getUTCHours() + when.getUTCMinutes() / 60 + longitude / 15) % 24 + 24) % 24;
  return Number((90 - solarZenith(latitude, day, solarHour)).toFixed(2));
}
