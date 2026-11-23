# DERMA-SHIELD

**A dermatological optics, UV dosimetry and sunscreen photostability station.**
Web app (Vercel) plus a self-hosted Android `.APK` replica built from the same bundle.
Zero TypeScript — Svelte 5 + JavaScript + Python 3.12 + Kotlin + GLSL.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  01  Optical Chromophore Lab     ITA° → Fitzpatrick, MED, Dawson EI, MI  │
│  02  Solar UV / D3 / SPF         UVI → burn & previtamin-D3 timers       │
│  03  ABCDE Morphometry           Polsby-Popper, entropy, Feret diameter  │
│  04  Photostability Auditor      89 ingredients · 14 photochemistry rules│
│  05  Polyglot Vault              code inspector · PIN vault · sync queue │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## The five modules

| # | Module | What it computes |
|---|--------|------------------|
| 01 | **Optical Chromophore Lab** | Camera/phantom reflectance → CIE L\*a\*b\* → **ITA°** → Fitzpatrick I–VI, **MED (J/m²)**, **Dawson Erythema Index**, **Melanin Index**. Five calibrated skin phantoms, sub-clinical erythema heatmap, white-balance grey-card calibration. |
| 02 | **Solar UV · Vitamin D3 · SPF** | UVI slider + shadow-ratio clinometer → **minutes to 1.0 MED**, **IU/min previtamin-D3 (Holick)** and time to a 1000 IU target, bi-exponential sunscreen film decay with a reapplication alarm. Albedo (sand/snow/water/grass) and altitude multipliers. |
| 03 | **ABCDE Morphometry** | Real segmentation of the lesion ROI → image moments → **biaxial asymmetry**, **Polsby-Popper** compactness, **6-zone chromatic entropy**, calibrated **Feret diameter** and evolution tracking. Four dermatoscopic phantoms. |
| 04 | **Photostability Auditor** | Fully offline INCI parser over an **89-row** ingredient DB with a **14-rule** photochemistry pack (avobenzone photolysis, oxybenzone penetration, retinoid degradation, acid irritation, reef-ban flags, comedogenicity). |
| 05 | **Polyglot Vault** | Live code inspector (measured language ledger, kernel parity map), **PIN-locked** IndexedDB lesion ledger encrypted with PBKDF2-SHA-256 → AES-GCM, and an append-only offline sync queue. |

---

## Architecture

```
src/routes/+page.svelte          single SPA route; swaps modules by app.activeModule
src/lib/components/
  shell/      Header · Dock · Hero · ScatterField · SpecularOverlay
              ModalHost · ToastHost · PrivilegeDrawer · ApkCenter
              ReportModal · VaultModal
  modules/    ChromophoreLab · SolarEngine · AbcdCaliper
              SunscreenAuditor · RuntimeVault
  ui/         Panel · Stat · Gauge · Slider · Segmented · Sparkline
              Ledger · Dial · Icon
src/lib/engines/                 JavaScript numeric kernels (offline mirror)
src/lib/db/                      runes store + IndexedDB vault
python_photobiology/             Python reference kernel (14 self-test suites)
api/derma_photobiology.py        Vercel Python function
android/                         Kotlin sensor + camera plugins, Gradle project
src/shaders/*.glsl               WebGL2 epidermal scattering + solar corona
scripts/                         TypeScript audit, JS↔Python parity harness
```

### Why two engines

The web deployment can call Python; the offline APK cannot. Both implement the
identical numerics, and `scripts/parity-check.mjs` replays **128 000 solar
geometries + 80 SPF film states** through both and asserts divergence `Δ = 0`.
Drift becomes a CI failure instead of a wrong beach reading.

### Photobiology calibration

The spectral chain is anchored to published UV Index values:

| Solar elevation | UV Index |
|-----------------|----------|
| 90° | 12.73 |
| 60° | 9.81 |
| 30° | 2.53 |
| 15° | 0.18 |

Ozone (`250 DU > 400 DU`), altitude (`+4 %/300 m`) and albedo (`snow > sand >
grass`) all move the result in the physically correct direction.

---

## Commands

```bash
npm install
npm run dev                 # vite on 0.0.0.0:5173
npm run build               # → dist/ (adapter-static, SPA fallback)

npm run check               # 0-TypeScript audit + measured language ledger
npm run ledger:emit         # regenerate src/lib/data/language-ledger.js
npm run photobiology:selftest   # 14/14 Python suites
npm run audit:parity        # JS mirror ↔ Python reference (Δ = 0)
npm run audit:all           # everything above + a production build

npm run cap:sync            # build web bundle, then `cap sync android`
npm run android:apk         # requires JDK 21 + Android SDK 35
```

### Python API (Vercel)

`api/derma_photobiology.py` is a stdlib-only WSGI/callable hybrid:

```
GET  /api/derma_photobiology?action=health
GET  ?action=advisory&uv_index=7.4&ita=52.4&spf=30&altitude_m=1650
GET  ?action=spectrum&elevation_deg=55&ozone_du=300      # 1 nm resolution
GET  ?action=shadow&height_m=1.75&shadow_m=1.1
GET  ?action=lux&lux=68000
GET  ?action=ephemeris&latitude=-0.05&day_of_year=172&solar_hour=12
GET  ?action=med&ita=52.4&uv_index=8
GET  ?action=spf_curve&spf=30&activity=swim
POST {action:"audit_filters", filters:[...], stabilisers:[...]}
```

---

## Android APK

`capacitor.config.json` → appId `com.dermashield.bio`, webDir `dist`.

Native plugins in `android/app/src/main/java/com/dermashield/bio/`:

* **`UvLuxBarometerPlugin.kt`** — `TYPE_LIGHT` lux, `TYPE_PRESSURE` → ISA
  altitude, `TYPE_ROTATION_VECTOR` → shadow clinometer. 900 ms coalesced bridge.
* **`DermatoscopyCameraPlugin.kt`** — camera2 with constant torch, 160×120
  analysis down-sample, 20×15 luminance grid, grey-card white reference.
* **`MainActivity.kt`** — registers both plugins, volume-key timer reset.

`.github/workflows/build-and-bundle-apk.yml` builds `dist/` → `cap sync` →
`gradlew assembleRelease` (JDK 21 + Android SDK 35, signed with the checked-in
CI key so successive builds upgrade in place), then commits the artifact to
`static/releases/dermashield-release.apk` — the only directory the static
adapter publishes. The workflow stamps `release-manifest.json` with the byte
size and SHA-256 of the exact binary it produced, and the in-app **Android
Release Centre** renders those values, a real QR code, and the checksum before
linking the file.

---

## UI

* Four themes: **Dermal Obsidian** (default), **Daylight Frost** (beach/alpine),
  **Wood's Lamp 365 nm**, **Eco-Glass** (low-GPU, no backdrop filters).
* Glassmorphism with prism borders and SVG noise; WebGL2 GLSL background
  (`epidermal_scattering.glsl`) driven by live UVI/erythema/melanin uniforms,
  plus a `uv_solar_corona.glsl` field in the solar module.
* `svelte/motion` springs on the dock metaball, gauges and segmented controls;
  depth-push modals; desktop/mobile viewport switcher.
* RBAC: **Explorer** (Standard) · **Pro** · **Director** (Admin) with a sensor
  permission matrix (native Kotlin / WebView / simulator / restricted).

---

## Safety

Not a medical device. Outputs derive from published photobiology models
(McKinlay–Diffey 1987, Holick 2007, Kasten–Young 1989, Dawson 1980) evaluated
against synthetic phantoms or camera reflectance. No diagnostic claims are
made — a changing lesion belongs with a dermatologist.

## License

MIT
