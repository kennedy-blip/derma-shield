<script>
  /**
   * Gooey "metaball" navigation dock.
   *
   * The active droplet is a real element swept by a spring; an SVG
   * feGaussianBlur + feColorMatrix contrast filter is applied to a duplicate
   * layer so the blob visibly stretches like mercury/serum between modules.
   * Low-GPU modes fall back to a plain capsule.
   */
  import { spring } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import Icon from '../ui/Icon.svelte';
  import { app } from '$lib/db/store.svelte.js';

  let { modules = [], onApk = () => {} } = $props();

  let dockEl = $state(null);
  let blob = $state({ x: 0, w: 0, ready: false });
  const pos = spring({ x: 0, w: 0 }, { stiffness: 0.16, damping: 0.66 });

  const lowGpu = $derived(app.gpuMode === 'low' || app.theme === 'eco');

  /** Resolve a module's gate ('pro' | 'director') against the live RBAC tier. */
  function isGated(m) {
    if (!m.gated) return false;
    return m.gated === 'pro' ? !app.isPro : !app.isDirector;
  }

  function measure() {
    if (!dockEl) return;
    const btn = dockEl.querySelector(`[data-mod="${app.activeModule}"]`);
    if (!btn) return;
    const dr = dockEl.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    blob = { x: br.left - dr.left, w: br.width, ready: true };
    pos.set({ x: br.left - dr.left, w: br.width }, { duration: 520, easing: cubicOut });
  }

  $effect(() => {
    // re-measure whenever the active module (or layout) changes
    void app.activeModule;
    void app.formFactor;
    void app.role;
    requestAnimationFrame(measure);
  });

  $effect(() => {
    if (typeof ResizeObserver === 'undefined' || !dockEl) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(dockEl);
    return () => ro.disconnect();
  });

</script>

<div class="dock-wrap">
  <!-- goo filter definition -->
  <svg width="0" height="0" aria-hidden="true" style="position:absolute">
    <defs>
      <filter id="goo-blur">
        <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
        <feColorMatrix
          in="blur"
          mode="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"
          result="goo"
        />
        <feBlend in="SourceGraphic" in2="goo" />
      </filter>
    </defs>
  </svg>

  <nav class="dock" bind:this={dockEl} aria-label="Modules" data-goo={!lowGpu}>
    {#if blob.ready}
      <span
        class="dock-blob"
        style="transform:translateX({$pos.x}px);width:{$pos.w}px"
        aria-hidden="true"
      ></span>
    {/if}

    {#each modules as m}
      {@const gated = isGated(m)}
      <button
        class="dock-item"
        data-mod={m.id}
        data-active={app.activeModule === m.id}
        data-gated={gated}
        onclick={() => {
          if (gated) {
            app.openModal('privileges', { focus: m.gated });
            return;
          }
          app.setModule(m.id);
        }}
        title={gated ? `${m.label} — requires ${m.gated === 'pro' ? 'Pro' : 'Director'} tier` : m.label}
        aria-current={app.activeModule === m.id ? 'page' : undefined}
      >
        <span class="dock-ico">
          <Icon name={m.icon} size={19} />
          {#if gated}<span class="lock-dot"><Icon name="lock" size={8} stroke={2.2} /></span>{/if}
        </span>
        <span class="dock-label">{m.short ?? m.label}</span>
      </button>
    {/each}

    <button class="dock-apk" onclick={onApk} title="Download Android .APK" aria-label="Download Android APK">
      <Icon name="android" size={21} />
    </button>
  </nav>

  <div class="dock-meta hide-mobile">
    <span class="dot live" style="color:var(--ok)"></span>
    OFFLINE-FIRST
    <span class="sep">·</span>
    {app.vaultState.pendingSync > 0
      ? `${app.vaultState.pendingSync} QUEUED`
      : 'VAULT SYNCED'}
    <span class="sep">·</span>
    API &lt;31 ECO
  </div>
</div>

<style>
  .dock-wrap {
    position: fixed;
    left: 50%;
    bottom: calc(12px + var(--safe-bottom));
    transform: translateX(-50%);
    z-index: 45;
    width: min(700px, calc(100% - 18px));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
  }
  .dock {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 3px;
    padding: 7px;
    border-radius: 26px;
    background: var(--glass-bg-strong);
    border: 1px solid var(--glass-line);
    box-shadow:
      0 26px 60px -24px rgba(0, 0, 0, 0.78),
      inset 0 1px 1px var(--specular);
    backdrop-filter: blur(var(--blur-lg)) saturate(175%);
    -webkit-backdrop-filter: blur(var(--blur-lg)) saturate(175%);
    position: relative;
    isolation: isolate;
  }
  .dock[data-goo='true'] .dock-blob {
    filter: url(#goo-blur);
  }
  :global(html[data-gpu='low']) .dock,
  :global(html[data-theme='eco']) .dock {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: var(--glass-bg-strong);
  }
  .dock-blob {
    position: absolute;
    top: 7px;
    bottom: 7px;
    left: 0;
    border-radius: 19px;
    background: linear-gradient(
      140deg,
      color-mix(in srgb, var(--accent) 40%, transparent),
      color-mix(in srgb, var(--accent-2) 22%, transparent)
    );
    border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
    box-shadow:
      inset 0 1px 1px var(--specular),
      0 8px 26px -12px color-mix(in srgb, var(--accent) 85%, transparent);
    z-index: 0;
    pointer-events: none;
    will-change: transform, width;
  }
  .dock-item {
    position: relative;
    z-index: 1;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 7px 3px 5px;
    border-radius: 18px;
    color: var(--ink-muted);
    transition: color 260ms;
  }
  .dock-item[data-active='true'] {
    color: var(--ink-strong);
  }
  .dock-item[data-gated='true'] {
    color: var(--ink-faint);
  }
  .dock-item:hover {
    color: var(--ink-strong);
  }
  .dock-ico {
    position: relative;
    display: grid;
    place-items: center;
    transition: transform 380ms var(--ease-spring);
  }
  .dock-item[data-active='true'] .dock-ico {
    transform: translateY(-1px) scale(1.08);
  }
  .lock-dot {
    position: absolute;
    right: -6px;
    top: -4px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--bg-deep);
    border: 1px solid var(--glass-line);
    color: var(--gold);
  }
  .dock-label {
    font-family: var(--font-mono);
    font-size: 8.2px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    line-height: 1.1;
  }
  .dock-apk {
    flex: none;
    width: 46px;
    height: 46px;
    border-radius: 17px;
    display: grid;
    place-items: center;
    background: linear-gradient(140deg, var(--gold), color-mix(in srgb, var(--rose) 62%, var(--gold)));
    color: #1a1204;
    box-shadow:
      0 8px 26px -10px color-mix(in srgb, var(--gold) 90%, transparent),
      inset 0 1px 1px rgba(255, 255, 255, 0.5);
    margin-left: 3px;
    transition: transform 300ms var(--ease-spring);
    animation: apk-breathe 4.5s ease-in-out infinite;
  }
  .dock-apk:hover {
    transform: scale(1.06) rotate(-2deg);
  }
  .dock-apk:active {
    transform: scale(0.94);
  }
  @keyframes apk-breathe {
    0%,
    100% {
      box-shadow: 0 8px 24px -10px color-mix(in srgb, var(--gold) 78%, transparent), inset 0 1px 1px rgba(255,255,255,.5);
    }
    50% {
      box-shadow: 0 10px 38px -8px color-mix(in srgb, var(--gold) 100%, transparent), inset 0 1px 1px rgba(255,255,255,.62);
    }
  }
  .dock-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.13em;
    color: var(--ink-faint);
    text-transform: uppercase;
    padding: 2px 10px;
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--bg-void) 62%, transparent);
    backdrop-filter: blur(8px);
  }
  .sep {
    opacity: 0.5;
  }
  @media (max-width: 640px) {
    .dock-label {
      font-size: 7px;
    }
    .dock-item {
      padding: 6px 1px 4px;
    }
  }
</style>
