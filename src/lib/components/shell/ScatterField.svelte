<script>
  /**
   * Svelte wrapper around the WebGL2 renderer. Owns the opaque lifecycle and maps
   * live clinical state onto shader uniforms:
   *   UVI / erythema / SPF integrity / melanin → dermal scattering state.
   * Degrades to a CSS gradient when WebGL2 is unavailable or in Eco mode.
   */
  import { createShaderField } from '$lib/engines/webgl-renderer.js';
  import { app } from '$lib/db/store.svelte.js';

  let canvas = $state(null);
  let field = null;
  let failed = $state(false);
  let live = $state(false);

  const enabled = $derived(app.gpuMode !== 'low' && app.theme !== 'eco');

  function doseFraction() {
    const uvi = app.solar.uvIndex;
    const elapsed = app.timers.exposureElapsedMin;
    return Math.min(1, (uvi * 0.025 * 60 * elapsed) / Math.max(120, app.med));
  }

  function stateIndex() {
    if (app.solar.uvIndex >= 9 || app.scan.erythemaIndex >= 35) return 2;
    if (app.solar.uvIndex >= 6 || app.scan.erythemaIndex >= 30) return 1;
    return 0;
  }

  function melaninFraction() {
    // ITA° +70 (very light) → 0 ; ITA° −60 (deep) → 1
    return Math.max(0, Math.min(1, (70 - app.scan.ita) / 130));
  }

  // `failed` may only be raised once WebGL has actually been attempted for the
  // current canvas — otherwise the CSS fallback would paint over a live shader.
  function markFailed(err) {
    if (err) console.warn('[ScatterField] shader field unavailable:', err);
    failed = true;
    live = false;
  }

  $effect(() => {
    if (!canvas || !enabled) {
      live = false;
      return;
    }
    let ok = false;
    try {
      field = createShaderField(canvas, { program: 'epidermal', maxDpr: 1.5 });
      ok = field.start();
    } catch (err) {
      markFailed(err);
      return;
    }
    if (!ok) {
      markFailed(field?.state?.error ?? 'WebGL2 unavailable');
      return;
    }
    failed = false;
    live = true;
    const onResize = () => field?.resize();
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(() => field?.resize());
    ro.observe(canvas);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      field?.destroy();
      field = null;
      live = false;
    };
  });

  // Push uniforms whenever clinical state changes (no per-frame JS work).
  $effect(() => {
    if (!field) return;
    field.setUniforms({
      uUvDose: doseFraction(),
      uErythema: Math.min(1.4, app.scan.erythemaIndex / 35),
      uMelanin: melaninFraction(),
      uSpf: 1,
      uState: stateIndex(),
      uPointer: [app.specular.x, app.specular.y],
      uIntensity: app.theme === 'daylight' ? 0.55 : 0.95
    });
  });

  // Pause the rAF loop when the tab is hidden (battery).
  $effect(() => {
    const onVis = () => {
      if (!field) return;
      if (document.hidden) field.stop();
      else field.start();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  });
</script>

{#if enabled}
  <canvas bind:this={canvas} class="scatter-canvas" data-live={live} data-failed={failed} width="960" height="600" aria-hidden="true"></canvas>
{/if}
{#if failed || !enabled}
  <div class="fallback" aria-hidden="true"></div>
{/if}

<style>
  .fallback {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background:
      radial-gradient(60% 50% at 18% 12%, color-mix(in srgb, var(--teal) 16%, transparent), transparent 70%),
      radial-gradient(52% 46% at 88% 18%, color-mix(in srgb, var(--violet) 14%, transparent), transparent 70%),
      radial-gradient(70% 60% at 48% 96%, color-mix(in srgb, var(--gold) 10%, transparent), transparent 72%);
    animation: breathe 18s ease-in-out infinite alternate;
  }
  @keyframes breathe {
    from {
      transform: scale(1) rotate(0deg);
      opacity: 0.85;
    }
    to {
      transform: scale(1.12) rotate(2deg);
      opacity: 1;
    }
  }
</style>
