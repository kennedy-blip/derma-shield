<script>
  /**
   * Segmented control with an animated liquid indicator. Uses spring() so the
   * pill stretches between options like serum.
   */
  import { spring } from 'svelte/motion';

  let {
    options = [],
    value = null,
    onchange = () => {},
    size = 'md',
    fill = false,
    ariaLabel = 'Options'
  } = $props();

  let wrap = $state(null);
  let geom = $state({ x: 0, w: 0, ready: false });
  const pos = spring({ x: 0, scale: 1 }, { stiffness: 0.19, damping: 0.62 });

  const idx = $derived(Math.max(0, options.findIndex((o) => o.id === value)));

  $effect(() => {
    if (!wrap) return;
    const buttons = wrap.querySelectorAll('button');
    const el = buttons[idx];
    if (!el) return;
    const wr = wrap.getBoundingClientRect();
    const br = el.getBoundingClientRect();
    geom = { x: br.left - wr.left, w: br.width, ready: true };
    pos.set({ x: br.left - wr.left, scale: 1 }, { duration: 420 });
  });
</script>

<div class="seg-wrap" bind:this={wrap} class:fill data-size={size} role="group" aria-label={ariaLabel}>
  {#if geom.ready}
    <span
      class="indicator"
      style="transform:translateX({$pos.x}px);width:{geom.w}px"
      aria-hidden="true"
    ></span>
  {/if}
  {#each options as opt}
    <button
      type="button"
      aria-pressed={opt.id === value}
      onclick={() => onchange(opt.id)}
      title={opt.title ?? opt.label}
    >
      {#if opt.icon}<span class="ico">{opt.icon}</span>{/if}
      {opt.label}
      {#if opt.badge}<span class="mini-badge">{opt.badge}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .seg-wrap {
    display: inline-flex;
    padding: 3px;
    gap: 2px;
    border-radius: var(--r-pill);
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    position: relative;
    isolation: isolate;
    max-width: 100%;
    overflow: hidden;
  }
  .seg-wrap.fill {
    display: flex;
    width: 100%;
  }
  .seg-wrap.fill button {
    flex: 1;
    min-width: 0;
  }
  .indicator {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 0;
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    box-shadow: inset 0 1px 1px var(--specular);
    z-index: 0;
    transition: width 320ms var(--ease-out);
    pointer-events: none;
  }
  button {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: var(--r-pill);
    font-size: 11.5px;
    font-weight: 560;
    color: var(--ink-muted);
    transition: color 220ms;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  button[aria-pressed='true'] {
    color: var(--ink-strong);
  }
  button:hover {
    color: var(--ink-strong);
  }
  .seg-wrap[data-size='sm'] button {
    padding: 4px 9px;
    font-size: 10.5px;
  }
  .seg-wrap[data-size='lg'] button {
    padding: 9px 16px;
    font-size: 13px;
  }
  .ico {
    display: grid;
    place-items: center;
    opacity: 0.9;
  }
  .mini-badge {
    font-family: var(--font-mono);
    font-size: 8.5px;
    padding: 1px 4px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 26%, transparent);
    color: var(--ink-strong);
    letter-spacing: 0.06em;
  }
</style>
