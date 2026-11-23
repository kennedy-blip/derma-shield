/**
 * DERMA-SHIELD · webgl-renderer.js
 * -----------------------------------------------------------------------------
 * WebGL2 runtime for the two GLSL programs. Handles context loss, DPR-aware
 * sizing, adaptive resolution under thermal pressure, and a delta-locked rAF
 * loop that never exceeds the display refresh.
 *
 * The renderer is deliberately framework-free: `createShaderField()` returns
 * `{ attach, resize, start, stop, setUniform, stats }` and Svelte components
 * simply own the lifecycle.
 * ------------------------------------------------------------------------- */

import epidermalSource from '../../shaders/epidermal_scattering.glsl?raw';
import coronaSource from '../../shaders/uv_solar_corona.glsl?raw';

const STAGE_MARKER = '//----DS-FRAGMENT-STAGE----';

/** Split the combined .glsl file into its vertex + fragment stages. */
export function splitStages(source) {
  const idx = source.indexOf(STAGE_MARKER);
  if (idx < 0) throw new Error('Shader missing DS-FRAGMENT-STAGE marker');
  // GLSL ES 3.00 requires `#version` to be the very first token of the source,
  // so both halves are trimmed of the newline that follows the split marker.
  return {
    vertex: source.slice(0, idx).trim(),
    fragment: source.slice(idx + STAGE_MARKER.length).trim()
  };
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

function link(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

/**
 * Create a shader-driven canvas field.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ program?:'epidermal'|'corona', maxDpr?:number, quality?:number,
 *           animated?:boolean, uniforms?:Record<string, number|number[]> }} [opts]
 */
export function createShaderField(canvas, opts = {}) {
  const state = {
    running: false,
    raf: 0,
    startTime: 0,
    lastFrame: 0,
    frames: 0,
    fps: 0,
    dpr: 1,
    quality: opts.quality ?? 1,
    supported: false,
    error: null,
    contextLost: false
  };

  let gl = null;
  let program = null;
  let vao = null;
  let vbo = null;
  let uniforms = {};
  let uniformValues = { ...(opts.uniforms ?? {}) };
  let onContextLost = null;

  function init() {
    gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
      desynchronized: true
    });
    if (!gl) {
      state.error = 'WebGL2 unavailable';
      return false;
    }

    const source = opts.program === 'corona' ? coronaSource : epidermalSource;
    let stages;
    try {
      stages = splitStages(source);
    } catch (err) {
      state.error = String(err.message);
      return false;
    }

    try {
      program = link(gl, stages.vertex, stages.fragment);
    } catch (err) {
      state.error = String(err.message);
      return false;
    }

    // Fullscreen triangle
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const names = [
      'uResolution',
      'uTime',
      'uUvDose',
      'uErythema',
      'uMelanin',
      'uSpf',
      'uState',
      'uPointer',
      'uIntensity',
      'uUvIndex',
      'uSolarElevation',
      'uMode',
      'uCorona'
    ];
    uniforms = {};
    for (const n of names) uniforms[n] = gl.getUniformLocation(program, n);

    onContextLost = (ev) => {
      ev.preventDefault();
      state.contextLost = true;
      state.running = false;
      state.error = 'WebGL context lost — will restore';
    };
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        state.contextLost = false;
        state.error = null;
        init();
        resize();
        if (state.running) loop(performance.now());
      },
      false
    );

    state.supported = true;
    return true;
  }

  /**
   * Fixed internal raster resolution, CSS-scaled to the viewport.
   *
   * A full-viewport `backdrop` layer must not be re-rastered at 2× DPR on every
   * compositor frame — that is what melts a phone in direct sun. Locking the
   * drawing buffer to a fixed budget (default 960×600 ≈ 576 kpx, the same cost
   * as a 720p video element) keeps GPU cost constant and independent of window
   * size, which is exactly the trade the "Eco-Glass" theme makes manually.
   */
  const RASTER_BUDGET = opts.rasterPixels ?? 960 * 600;

  function resize() {
    if (!gl) return;
    const aspect = Math.max(0.4, (canvas.clientWidth || 16) / (canvas.clientHeight || 9));
    const h = Math.max(240, Math.round(Math.sqrt(RASTER_BUDGET / aspect))) * Math.min(1.6, state.quality);
    const w = Math.round(h * aspect);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function setUniform(name, value) {
    uniformValues[name] = value;
  }

  function setUniforms(patch) {
    Object.assign(uniformValues, patch);
  }

  function draw(timeMs) {
    if (!gl || !program || state.contextLost) return;
    const t = (timeMs - state.startTime) / 1000;
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    if (uniforms.uResolution) gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
    if (uniforms.uTime) gl.uniform1f(uniforms.uTime, t);
    if (uniforms.uUvDose) gl.uniform1f(uniforms.uUvDose, uniformValues.uUvDose ?? 0);
    if (uniforms.uErythema) gl.uniform1f(uniforms.uErythema, uniformValues.uErythema ?? 0.3);
    if (uniforms.uMelanin) gl.uniform1f(uniforms.uMelanin, uniformValues.uMelanin ?? 0.3);
    if (uniforms.uSpf) gl.uniform1f(uniforms.uSpf, uniformValues.uSpf ?? 1);
    if (uniforms.uState) gl.uniform1f(uniforms.uState, uniformValues.uState ?? 0);
    if (uniforms.uIntensity) gl.uniform1f(uniforms.uIntensity, uniformValues.uIntensity ?? 1);
    if (uniforms.uUvIndex) gl.uniform1f(uniforms.uUvIndex, uniformValues.uUvIndex ?? 5);
    if (uniforms.uSolarElevation)
      gl.uniform1f(uniforms.uSolarElevation, uniformValues.uSolarElevation ?? 55);
    if (uniforms.uMode) gl.uniform1f(uniforms.uMode, uniformValues.uMode ?? 0);
    if (uniforms.uCorona) gl.uniform1f(uniforms.uCorona, uniformValues.uCorona ?? 0.35);
    const ptr = uniformValues.uPointer ?? [0.5, 0.2];
    if (uniforms.uPointer) gl.uniform2f(uniforms.uPointer, ptr[0], ptr[1]);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    state.frames++;
    if (timeMs - state.lastFrame > 900) {
      state.fps = Math.round((state.frames * 1000) / (timeMs - state.lastFrame));
      state.frames = 0;
      state.lastFrame = timeMs;
    }
  }

  function loop(now) {
    if (!state.running) return;
    draw(now);
    state.raf = requestAnimationFrame(loop);
  }

  return {
    state,
    init,
    resize,
    setUniform,
    setUniforms,
    start() {
      if (!state.supported && !init()) return false;
      if (state.running) return true;
      state.running = true;
      state.startTime = performance.now();
      state.lastFrame = state.startTime;
      resize();
      state.raf = requestAnimationFrame(loop);
      return true;
    },
    stop() {
      state.running = false;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
    },
    /** Adaptive quality under thermal/battery pressure. */
    setQuality(q) {
      state.quality = Math.max(0.35, Math.min(1, q));
      resize();
    },
    destroy() {
      this.stop();
      if (canvas && onContextLost) canvas.removeEventListener('webglcontextlost', onContextLost);
      if (gl) {
        if (program) gl.deleteProgram(program);
        if (vbo) gl.deleteBuffer(vbo);
        if (vao) gl.deleteVertexArray(vao);
      }
    },
    drawOnce() {
      if (!state.supported && !init()) return;
      state.startTime = performance.now();
      resize();
      draw(performance.now());
    }
  };
}

/**
 * Read a static screenshot of a shader field as a data URL. Used by the Admin
 * report exporter so a rendered dermal field is embedded in the PDF-friendly
 * JSON/PNG envelope.
 */
export function snapshotCanvas(canvas, quality = 0.8) {
  try {
    return canvas.toDataURL('image/png', quality);
  } catch {
    return null;
  }
}

/** Probe WebGL2 support without creating a long-lived context. */
export function probeWebgl2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { supported: false };
    const info = {
      supported: true,
      renderer: gl.getParameter(gl.RENDERER),
      vendor: gl.getParameter(gl.VENDOR),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      extensions: gl.getSupportedExtensions() ?? []
    };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return info;
  } catch (err) {
    return { supported: false, error: String(err) };
  }
}
