<script>
  /**
   * Frosted glass panel with prism border, optional specular sweep, and an
   * optional "squish" press animation. Every module is built from these.
   */
  let {
    title = '',
    sub = '',
    icon = '',
    tone = 'default',
    pad = true,
    squish = false,
    spec = true,
    class: cls = '',
    head = true,
    children,
    actions
  } = $props();

  let el = $state(null);

  function onPointerMove(ev) {
    if (!spec || !el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${((ev.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty('--my', `${((ev.clientY - r.top) / r.height) * 100}%`);
  }
</script>

<section
  bind:this={el}
  role="group"
  class="glass panel {cls}"
  class:pad
  class:spec
  class:squish
  data-tone={tone}
  onpointermove={onPointerMove}
>
  {#if head && (title || actions)}
    <header class="panel-head">
      <div class="head-main">
        {#if icon}
          <span class="badge" data-tone={tone}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d={icon} />
            </svg>
          </span>
        {/if}
        <div class="head-text">
          {#if title}<h3 class="h2">{title}</h3>{/if}
          {#if sub}<p class="sub tiny">{sub}</p>{/if}
        </div>
      </div>
      {#if actions}
        <div class="actions">{@render actions()}</div>
      {/if}
    </header>
  {/if}
  {@render children()}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .panel.pad {
    padding: clamp(14px, 1.6vw, 20px);
  }
  .panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }
  .head-main {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }
  .head-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .sub {
    color: var(--ink-muted);
    max-width: 62ch;
  }
  .badge {
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 10px;
    display: grid;
    place-items: center;
    border: 1px solid var(--glass-line);
    background: var(--glass-bg-soft);
    color: var(--accent);
  }
  .badge[data-tone='gold'] {
    color: var(--gold);
    background: color-mix(in srgb, var(--gold) 12%, transparent);
    border-color: color-mix(in srgb, var(--gold) 34%, transparent);
  }
  .badge[data-tone='danger'] {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    border-color: color-mix(in srgb, var(--danger) 32%, transparent);
  }
  .badge[data-tone='violet'] {
    color: var(--violet);
    background: color-mix(in srgb, var(--violet) 12%, transparent);
    border-color: color-mix(in srgb, var(--violet) 32%, transparent);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .panel[data-tone='warn'] {
    --accent: var(--warn);
  }
  .panel[data-tone='danger'] {
    --accent: var(--danger);
  }
</style>
