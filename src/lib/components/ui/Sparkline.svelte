<script>
  /**
   * Zero-dependency SVG plot for the SPF decay curve, UV meter traces and
   * erythema time-series. Supports multiple series, threshold band, glow, and
   * a live cursor readout.
   */
  let {
    series = [],
    width = 640,
    height = 190,
    xMax = null,
    yMax = null,
    yMin = 0,
    xLabel = '',
    yLabel = '',
    threshold = null,
    thresholdLabel = 'Alarm threshold',
    grid = true,
    glow = true,
    marker = null,
    onhover = null
  } = $props();

  const W = $derived(width);
  const H = $derived(height);
  const pad = $derived({ l: 34, r: 12, t: 12, b: 22 });

  const allPoints = $derived(series.flatMap((s) => s.points ?? []));
  const xHi = $derived(xMax ?? Math.max(1, ...allPoints.map((p) => p.x)));
  const yHi = $derived(yMax ?? Math.max(1, ...allPoints.map((p) => p.y)));
  const yLo = $derived(yMin);

  const sx = $derived((x) => pad.l + ((x - 0) / (xHi || 1)) * (W - pad.l - pad.r));
  const sy = $derived((y) => H - pad.b - ((y - yLo) / (yHi - yLo || 1)) * (H - pad.t - pad.b));

  const pathFor = (pts) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');

  const areaFor = (pts) => {
    if (!pts.length) return '';
    const line = pathFor(pts);
    return `${line} L ${sx(pts[pts.length - 1].x).toFixed(1)} ${H - pad.b} L ${sx(pts[0].x).toFixed(1)} ${H - pad.b} Z`;
  };

  const yTicks = $derived(
    Array.from({ length: 5 }, (_, i) => {
      const v = yLo + ((yHi - yLo) * i) / 4;
      return { v, y: sy(v) };
    })
  );
  const xTicks = $derived(
    Array.from({ length: 5 }, (_, i) => {
      const v = (xHi * i) / 4;
      return { v, x: sx(v) };
    })
  );

  let hoverX = $state(null);
  function handleMove(ev) {
    const rect = ev.currentTarget.getBoundingClientRect();
    const rel = ((ev.clientX - rect.left) / rect.width) * W;
    hoverX = Math.max(pad.l, Math.min(W - pad.r, rel));
    const xVal = ((hoverX - pad.l) / (W - pad.l - pad.r)) * xHi;
    onhover?.(xVal);
  }
</script>

<div class="spark" style="--w:{W};--h:{H}">
  <svg
    viewBox="0 0 {W} {H}"
    role="img"
    aria-label={`${yLabel} against ${xLabel}`}
    onpointermove={handleMove}
    onpointerleave={() => {
      hoverX = null;
      onhover?.(null);
    }}
  >
    <defs>
      {#each series as s, i}
        <linearGradient id="spark-fill-{i}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={s.color ?? 'var(--accent)'} stop-opacity="0.32" />
          <stop offset="100%" stop-color={s.color ?? 'var(--accent)'} stop-opacity="0" />
        </linearGradient>
        <filter id="spark-glow-{i}">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      {/each}
    </defs>

    {#if grid}
      {#each yTicks as t}
        <line x1={pad.l} y1={t.y} x2={W - pad.r} y2={t.y} stroke="var(--glass-line-soft)" stroke-width="1" stroke-dasharray={t.v === yLo ? '' : '2 4'} />
        <text x={pad.l - 6} y={t.y + 3} text-anchor="end" class="tick">{t.v.toFixed(yHi < 10 ? 1 : 0)}</text>
      {/each}
      {#each xTicks as t}
        <text x={t.x} y={H - 6} text-anchor="middle" class="tick">{Math.round(t.v)}</text>
      {/each}
    {/if}

    {#if threshold != null}
      <line
        x1={pad.l}
        y1={sy(threshold)}
        x2={W - pad.r}
        y2={sy(threshold)}
        stroke="var(--danger)"
        stroke-width="1.2"
        stroke-dasharray="5 5"
        opacity="0.72"
      />
      <text x={W - pad.r} y={sy(threshold) - 4} text-anchor="end" class="thr-lbl">{thresholdLabel}</text>
    {/if}

    {#each series as s, i}
      <path d={areaFor(s.points ?? [])} fill="url(#spark-fill-{i})" />
      <path
        d={pathFor(s.points ?? [])}
        fill="none"
        stroke={s.color ?? 'var(--accent)'}
        stroke-width={s.width ?? 2}
        stroke-linecap="round"
        stroke-linejoin="round"
        filter={glow ? 'url(#spark-glow-{i})' : ''}
        stroke-dasharray={s.dashed ? '4 4' : ''}
      />
    {/each}

    {#if marker != null && marker.x != null}
      <line x1={sx(marker.x)} y1={pad.t} x2={sx(marker.x)} y2={H - pad.b} stroke="var(--gold)" stroke-width="1.2" opacity="0.85" />
      <circle cx={sx(marker.x)} cy={sy(marker.y)} r="3.6" fill="var(--gold)" stroke="var(--bg-void)" stroke-width="1.5" />
    {/if}

    {#if hoverX != null}
      <line x1={hoverX} y1={pad.t} x2={hoverX} y2={H - pad.b} stroke="var(--ink-muted)" stroke-width="0.8" opacity="0.55" />
    {/if}
  </svg>

  {#if series.length > 1}
    <div class="legend">
      {#each series as s}
        <span class="lg"><i style="background:{s.color}"></i>{s.label}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .spark {
    width: 100%;
    position: relative;
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
    overflow: visible;
    touch-action: pan-y;
  }
  .tick {
    font-family: var(--font-mono);
    font-size: 8.5px;
    fill: var(--ink-faint);
  }
  .thr-lbl {
    font-family: var(--font-mono);
    font-size: 8.5px;
    fill: var(--danger);
    letter-spacing: 0.05em;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 6px;
    padding-left: 34px;
  }
  .lg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--ink-muted);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .lg i {
    width: 12px;
    height: 2px;
    border-radius: 2px;
  }
</style>
