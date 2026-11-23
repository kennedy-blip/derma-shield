<script>
  /**
   * Labelled range slider with a live fill gradient, value bubble and optional
   * preset ticks. Used for UV index, altitude, BSA, ozone etc.
   */
  let {
    label = '',
    value = 0,
    min = 0,
    max = 100,
    step = 1,
    unit = '',
    digits = 0,
    hints = [],
    tone = 'default',
    onchange = () => {},
    disabled = false
  } = $props();

  const fill = $derived(((value - min) / (max - min)) * 100);
  const hint = $derived(hints.find((h) => Math.abs(h.at - value) < step / 2)?.label ?? '');
</script>

<div class="slider" data-tone={tone}>
  <div class="head">
    <span class="label">{label}</span>
    <span class="val mono">{Number(value).toFixed(digits)}<em>{unit}</em></span>
  </div>
  <input
    type="range"
    {min}
    {max}
    {step}
    {disabled}
    {value}
    style="--fill:{fill}%"
    aria-label={label}
    oninput={(e) => onchange(Number(e.currentTarget.value))}
  />
  {#if hints.length}
    <div class="ticks">
      {#each hints as h}
        <span class="tick" class:active={Math.abs(h.at - value) < step / 2}>{h.label}</span>
      {/each}
    </div>
  {/if}
  {#if hint}<div class="hint tiny">{hint}</div>{/if}
</div>

<style>
  .slider {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .label {
    font-size: 11px;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: var(--ink-faint);
    font-family: var(--font-mono);
  }
  .val {
    font-size: 15px;
    font-weight: 620;
    color: var(--ink-strong);
    font-variant-numeric: tabular-nums;
  }
  .val em {
    font-style: normal;
    font-size: 10px;
    color: var(--ink-faint);
    margin-left: 3px;
    letter-spacing: 0.06em;
  }
  .ticks {
    display: flex;
    justify-content: space-between;
    gap: 4px;
  }
  .tick {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--ink-faint);
    letter-spacing: 0.04em;
    transition: color 240ms;
  }
  .tick.active {
    color: var(--accent);
  }
  .hint {
    color: var(--ink-muted);
  }
  .slider[data-tone='gold'] input[type='range']::-webkit-slider-runnable-track {
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--gold) 84%, transparent) var(--fill, 50%),
      color-mix(in srgb, var(--ink-faint) 24%, transparent) var(--fill, 50%)
    );
  }
</style>
