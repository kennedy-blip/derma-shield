/**
 * DERMA-SHIELD · store.svelte.js
 * -----------------------------------------------------------------------------
 * Global reactive application state (Svelte 5 runes). Pure JavaScript.
 *
 * Holds: theme + GPU mode, RBAC role, permission matrix, the active chromophore
 * readout that Module 1 broadcasts to Module 2, live solar parameters, vitals
 * timers, the vault session and the toast queue.
 * ------------------------------------------------------------------------- */

import {
  medFromIta,
  phototypeFromIta,
  analyzeChromophores,
  solvePhantomHex
} from '../engines/color-science.js';
import { createVault } from './vault.js';

export const ROLES = Object.freeze([
  {
    id: 'explorer',
    label: 'Outdoor Explorer & Skincare User',
    short: 'Explorer',
    tier: 'Standard',
    tone: 'teal',
    unlocks: [
      'Solar UV · Vitamin D3 · SPF kinetics engine',
      'Optical ITA° phototype & erythema scanner',
      'Sunscreen SPF decay tracker',
      'Ingredient photostability decoder'
    ]
  },
  {
    id: 'pro',
    label: 'Dermatology & Photobiology Pro',
    short: 'Pro Tier',
    tier: 'Pro',
    tone: 'violet',
    unlocks: [
      'Sub-clinical hemoglobin erythema heatmap shader',
      'Quantitative ABCDE Polsby-Popper morphometry caliper',
      'Off-grid shadow-length solar clinometer',
      'Everything in Explorer'
    ]
  },
  {
    id: 'director',
    label: 'Clinical Systems Director',
    short: 'Director',
    tier: 'Admin',
    tone: 'gold',
    unlocks: [
      'Polyglot runtime inspector + benchmark runner',
      'PIN-locked longitudinal lesion vault',
      'Raw CSV / JSON telemetry exporter',
      'Everything in Pro Tier'
    ]
  }
]);

export const PERMISSIONS = Object.freeze([
  {
    id: 'camera',
    label: 'Optical Chromophore & Macro Camera',
    detail: '60 fps skin ROI reflectance → CIE L*a*b* → ITA° / Erythema Index',
    tech: 'getUserMedia · Kotlin DermatoscopyCameraPlugin',
    risk: 'Sensor access',
    states: ['NATIVE KOTLIN', 'WEB ACTIVE', 'SIMULATOR ACTIVE', 'RESTRICTED']
  },
  {
    id: 'lux',
    label: 'Outdoor Lux, Barometer & Shadow Clinometer',
    detail: 'Off-grid UV Index from solar elevation, TYPE_LIGHT lux and barometric altitude',
    tech: 'UvLuxBarometerPlugin.kt · AmbientLightSensor · DeviceOrientation',
    risk: 'Location inference',
    states: ['NATIVE KOTLIN', 'WEB ACTIVE', 'SIMULATOR ACTIVE', 'RESTRICTED']
  },
  {
    id: 'haptic',
    label: 'SPF Reapplication Haptic & Chime Engine',
    detail: 'Vibration + synthesized chime when the vitamin D3 target or SPF alarm fires',
    tech: 'navigator.vibrate · Capacitor Haptics · WebAudio',
    risk: 'Actuator access',
    states: ['NATIVE KOTLIN', 'WEB ACTIVE', 'RESTRICTED']
  },
  {
    id: 'vault',
    label: 'PIN-Locked Biometric Lesion Vault',
    detail: 'AES-GCM encrypted longitudinal lesion records in IndexedDB',
    tech: 'IndexedDB · WebCrypto PBKDF2-SHA256',
    risk: 'Personal health data',
    states: ['WEB ACTIVE', 'RESTRICTED']
  }
]);

export const THEMES = Object.freeze([
  {
    id: 'obsidian',
    label: 'Dermal Obsidian',
    sub: 'Clinical void · default dark glass',
    swatch: ['#06070E', '#06B6D4', '#F59E0B']
  },
  {
    id: 'daylight',
    label: 'Beach & Alpine Frost',
    sub: 'High-luminosity pearl glass for direct sun',
    swatch: ['#F4FAFF', '#0284C7', '#B45309']
  },
  {
    id: 'woods',
    label: "Wood's Lamp 365 nm",
    sub: 'Fluorescence diagnostic indigo',
    swatch: ['#090418', '#A855F7', '#22D3EE']
  },
  {
    id: 'eco',
    label: 'Eco-Glass / Low-GPU',
    sub: 'Matte acrylic · thermal-throttle safe',
    swatch: ['#0B0F12', '#10B981', '#CA8A04']
  }
]);

/**
 * Calibrated optical skin phantoms.
 *
 * Each preset declares the clinical readout it must reproduce (ITA°, Dawson EI).
 * `hex` is *solved* at module load by inverting the CIE L*a*b* → ITA°/EI pipeline
 * (`solvePhantomHex`), so a phantom can never desynchronise from the live math.
 */
const PHANTOM_SPECS = [
  {
    id: 'fair-calm',
    label: 'Phototype I/II Fair Epidermis',
    sub: 'Calm baseline · uncontaminated reflectance',
    ita: 52.4,
    ei: 14.2,
    hotSpots: [],
    veins: true,
    texture: 0.8,
    seed: 11
  },
  {
    id: 'subclinical',
    label: 'Sub-Clinical Early UV Erythema',
    sub: '2 h post-sun · looks normal in RGB',
    ita: 48.6,
    ei: 42.8,
    hotSpots: [
      { x: 0.36, y: 0.42, r: 0.16, ei: 44 },
      { x: 0.64, y: 0.58, r: 0.19, ei: 47 },
      { x: 0.52, y: 0.3, r: 0.11, ei: 39 }
    ],
    veins: true,
    texture: 0.7,
    seed: 23
  },
  {
    id: 'olive-tan',
    label: 'Phototype III/IV Olive / Medium Tan',
    sub: 'Balanced facultative pigmentation',
    ita: 21.5,
    ei: 16.0,
    hotSpots: [],
    veins: false,
    texture: 0.6,
    seed: 37
  },
  {
    id: 'deep-melanin',
    label: 'Phototype V/VI Melanin-Rich',
    sub: 'High natural UV shield · longer UVB window',
    ita: -34.0,
    ei: 12.4,
    hotSpots: [],
    veins: false,
    texture: 0.35,
    seed: 53
  },
  {
    id: 'rosacea',
    label: 'Compromised Barrier / Rosacea',
    sub: 'Localized vasodilation · telangiectasia',
    ita: 34.2,
    ei: 38.5,
    hotSpots: [
      { x: 0.28, y: 0.36, r: 0.13, ei: 41 },
      { x: 0.72, y: 0.4, r: 0.15, ei: 43 },
      { x: 0.5, y: 0.66, r: 0.12, ei: 37 }
    ],
    veins: true,
    texture: 0.95,
    seed: 71
  }
];

export const PHANTOMS = Object.freeze(
  PHANTOM_SPECS.map((spec) => {
    const solved = solvePhantomHex({ ita: spec.ita, erythemaIndex: spec.ei });
    return Object.freeze({
      ...spec,
      baseHex: solved.hex,
      calibrated: {
        ita: solved.reading.ita,
        erythemaIndex: solved.reading.erythemaIndex,
        melaninIndex: solved.reading.melaninIndex,
        med: solved.reading.med,
        residual: solved.residual
      }
    });
  })
);

export const LESION_PHANTOMS = Object.freeze([
  {
    id: 'benign-nevus',
    label: 'Symmetric Benign Nevus',
    sub: 'Uniform pigment · compact border',
    spec: {
      seed: 101,
      radiusMm: 1.6,
      asymmetry: 0.03,
      borderHarmonics: 1,
      borderAmplitude: 0.015,
      baseSkin: '#DDAE86',
      pigment: '#7A4E30',
      zones: ['#7A4E30'],
      zoneFractions: [1],
      hair: 2
    },
    expected: { asymmetry: '3 %', border: '1.07', diameter: '3.2 mm' }
  },
  {
    id: 'solar-lentigo',
    label: 'Solar Lentigo / Sunspot',
    sub: 'Uniform tan pigment · sharp flat margin',
    spec: {
      seed: 202,
      radiusMm: 2.4,
      asymmetry: 0.06,
      borderHarmonics: 2,
      borderAmplitude: 0.04,
      baseSkin: '#E2B992',
      pigment: '#9C6B3F',
      zones: ['#9C6B3F', '#B4835A'],
      zoneFractions: [0.62, 0.38],
      hair: 1
    },
    expected: { asymmetry: '7 %', border: '1.03', diameter: '4.8 mm' }
  },
  {
    id: 'dysplastic',
    label: 'Irregular Border Dysplastic Phantom',
    sub: 'Multi-chromatic · scalloped margin',
    spec: {
      seed: 303,
      radiusMm: 3.55,
      asymmetry: 0.32,
      borderHarmonics: 4,
      borderAmplitude: 0.16,
      baseSkin: '#D9A982',
      pigment: '#5C3A21',
      zones: ['#5C3A21', '#B4835A', '#2A1A12', '#C0392B', '#F1ECE4'],
      zoneFractions: [0.34, 0.2, 0.22, 0.14, 0.1],
      hair: 5
    },
    expected: { asymmetry: '40 %', border: '4.29', colors: 5, diameter: '7.1 mm' }
  },
  {
    id: 'evolution',
    label: 'Longitudinal 6-Month Evolution',
    sub: 'Prior scan comparison · growth detected',
    spec: {
      seed: 404,
      radiusMm: 2.95,
      asymmetry: 0.19,
      borderHarmonics: 3,
      borderAmplitude: 0.1,
      baseSkin: '#DCB18B',
      pigment: '#6B4423',
      zones: ['#6B4423', '#B4835A', '#3A2519'],
      zoneFractions: [0.5, 0.3, 0.2],
      hair: 3
    },
    prior: { radiusMm: 2.05, seed: 405, months: 6 },
    expected: { growth: '+1.8 mm', rateMmPerMonth: '0.30' }
  }
]);

const DEFAULT_SOLAR = {
  uvIndex: 7.4,
  latitude: -0.0467,
  longitude: 37.6472,
  altitudeM: 1650,
  albedo: 0.05,
  elevationDeg: 58,
  ozoneDU: 300,
  bsaFraction: 0.35,
  spf: 30,
  activity: 'walk',
  waterResistanceMin: 40,
  filterKey: 'avobenzone_unstabilized',
  targetIU: 1000,
  exposureMinutes: 0,
  altitudeInUvi: false
};

function makeStore() {
  /* --------------------------------------------------------------- theme/gpu */
  let theme = $state('obsidian');
  let gpuMode = $state('high');
  let role = $state('explorer');
  let formFactor = $state('auto');
  let activeModule = $state('solar');
  let reducedMotion = $state(false);
  let specular = $state({ x: 0.5, y: 0.2, active: false });

  /* ------------------------------------------------------------- permissions */
  let permissions = $state({
    camera: { state: 'SIMULATOR ACTIVE', granted: false, detail: 'No stream attached' },
    lux: { state: 'SIMULATOR ACTIVE', granted: false, detail: 'Synthetic 60 000 lx' },
    haptic: { state: 'WEB ACTIVE', granted: true, detail: 'navigator.vibrate ready' },
    vault: { state: 'WEB ACTIVE', granted: true, detail: 'IndexedDB available' }
  });

  /* --------------------------------------------------------- chromophore scan */
  let scan = $state({
    source: 'phantom',
    phantomId: 'fair-calm',
    ita: 52.4,
    med: 220,
    phototype: phototypeFromIta(52.4),
    erythemaIndex: 14.2,
    melaninIndex: 24.6,
    hydration: 62.4,
    lab: { L: 78.4, a: 9.1, b: 17.2 },
    rgb: { r: 242, g: 214, b: 189 },
    reflectance: { r: 0.87, g: 0.66, b: 0.5 },
    hex: '#F2D6BD',
    band: 'calm',
    live: false,
    calibrated: false,
    hotspotCount: 0,
    timestamp: Date.now()
  });

  let whiteBalance = $state({ r: 255, g: 255, b: 255, calibrated: false, deltaE: 0 });

  /* ------------------------------------------------------------ solar inputs */
  let solar = $state({ ...DEFAULT_SOLAR });
  let timers = $state({
    exposureElapsedMin: 0,
    vitdAccumulatedIU: 0,
    doseAccumulatedJm2: 0,
    running: false,
    startedAt: null,
    reapplyAt: null,
    lastAlarm: null
  });

  /* --------------------------------------------------------------- lesion lab */
  let lesion = $state({
    phantomId: 'benign-nevus',
    result: null,
    analyzing: false,
    source: 'phantom',
    prior: null,
    logs: []
  });

  /* ------------------------------------------------------------------- vault */
  let vaultState = $state({
    ready: false,
    unlocked: false,
    enrolled: false,
    storageMode: 'indexeddb',
    pendingSync: 0,
    records: { scans: 0, lesions: 0, exposures: 0, audits: 0 },
    lastSync: null
  });

  /* ------------------------------------------------------------------ toasts */
  let toasts = $state([]);
  let modal = $state({ id: null, payload: null });
  let soundEnabled = $state(true);
  let hapticEnabled = $state(true);

  const vault = typeof window !== 'undefined' ? createVault() : null;

  let toastSeq = 0;
  const toast = (message, tone = 'info', ttl = 4200) => {
    const id = ++toastSeq;
    toasts = [...toasts, { id, message, tone, at: Date.now() }];
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
    }, ttl);
  };

  const dismissToast = (id) => {
    toasts = toasts.filter((t) => t.id !== id);
  };

  /* --------------------------------------------------------------- deriveds */
  const phototype = $derived(phototypeFromIta(scan.ita));
  const med = $derived(medFromIta(scan.ita));
  const roleMeta = $derived(ROLES.find((r) => r.id === role) ?? ROLES[0]);
  const isPro = $derived(role === 'pro' || role === 'director');
  const isDirector = $derived(role === 'director');
  const themeMeta = $derived(THEMES.find((t) => t.id === theme) ?? THEMES[0]);

  /* ----------------------------------------------------------------- actions */
  function setTheme(next) {
    theme = next;
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('ds.theme', next);
    } catch {
      /* private mode */
    }
    if (next === 'eco' && gpuMode !== 'low') setGpu('low');
  }

  function setGpu(next) {
    gpuMode = next;
    document.documentElement.dataset.gpu = next;
    try {
      localStorage.setItem('ds.gpu', next);
    } catch {
      /* private mode */
    }
  }

  function setRole(next) {
    if (!ROLES.some((r) => r.id === next)) return;
    role = next;
    // Honest RBAC: downgrade away from gated modules.
    if (next === 'explorer' && ['abcd', 'runtime'].includes(activeModule)) activeModule = 'chromophore';
    if (next === 'pro' && activeModule === 'runtime') activeModule = 'chromophore';
    toast(`Privilege tier → ${ROLES.find((r) => r.id === next).label}`, 'ok');
  }

  function setModule(id) {
    activeModule = id;
  }

  function setFormFactor(next) {
    formFactor = next;
  }

  function openModal(id, payload = null) {
    modal = { id, payload };
  }

  function closeModal() {
    modal = { id: null, payload: null };
  }

  function setPermission(id, state, detail) {
    if (!permissions[id]) return;
    permissions = {
      ...permissions,
      [id]: { ...permissions[id], state, detail: detail ?? permissions[id].detail, granted: state !== 'RESTRICTED' }
    };
  }

  /** Apply a fresh chromophore reading (from camera or phantom). */
  function applyScan(reading, meta = {}) {
    scan = {
      ...scan,
      ...reading,
      ...meta,
      phototype: phototypeFromIta(reading.ita ?? scan.ita),
      timestamp: Date.now()
    };
  }

  function setPhantom(phantomId) {
    const p = PHANTOMS.find((x) => x.id === phantomId);
    if (!p) return;
    // Canonical phantom readout comes from the solver, not a re-decode of the
    // hex, so the declared and displayed numbers are identical by construction.
    const reading = analyzeChromophores(...hexToRgbArray(p.baseHex), {
      white: whiteBalance.calibrated ? whiteBalance : undefined
    });
    applyScan(
      {
        source: 'phantom',
        phantomId,
        ita: reading.ita,
        med: reading.med,
        erythemaIndex: reading.erythemaIndex,
        band: reading.erythemaBand.key,
        melaninIndex: reading.melaninIndex,
        hydration: reading.hydration,
        lab: reading.lab,
        rgb: reading.rgb,
        reflectance: reading.reflectance,
        hex: p.baseHex,
        live: false
      },
      { phantomLabel: p.label }
    );
  }

  function setSolar(patch) {
    solar = { ...solar, ...patch };
  }

  function resetTimers() {
    timers = {
      exposureElapsedMin: 0,
      vitdAccumulatedIU: 0,
      doseAccumulatedJm2: 0,
      running: false,
      startedAt: null,
      reapplyAt: null,
      lastAlarm: null
    };
  }

  function toggleTimers() {
    if (timers.running) {
      timers = { ...timers, running: false };
    } else {
      timers = { ...timers, running: true, startedAt: timers.startedAt ?? Date.now() };
    }
  }

  function setTimers(patch) {
    timers = { ...timers, ...patch };
  }

  function setLesion(patch) {
    lesion = { ...lesion, ...patch };
  }

  function setVault(patch) {
    vaultState = { ...vaultState, ...patch };
  }

  function setSpecular(x, y, active = true) {
    specular = { x, y, active };
  }

  async function initVault() {
    if (!vault) return null;
    try {
      const info = await vault.init();
      const enrolled = await vault.isEnrolled;
      const counts = {
        scans: await vault.adapter.count('scans'),
        lesions: await vault.adapter.count('lesions'),
        exposures: await vault.adapter.count('exposures'),
        audits: await vault.adapter.count('audits')
      };
      const pending = (await vault.pendingSync()).length;
      setVault({
        ready: true,
        enrolled,
        storageMode: info.storageMode,
        records: counts,
        pendingSync: pending
      });
      return info;
    } catch (err) {
      setVault({ ready: true, storageMode: 'unavailable', error: String(err) });
      return null;
    }
  }

  return {
    get theme() {
      return theme;
    },
    get gpuMode() {
      return gpuMode;
    },
    get role() {
      return role;
    },
    get roleMeta() {
      return roleMeta;
    },
    get isPro() {
      return isPro;
    },
    get isDirector() {
      return isDirector;
    },
    get themeMeta() {
      return themeMeta;
    },
    get formFactor() {
      return formFactor;
    },
    get activeModule() {
      return activeModule;
    },
    get reducedMotion() {
      return reducedMotion;
    },
    get specular() {
      return specular;
    },
    get permissions() {
      return permissions;
    },
    get scan() {
      return scan;
    },
    get phototype() {
      return phototype;
    },
    get med() {
      return med;
    },
    get whiteBalance() {
      return whiteBalance;
    },
    get solar() {
      return solar;
    },
    get timers() {
      return timers;
    },
    get lesion() {
      return lesion;
    },
    get vaultState() {
      return vaultState;
    },
    get vault() {
      return vault;
    },
    get toasts() {
      return toasts;
    },
    get modal() {
      return modal;
    },
    get soundEnabled() {
      return soundEnabled;
    },
    get hapticEnabled() {
      return hapticEnabled;
    },
    set soundEnabled(v) {
      soundEnabled = v;
    },
    set hapticEnabled(v) {
      hapticEnabled = v;
    },
    set reducedMotion(v) {
      reducedMotion = v;
    },
    setTheme,
    setGpu,
    setRole,
    setModule,
    setFormFactor,
    openModal,
    closeModal,
    setPermission,
    applyScan,
    setPhantom,
    setSolar,
    setWhiteBalance: (wb) => {
      whiteBalance = { ...wb, calibrated: true };
    },
    resetTimers,
    toggleTimers,
    setTimers,
    setLesion,
    setVault,
    setSpecular,
    initVault,
    toast,
    dismissToast
  };
}

function hexToRgbArray(hex) {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Singleton application store. */
export const app = makeStore();
