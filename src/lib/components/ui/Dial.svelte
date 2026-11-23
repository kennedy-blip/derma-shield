<script>
  /**
   * Segmented clinical dial: a radial arc gauge with banded colouring for UV
   * Index risk zones and an animated needle driven by svelte/motion springs.
   */
  import { spring } from 'svelte/motion';

  let {
    value = 0,
    min = 0,
    max = 15,
    size = 210,
    bands = [],
    label = '',
    sub = '',
    unit = '',
    marker = null
  } = $props();

  const pos = spring(0, { stiffness: 0.17, damping: 0.7 });
  $effect(() => {
    pos.set(Math.max(0, Math.min(1, (value - min) / (max - min))));
  });

  const START = 150; // degrees
  const SWEEP = 240;

  const R = $derived(size * 0.375);
  const cx = $derived(size / 2);
  const cy = $derived(size / 2);

  function polar(deg, radius) {
    const a = (deg * Math.PI) / 180;
    return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
  }

  function arc(fromDeg, toDeg, radius) {
    const [x0, y0] = polar(fromDeg, radius);
    const [x1, y1] = polar(toDeg, radius);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1}`;
  }

  const needleAngle = $derived(START + SWEEP * $pos);
  const [nx, ny] = $derived(polar(needleAngle, R - size * 0.085));
  const [tx, ty] = $derived(polar(needleAngle, R + size * 0.055));

  const activeBand = $derived(
    bands.find((b) => value >= b.from && value < b.to) ?? bands[bands.length - 1]
  );
</script>

<div class="dial" style="width:{size}px">
  <svg width={size} height={size * 0.82} viewBox="0 0 {size} {size * 0.82}" aria-hidden="true">
    <defs>
      <filter id="dial-glow">
        <feGaussianBlur stdDeviation="2.6" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>

    <!-- banded track -->
    {#each bands as b}
      {@const f0 = START + (SWEEP * (b.from - min)) / (max - min)}
      {@const f1 = START + (SWEEP * (b.to - min)) / (max - min)}
      <path d={arc(f0, f1, R)} fill="none" stroke={b.color} stroke-width={size * 0.055}
            stroke-linecap="butt" opacity={activeBand === b ? 0.95 : 0.26} />
    {/each}

    <!-- ticks -->
    {#each Array(16) as _, i}
      {@const a = START + (SWEEP * i) / 15}
      {@const [x1, y1] = polar(a, R + size * 0.055)}
      {@const [x2, y2] = polar(a, R + size * (i % 5 === 0 ? 0.098 : 0.075))}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-faint)"
            stroke-width={i % 5 === 0 ? 1.4 : 0.7} stroke-linecap="round" opacity="0.8" />
    {/each}

    <!-- needle -->
    <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--ink-strong)" stroke-width="2.4"
          stroke-linecap="round" filter="url(#dial-glow)" />
    <circle cx={cx} cy={cy} r={size * 0.042} fill="var(--glass-bg-strong)"
            stroke={activeBand?.color ?? 'var(--accent)'} stroke-width="2" />
    <circle cx={cx} cy={cy} r={size * 0.014} fill={activeBand?.color ?? 'var(--accent)'} />
    <circle cx={tx} cy={ty} r={size * 0.016} fill={activeBand?.color ?? 'var(--accent)'} opacity="0.9" />

    {#if marker != null}
      {@const ma = START + (SWEEP * (marker - min)) / (max - min)}
      {@const [mx1, my1] = polar(ma, R - size * 0.04)}
      {@const [mx2, my2] = polar(ma, R + size * 0.04)}
      <line x1={mx1} y1={my1} x2={mx2} y2={my2} stroke="var(--gold)" stroke-width="2"
            stroke-dasharray="3 2" />
    {/if}
  </svg>

  <div class="dial-center">
    <div class="val mono">{Number(value).toFixed(1)}</div>
    {#if unit}<div class="unit-lbl">{unit}</div>{/if}
    {#if label}<div class="band" style="color:{activeBand?.color}">{label}</div>{/if}
    {#if sub}<div class="sub">{sub}</div>{/if}
  </div>
</div>

<style>
  .dial {
    position: relative;
    margin-inline: auto;
  }
  svg {
    display: block;
    width: 100%;
    overflow: visible;
  }
  .dial-center {
    position: absolute;
    left: 0;
    right: 0;
    top: 52%;
    transform: translateY(-42%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    pointer-events: none;
  }
  .val {
    font-size: 30px;
    font-weight: 660;
    letter-spacing: -0.045em;
    line-height: 1;
    color: var(--ink-strong);
  }
  .unit-lbl {
    font-family: var(--font-mono);
    font-size: 8.5px;
    letter-spacing: 0.2em;
    color: var(--ink-faint);
    text-transform: uppercase;
  }
  .band {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    margin-top: 3px;
  }
  .sub {
    font-size: 9.5px;
    color: var(--ink-faint);
  }
</style>
