<script>
  /**
   * Tracks cursor / gyroscope tilt and publishes a normalized light vector to
   * the store. Every `.spec` glass surface reads it via CSS custom properties,
   * so one listener drives the whole UI's specular sweep.
   */
  import { app } from '$lib/db/store.svelte.js';

  let raf = 0;
  let target = { x: 0.5, y: 0.2 };

  function publish() {
    raf = 0;
    app.setSpecular(target.x, target.y, true);
    document.documentElement.style.setProperty('--spec-x', `${(target.x * 100).toFixed(1)}%`);
    document.documentElement.style.setProperty('--spec-y', `${(target.y * 100).toFixed(1)}%`);
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(publish);
  }

  function onPointer(ev) {
    target = {
      x: Math.max(0, Math.min(1, ev.clientX / window.innerWidth)),
      y: Math.max(0, Math.min(1, ev.clientY / window.innerHeight))
    };
    schedule();
  }

  function onOrient(ev) {
    if (ev.gamma == null && ev.beta == null) return;
    // map ±45° device tilt onto the screen-space light vector
    target = {
      x: Math.max(0, Math.min(1, 0.5 + (ev.gamma ?? 0) / 90)),
      y: Math.max(0, Math.min(1, 0.5 - (ev.beta ?? 0) / 180))
    };
    schedule();
  }

  $effect(() => {
    if (app.gpuMode === 'low') return;
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('deviceorientation', onOrient, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('deviceorientation', onOrient);
      if (raf) cancelAnimationFrame(raf);
    };
  });
</script>

<div class="grain" aria-hidden="true"></div>
<div class="prism-orbit" aria-hidden="true"></div>

<style>
  .prism-orbit {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: radial-gradient(
      620px circle at var(--spec-x, 50%) var(--spec-y, 20%),
      color-mix(in srgb, var(--accent) 7%, transparent),
      transparent 62%
    );
    transition: background 220ms linear;
  }
  :global(html[data-gpu='low']) .prism-orbit,
  :global(html[data-theme='eco']) .prism-orbit {
    display: none;
  }
</style>
