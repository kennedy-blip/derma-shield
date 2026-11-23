<script>
  /** Theme + GPU mode popover. Four photobiological environments. */
  import { app, THEMES } from '$lib/db/store.svelte.js';
  import Icon from '../ui/Icon.svelte';

  let open = $state(false);
  let wrap = $state(null);

  function onDocClick(ev) {
    if (open && wrap && !wrap.contains(ev.target)) open = false;
  }
  $effect(() => {
    document.addEventListener('pointerdown', onDocClick);
    return () => document.removeEventListener('pointerdown', onDocClick);
  });
</script>

<div class="wrap" bind:this={wrap}>
  <button
    class="theme-btn glass-soft"
    onclick={() => (open = !open)}
    aria-expanded={open}
    aria-haspopup="menu"
    title="Theme & clinical environment"
  >
    <span class="swatches" aria-hidden="true">
      {#each app.themeMeta.swatch as c}
        <i style="background:{c}"></i>
      {/each}
    </span>
    <span class="lbl hide-mobile">{app.themeMeta.label}</span>
    <Icon name="chevronDown" size={13} />
  </button>

  {#if open}
    <div class="menu glass" role="menu">
      <div class="menu-eyebrow eyebrow">Clinical environment</div>
      {#each THEMES as t}
        <button
          class="opt"
          class:active={app.theme === t.id}
          role="menuitemradio"
          aria-checked={app.theme === t.id}
          onclick={() => {
            app.setTheme(t.id);
            open = false;
          }}
        >
          <span class="sw" aria-hidden="true">
            {#each t.swatch as c}<i style="background:{c}"></i>{/each}
          </span>
          <span class="txt">
            <strong>{t.label}</strong>
            <em>{t.sub}</em>
          </span>
          {#if app.theme === t.id}<Icon name="check" size={14} />{/if}
        </button>
      {/each}

      <hr class="divider" />
      <div class="menu-eyebrow eyebrow">GPU performance</div>
      <div class="gpu-row">
        <button class="gpu" class:active={app.gpuMode === 'high'} onclick={() => app.setGpu('high')}>
          <Icon name="sparkle" size={14} /> Full GLSL
        </button>
        <button class="gpu" class:active={app.gpuMode === 'low'} onclick={() => app.setGpu('low')}>
          <Icon name="bolt" size={14} /> Eco / API&lt;31
        </button>
      </div>
      <p class="tiny faint note">
        Eco mode removes backdrop blur + WebGL shaders to prevent thermal throttling in direct sun.
      </p>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  .theme-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 9px 5px 6px;
    border-radius: var(--r-pill);
    border: 1px solid var(--glass-line);
    color: var(--ink-muted);
    font-size: 11.5px;
    transition: 220ms;
    height: 34px;
  }
  .theme-btn:hover {
    color: var(--ink-strong);
    border-color: color-mix(in srgb, var(--accent) 46%, transparent);
  }
  .swatches {
    display: flex;
    gap: 2px;
  }
  .swatches i {
    width: 9px;
    height: 16px;
    border-radius: 3px;
    display: block;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  }
  .swatches i:first-child {
    border-radius: 6px 3px 3px 6px;
  }
  .swatches i:last-child {
    border-radius: 3px 6px 6px 3px;
  }
  .lbl {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    width: 306px;
    padding: 12px;
    z-index: 80;
    display: flex;
    flex-direction: column;
    gap: 4px;
    animation: drop 300ms var(--ease-spring);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.97);
    }
  }
  .menu-eyebrow {
    margin: 4px 0 6px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 12px;
    text-align: left;
    border: 1px solid transparent;
    transition: 200ms;
    color: var(--ink);
  }
  .opt:hover {
    background: var(--glass-bg-soft);
  }
  .opt.active {
    background: color-mix(in srgb, var(--accent) 13%, transparent);
    border-color: color-mix(in srgb, var(--accent) 34%, transparent);
  }
  .sw {
    display: flex;
    flex-direction: column;
    borderRadius: 8px;
    overflow: hidden;
    flex: none;
  }
  .sw i {
    width: 20px;
    height: 9px;
    display: block;
  }
  .sw i:first-child {
    border-radius: 6px 6px 0 0;
  }
  .sw i:last-child {
    border-radius: 0 0 6px 6px;
  }
  .txt {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .txt strong {
    font-size: 12.5px;
    font-weight: 590;
  }
  .txt em {
    font-style: normal;
    font-size: 10.5px;
    color: var(--ink-faint);
    line-height: 1.35;
  }
  .gpu-row {
    display: flex;
    gap: 6px;
  }
  .gpu {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 7px;
    border-radius: 10px;
    border: 1px solid var(--glass-line-soft);
    font-size: 11px;
    color: var(--ink-muted);
    transition: 200ms;
  }
  .gpu.active {
    color: var(--ink-strong);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    border-color: color-mix(in srgb, var(--accent) 42%, transparent);
  }
  .note {
    margin-top: 6px;
    color: var(--ink-faint);
  }
</style>
