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
// DERMA-SHIELD · uv_solar_corona.glsl
// Solar UV corona field for the Solar UV / Vitamin D3 module header.
//
// Draws the Sun as a limb-darkened disk surrounded by a magnetically-warped
// coronal halo whose colour temperature encodes the live UV Index:
//   UVI 0–2   → emerald/teal calm corona
//   UVI 3–5   → cyan → gold
//   UVI 6–8   → amber → ultraviolet
//   UVI 9+    → crimson → infrared magenta flare
// Coronal streamers follow an fBm-warped radial noise field; prominence loops
// are drawn as two analytic arcs riding the magnetic field lines.
//
// The same program powers the off-grid shadow clinometer's sun-position arc when
// uMode = 1, where uSolarElevation rotates the emanation plane.
// =============================================================================

precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;
uniform float uUvIndex;         // 0..15
uniform float uSolarElevation;  // degrees 0..90
uniform float uMode;            // 0 = corona backdrop · 1 = clinometer arc
uniform vec2  uPointer;
uniform float uIntensity;
uniform float uCorona;          // 0..1 ozone/aerosol haze density

const vec3 TEAL    = vec3(0.078, 0.722, 0.651);
const vec3 CYAN    = vec3(0.024, 0.714, 0.831);
const vec3 GOLD    = vec3(0.961, 0.620, 0.043);
const vec3 AMBER   = vec3(0.918, 0.702, 0.031);
const vec3 VIOLET  = vec3(0.545, 0.361, 0.965);
const vec3 CRIMSON = vec3(0.937, 0.267, 0.267);
const vec3 MAGENTA = vec3(0.925, 0.282, 0.600);

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    v += a * noise(p);
    p *= 2.07;
    p = mat2(0.83, 0.55, -0.55, 0.83) * p;
    a *= 0.52;
  }
  return v;
}

vec3 uvTemperature(float uvi) {
  vec3 c = mix(TEAL, CYAN, smoothstep(0.0, 3.0, uvi));
  c = mix(c, GOLD, smoothstep(2.5, 5.5, uvi));
  c = mix(c, AMBER, smoothstep(5.0, 7.0, uvi));
  c = mix(c, VIOLET, smoothstep(6.5, 8.5, uvi) * 0.62);
  c = mix(c, CRIMSON, smoothstep(8.0, 10.5, uvi));
  c = mix(c, MAGENTA, smoothstep(10.0, 14.0, uvi));
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
  float t = uTime;
  float aspect = uResolution.x / uResolution.y;

  // Sun centre; in clinometer mode it tracks the measured solar elevation.
  float elev = radians(clamp(uSolarElevation, 0.0, 90.0));
  vec2 sun = uMode < 0.5
    ? vec2(0.30 * aspect, 0.05)
    : vec2(-0.32 * aspect, -0.34 + sin(elev) * 0.72);

  vec2 d = uv - sun;
  float r = length(d);
  float ang = atan(d.y, d.x);

  vec3 coronaCol = uvTemperature(uUvIndex);
  float heat = clamp(uUvIndex / 12.0, 0.0, 1.0);

  // ------------------------------------------------------------ coronal streamers
  // Warp polar coordinates with fBm so streamers look magnetic, not radial.
  float warp = fbm(vec2(ang * 2.4 + t * 0.05, r * 3.0 - t * 0.08));
  float streamers = fbm(vec2(ang * 7.0 + warp * 3.2, r * 2.1 - t * 0.12));
  streamers = pow(smoothstep(0.35, 0.95, streamers), 2.0);

  float halo = exp(-r * (2.6 - heat * 0.9));
  float outer = exp(-r * 0.85) * (0.35 + 0.65 * streamers);

  // Prominence loops: two arcs riding field lines above the limb.
  float loopA = 0.0;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float arcR = 0.1 + fi * 0.055;
    float arcThickness = 0.006 + fi * 0.004;
    float arc = smoothstep(arcThickness, 0.0, abs(r - arcR - streamers * 0.02));
    float arcMask = smoothstep(0.15, 0.65, sin(ang * (2.0 + fi) + t * 0.18 + fi * 1.9));
    loopA += arc * arcMask;
  }

  // Limb-darkened photosphere (only a sliver is visible behind the glass panel)
  float disk = smoothstep(0.075, 0.062, r);
  float limb = smoothstep(0.0, 0.075, r);
  vec3 photosphere = mix(vec3(1.0, 0.97, 0.86), coronaCol, pow(limb, 1.6) * 0.85);
  photosphere *= 0.85 + 0.15 * (1.0 - limb);

  // ------------------------------------------------------------- haze & falloff
  float haze = fbm(uv * 2.2 + vec2(t * 0.015, -t * 0.02)) * uCorona;

  vec3 color = vec3(0.0);
  color += photosphere * disk * 1.15;
  color += coronaCol * halo * (0.55 + 0.6 * heat);
  color += mix(coronaCol, VIOLET, 0.35) * outer * 0.42;
  color += mix(coronaCol, vec3(1.0), 0.35) * loopA * (1.4 + heat);

  // Wide ambient wash so glass panels above it read as refractive.
  color += coronaCol * 0.055 * smoothstep(1.6, 0.0, r);
  color += coronaCol * haze * 0.1;

  // Pointer specular glint
  vec2 luv = (uPointer - 0.5) * vec2(aspect, 1.0) * 2.0;
  color += vec3(0.8, 0.95, 1.0) * exp(-pow(length(uv - luv) * 3.0, 2.0)) * 0.06;

  // Clinometer mode: draw the shadow-length baseline and elevation arc ticks.
  if (uMode > 0.5) {
    float baseY = -0.34;
    float lineW = 0.0022;
    float baseline = smoothstep(lineW, 0.0, abs(uv.y - baseY)) *
                     smoothstep(0.55, 0.4, abs(uv.x));
    color += vec3(0.55, 0.85, 0.92) * baseline * 0.5;

    // arc ticks every 15 degrees of elevation
    float tickAng = ang;
    float tickR = length(uv - vec2(-0.32 * aspect, baseY));
    float tick = 0.0;
    for (int i = 0; i <= 6; i++) {
      float target = radians(15.0 * float(i));
      float delta = abs(tickAng - target);
      tick += smoothstep(0.006, 0.0, delta) * smoothstep(0.30, 0.26, tickR) * step(0.24, tickR);
    }
    color += vec3(0.7, 0.9, 1.0) * tick * 0.5;

    // shadow ray from the gnomon base to the tip
    vec3 shadowCol = mix(vec3(0.15, 0.2, 0.3), GOLD, 0.25);
    float shadow = smoothstep(0.02, 0.0, abs(uv.y - baseY + 0.008)) *
                   smoothstep(-0.3 * aspect, 0.4 * aspect, uv.x) *
                   smoothstep(0.5, 0.3, abs(uv.x));
    color = mix(color, shadowCol, shadow * 0.35);
  }

  // Radial vignette to keep the panel header legible.
  color *= smoothstep(1.5, 0.25, length(uv * vec2(0.68, 1.0)));

  // Filmic tone-map.
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(0.94));

  float alpha = clamp((disk * 1.0 + halo * 0.72 + outer * 0.5 + loopA * 0.8) * uIntensity, 0.0, 1.0);
  fragColor = vec4(color, alpha);
}
