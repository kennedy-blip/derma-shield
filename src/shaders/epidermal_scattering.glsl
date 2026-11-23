#version 300 es
// =============================================================================
// DERMA-SHIELD · shared WebGL2 full-screen vertex stage.
// Draws a single oversized triangle (no index buffer, no attribute churn) and
// forwards normalised device coordinates so the fragment stage can reconstruct
// a resolution-independent, aspect-corrected UV space via gl_FragCoord.
// =============================================================================
precision highp float;

in vec2 aPos;          // triangle verts: (-1,-1) (3,-1) (-1,3)
out vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
//----DS-FRAGMENT-STAGE----
#version 300 es
// =============================================================================
// DERMA-SHIELD · epidermal_scattering.glsl
// GPU subsurface dermal photon-scattering field, WebGL2.
//
// Renders a 2.5-D volumetric model of human skin being irradiated by a solar
// spectrum. The fragment stage explicitly separates:
//
//   UVB  290–315 nm — absorbed in the stratum corneum / viable epidermis.
//                     Its energy density drives erythema (sunburn) and the
//                     production of previtamin D3 in the basal layer.
//   UVA  320–400 nm — penetrates the dermis to ~1–2 mm, where it hits the
//                     haemoglobin/haemostasis network and generates ROS that
//                     break down collagen. Rendered as a reddish-violet forward
//                     scattering plume with a deeper extinction length.
//
// Three superposed photon layers are marched: epidermal (thin, high extinction),
// papillary-dermis (medium) and reticular-dermis (deep). Melanic absorption is
// applied as an eumelanin extinction coefficient keyed to the ITA° input, so
// phototype V/VI visibly absorbs UVB within the first 80 µm.
//
// Uniforms are driven from Svelte: uUvDose (0–1), uErythema (EI/50),
// uMelanin (0–1), uSpf (film integrity 0–1), uState (0 safe · 1 warn · 2 danger).
// =============================================================================

precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;
uniform float uUvDose;      // 0..1 accumulated erythemal dose fraction of the MED
uniform float uErythema;    // 0..1.4 (EI / 35)
uniform float uMelanin;     // 0..1 from ITA deg
uniform float uSpf;         // 0..1 sunscreen film integrity
uniform float uState;       // 0 safe · 1 warn · 2 danger
uniform vec2  uPointer;     // specular light origin, normalized
uniform float uIntensity;   // global opacity master

// ---------------------------------------------------------------- palette
const vec3 BIO_TEAL   = vec3(0.078, 0.722, 0.651);   // #14B8A6
const vec3 CELL_CYAN  = vec3(0.024, 0.714, 0.831);   // #06B6D4
const vec3 EMERALD    = vec3(0.063, 0.725, 0.506);   // #10B981
const vec3 SOLAR_GOLD = vec3(0.961, 0.620, 0.043);   // #F59E0B
const vec3 AMBER      = vec3(0.918, 0.702, 0.031);   // #EAB308
const vec3 ULTRA_VIO  = vec3(0.545, 0.361, 0.965);   // #8B5CF6
const vec3 ERY_CRIM   = vec3(0.937, 0.267, 0.267);   // #EF4444
const vec3 ROSE       = vec3(0.957, 0.247, 0.369);   // #F43F5E
const vec3 IR_MAGENTA = vec3(0.925, 0.282, 0.600);   // #EC4899

// ------------------------------------------------------------ hash / noise
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += amp * valueNoise(p);
    p = rot * p * 2.03;
    amp *= 0.5;
  }
  return v;
}

// Layered dermal fibre field: oriented collagen bundles + capillary channels.
float dermalFibres(vec2 p, float t) {
  float f1 = fbm(p * 1.4 + vec2(t * 0.03, -t * 0.02));
  float warp = fbm(p * 2.6 - vec2(t * 0.04, t * 0.015));
  float bands = sin((p.x * 3.1 + p.y * 1.7 + warp * 5.0) * 3.14159) * 0.5 + 0.5;
  return mix(f1, bands, 0.42);
}

// Beer–Lambert transmission with wavelength-specific extinction per layer.
vec3 epidermalDepth(vec3 col, float depth, float melanin, float lambda) {
  // extinction (1/mm) rises steeply into the UVB and with eumelanin content
  float kEpi   = lambda < 315.0 ? 42.0 : 12.5;      // UVB vs UVA in epidermis
  float kDerm  = lambda < 315.0 ? 260.0 : 2.9;      // UVB barely reaches dermis
  float kMel   = lambda < 315.0 ? 9.0 : 3.4;        // melanin absorption bias
  float atten  = exp(-depth * (kEpi + melanin * kMel * 10.0) * 0.012)
               * exp(-max(0.0, depth - 0.12) * kDerm * 0.012);
  return col * atten;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
  float aspect = uResolution.x / uResolution.y;
  float t = uTime;

  vec3 color = vec3(0.0);
  float alpha = 0.0;

  // ------------------------------------------------------------- three photon
  // layers, each with a depth profile and its own spectral hue.
  for (int layer = 0; layer < 3; layer++) {
    float li = float(layer);
    // Each layer is a thin slab inside the "skin volume" sliding at its own rate
    float depth = 0.06 + li * 0.19;                       // normalized µm depth
    float scale = 1.0 + li * 0.85;
    vec2 p = uv * scale;
    p.y -= t * (0.012 + li * 0.006);

    float field = dermalFibres(p + li * 4.7, t);
    // capillary/follicle micro-anatomy
    float cap = fbm(p * 5.2 + vec2(0.0, t * 0.02));
    float capillarity = smoothstep(0.62, 0.94, cap) * (0.35 + 0.65 * uErythema);

    // Bi-lobed photon lobes with a slow orbital motion.
    vec2 c1 = vec2(0.34 * aspect * sin(t * 0.11 + li), 0.22 * cos(t * 0.13 + li * 2.1));
    vec2 c2 = vec2(-0.3 * aspect * cos(t * 0.09 + li * 1.4), -0.26 * sin(t * 0.1 + li));
    float d1 = length(uv - c1);
    float d2 = length(uv - c2);
    float lobe = exp(-d1 * d1 * (2.6 - li * 0.4)) + 0.72 * exp(-d2 * d2 * (3.4 - li * 0.5));

    // Forward Mie scattering cone from the pointer light.
    vec2 ldir = normalize(uv - (uPointer - 0.5) * vec2(aspect, 1.0) * 2.0 + 1e-4);
    float cone = pow(max(0.0, dot(ldir, normalize(vec2(0.35, -0.94)))), 6.0);

    float density = field * 0.55 + lobe * 0.8 + cone * 0.24;
    density *= 1.0 - depth * 0.55;

    // Spectrum assignment: UVB layer → gold/amber; UVA → red/magenta at depth.
    vec3 uvB = mix(SOLAR_GOLD, AMBER, field);
    vec3 uvA = mix(ERY_CRIM, IR_MAGENTA, field);
    vec3 layerCol = mix(uvB, uvA, li / 2.0);

    // Melanin extinction per layer
    float melaninAtten = exp(-depth * uMelanin * (li < 0.5 ? 26.0 : 6.0));
    layerCol *= melaninAtten;

    // Sunscreen film: extra scattering right at the surface (li == 0).
    if (li < 0.5) {
      float film = smoothstep(0.0, 0.4, uSpf);
      layerCol = mix(layerCol, mix(vec3(1.0), CELL_CYAN, 0.3), film * 0.38);
      density *= mix(1.0, 0.55, film);
    }

    color += layerCol * density * (0.32 + 0.24 * li);
    alpha += density * (0.16 - li * 0.03);
  }

  // -------------------------------------------------------- base chromophore
  // Bio-teal → cyan → emerald calm field (safe state)
  float calmField = fbm(uv * 1.8 + vec2(t * 0.02, -t * 0.014));
  vec3 baseCalm = mix(BIO_TEAL, CELL_CYAN, calmField);
  baseCalm = mix(baseCalm, EMERALD, smoothstep(0.55, 1.0, fbm(uv * 3.2 - t * 0.03)) * 0.7);

  // Warn state (UVI 6–8 / SPF degrading): gold → amber → ultraviolet
  vec3 baseWarn = mix(SOLAR_GOLD, AMBER, calmField);
  baseWarn = mix(baseWarn, ULTRA_VIO, smoothstep(0.45, 0.95, calmField) * 0.55);

  // Danger state (UVI 9+ / EI spike): crimson → rose → infrared magenta
  vec3 baseDanger = mix(ERY_CRIM, ROSE, calmField);
  baseDanger = mix(baseDanger, IR_MAGENTA, smoothstep(0.5, 1.0, calmField) * 0.7);

  vec3 base = uState < 0.5 ? baseCalm : (uState < 1.5 ? baseWarn : baseDanger);
  // Blend ratios so partial warn/danger can crossfade smoothly.
  base = mix(baseCalm, baseWarn, clamp(uState, 0.0, 1.0));
  base = mix(base, baseDanger, clamp(uState - 1.0, 0.0, 1.0));

  float baseMask = smoothstep(0.18, 0.95, fbm(uv * 0.9 + t * 0.008));
  color += base * baseMask * 0.22;
  alpha += baseMask * 0.05;

  // --------------------------------------------------- erythema bloom overlay
  vec2 hot = uv + vec2(sin(t * 0.22), cos(t * 0.19)) * 0.1;
  float bloom = exp(-dot(hot, hot) * 3.2) * smoothstep(0.28, 1.35, uErythema);
  color += mix(ROSE, IR_MAGENTA, bloom) * bloom * 0.42;

  // -------------------------------------------------------- dose corona rings
  float r = length(uv * vec2(0.82, 1.0));
  float rings = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float radius = 0.42 + 0.16 * fi + sin(t * 0.35 + fi * 1.7) * 0.02;
    rings += smoothstep(0.012, 0.0, abs(r - radius)) * (0.5 - fi * 0.12);
  }
  vec3 ringCol = uState < 0.5 ? CELL_CYAN : (uState < 1.5 ? SOLAR_GOLD : ROSE);
  color += ringCol * rings * (0.35 + 0.45 * uUvDose);

  // --------------------------------------------------------- illumination falloff
  float vign = smoothstep(1.35, 0.15, length(uv * vec2(0.72, 1.0)));
  color *= vign;
  alpha *= vign;

  // Pointer-following specular dermal highlight (dermatoscope ring light)
  vec2 luv = (uPointer - 0.5) * vec2(aspect, 1.0) * 2.0;
  float spec = exp(-pow(length(uv - luv) * 2.4, 2.0)) * 0.18;
  color += spec * vec3(0.72, 0.92, 1.0);

  // Subtle scanline modulation for instrument realism
  float scan = 0.965 + 0.035 * sin(gl_FragCoord.y * 3.14159 * 0.5);
  color *= scan;

  // Filmic tone-map + gentle gamma to keep the glass readable underneath.
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(0.92));

  alpha = clamp(alpha * uIntensity, 0.0, 0.62);
  fragColor = vec4(color, alpha);
}
