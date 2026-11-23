<script>
  /**
   * Circular progress gauge. Uses `tweened` from svelte/motion so every UV-index,
   * MED and SPF readout glides rather than snaps. Pure SVG, zero deps.
   */
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';

  let {
    value = 0,
    max = 100,
    size = 148,
    label = '',
    sub = '',
    unit = '',
    tone = 'auto',
    thickness = 9,
    digits = 1,
    ticks = 40,
    glow = true
  } = $props();

  const anim = tweened(0, { duration: 720, easing: cubicOut });

  $effect(() => {
    const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    anim.set(pct);
  });

  // Reserve room for the outward tick ring (r1 + 6 px) so nothing clips.
  const R = $derived((size - thickness * 2 - 18) / 2);
  const C = $derived(2 * Math.PI * R * 0.78);
  const toneToken = $derived(
    tone === 'auto'
      ? value / max > 0.86
        ? 'var(--danger)'
        : value / max > 0.62
          ? 'var(--warn)'
          : 'var(--accent)'
      : `var(--${tone})`
  );
</script>

<div
  class="gauge"
  style:--size={`${size}px`}
  style:--tone={toneToken}
  style:width={`${size}px`}
  style:height={`${size}px`}
>
  <svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
    <defs>
      <linearGradient id="gg-{size}-{tone}" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stop-color="var(--accent-2)" />
        <stop offset="100%" stop-color={toneToken} />
      </linearGradient>
      <filter id="gg-glow-{size}">
        <feGaussianBlur stdDeviation="3.2" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>

    <!-- tick ring -->
    <g opacity="0.5">
      {#each Array(ticks) as _, i}
        {@const a = (-135 + (270 * i) / (ticks - 1)) * (Math.PI / 180)}
        {@const r1 = R + thickness * 0.85}
        {@const r2 = r1 + (i % 5 === 0 ? 6 : 3)}
        <line
          x1={size / 2 + Math.cos(a) * r1}
          y1={size / 2 + Math.sin(a) * r1}
          x2={size / 2 + Math.cos(a) * r2}
          y2={size / 2 + Math.sin(a) * r2}
          stroke={i % 5 === 0 ? 'var(--ink-muted)' : 'var(--ink-faint)'}
          stroke-width={i % 5 === 0 ? 1.4 : 0.8}
          stroke-linecap="round"
        />
      {/each}
    </g>

    <!-- track -->
    <path
      d="M {size / 2 + Math.cos((225 * Math.PI) / 180) * R} {size / 2 + Math.sin((225 * Math.PI) / 180) * R}
         A {R} {R} 0 1 1 {size / 2 + Math.cos((-45 * Math.PI) / 180) * R} {size / 2 + Math.sin((-45 * Math.PI) / 180) * R}"
      fill="none"
      stroke="var(--glass-line-soft)"
      stroke-width={thickness}
      stroke-linecap="round"
    />
    <!-- progress -->
    <path
      d="M {size / 2 + Math.cos((225 * Math.PI) / 180) * R} {size / 2 + Math.sin((225 * Math.PI) / 180) * R}
         A {R} {R} 0 1 1 {size / 2 + Math.cos((-45 * Math.PI) / 180) * R} {size / 2 + Math.sin((-45 * Math.PI) / 180) * R}"
      fill="none"
      stroke="url(#gg-{size}-{tone})"
      stroke-width={thickness}
      stroke-linecap="round"
      stroke-dasharray={C}
      stroke-dashoffset={C * (1 - $anim)}
      filter={glow ? 'url(#gg-glow-{size})' : ''}
      style="transition:none"
    />
  </svg>

  <div class="center">
    <div class="val mono">{Number(value).toFixed(digits)}</div>
    {#if unit}<div class="unit-lbl">{unit}</div>{/if}
    {#if label}<div class="gauge-label">{label}</div>{/if}
    {#if sub}<div class="gauge-sub">{sub}</div>{/if}
  </div>
</div>

<style>
  .gauge {
    position: relative;
    display: block;
    flex: none;
    margin-inline: auto;
  }
  svg {
    display: block;
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    pointer-events: none;
  }
  .center {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    text-align: center;
    padding: 0 18%;
    pointer-events: none;
  }
  .val {
    font-size: calc(var(--size) * 0.155);
    font-weight: 640;
    letter-spacing: -0.04em;
    color: var(--ink-strong);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .unit-lbl {
    font-family: var(--font-mono);
    font-size: clamp(6.5px, calc(var(--size) * 0.062), 9px);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--tone);
  }
  .gauge-label {
    font-size: clamp(6.5px, calc(var(--size) * 0.065), 9.5px);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-faint);
    font-family: var(--font-mono);
    margin-top: 3px;
  }
  .gauge-sub {
    font-size: clamp(7px, calc(var(--size) * 0.07), 10px);
    color: var(--ink-muted);
    line-height: 1.25;
  }
</style>
