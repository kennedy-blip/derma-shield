<script>
  /**
   * Privileges & Runtime drawer (RBAC + sensor permission matrix).
   *
   * Three privilege tiers gate module access. Below them the permission matrix
   * shows, per sensor-backed capability, which backend is actually serving it
   * (native Kotlin plugin / WebView API / deterministic simulator) and lets the
   * operator request a real sensor or drop back to the simulator.
   */
  import { app, ROLES, PERMISSIONS } from '$lib/db/store.svelte.js';
  import { createSensorBridge, SENSOR_STATES } from '$lib/engines/sensor-bridge.js';
  import { detectCameraCapabilities, openCameraStream, closeStream } from '$lib/engines/camera-optics.js';
  import { triggerHaptics } from '$lib/engines/audio-haptics.js';
  import Icon from '../ui/Icon.svelte';

  const role = $derived(app.role);
  const perms = $derived(app.permissions);

  const originLabel = $derived.by(() => {
    if (typeof location === 'undefined') return 'server';
    return location.host || 'localhost';
  });

  const backendTone = {
    'NATIVE KOTLIN': 'ok',
    'WEB ACTIVE': 'accent',
    'SIMULATOR ACTIVE': 'warn',
    RESTRICTED: 'danger'
  };

  async function request(kind) {
    try {
      if (kind === 'camera') {
        const caps = detectCameraCapabilities();
        if (!caps.available) throw new Error('getUserMedia unavailable');
        const stream = await openCameraStream({ facingMode: 'environment', width: 960, height: 720 });
        const label = stream.getVideoTracks()[0]?.label || 'rear camera';
        app.setPermission(
          'camera',
          caps.native ? SENSOR_STATES.NATIVE : SENSOR_STATES.WEB,
          `${label} · ${caps.secureContext ? 'secure context' : 'insecure origin'}`
        );
        closeStream(stream); // probe only — the module opens its own stream
        app.toast('Camera granted — probe closed', 'ok');
      } else if (kind === 'lux') {
        const bridge = createSensorBridge({ altitudeM: app.solar.altitudeM });
        const state = await bridge.start();
        app.setPermission(
          'lux',
          state.backend,
          `${state.source} · ${state.lux ? Math.round(state.lux).toLocaleString() : '—'} lx`
        );
        bridge.stop();
        app.toast(`Ambient sensors → ${state.backend}`, state.backend === SENSOR_STATES.RESTRICTED ? 'warn' : 'ok');
      } else if (kind === 'haptic') {
        await triggerHaptics('tap');
        app.setPermission('haptic', SENSOR_STATES.WEB, 'Actuator probed with a tap pattern');
        app.toast('Haptics probed', 'ok');
      } else if (kind === 'vault') {
        const info = await app.initVault();
        app.setPermission(
          'vault',
          info?.storageMode === 'indexeddb' ? SENSOR_STATES.WEB : SENSOR_STATES.RESTRICTED,
          info?.storageMode === 'indexeddb'
            ? 'IndexedDB encrypted store ready'
            : 'In-memory fallback — nothing persists'
        );
        app.toast('Vault storage re-probed', 'info');
      }
    } catch (err) {
      app.setPermission(kind, SENSOR_STATES.RESTRICTED, String(err.message ?? err));
      app.toast(`${kind} blocked — simulator retained`, 'warn');
    }
  }

  function simulate(kind) {
    app.setPermission(kind, SENSOR_STATES.SIM, 'Deterministic synthetic source');
    app.toast(`${kind} → simulator`, 'info');
  }
</script>

<div class="drawer">
  <section class="block">
    <h4 class="block-title"><Icon name="shield" size={15} /> Privilege tier</h4>
    <p class="block-sub">
      RBAC is enforced in the module host: gated modules render a privilege panel
      instead of their engine when the tier is insufficient.
    </p>

    <div class="tiers">
      {#each ROLES as r}
        <button
          class="tier"
          class:active={r.id === role}
          data-tone={r.tone}
          onclick={() => {
            app.setRole(r.id);
            app.toast(`Tier → ${r.short}`, 'ok');
          }}
        >
          <span class="tier-top">
            <span class="tier-name">{r.short}</span>
            <span class="tier-badge">{r.tier}</span>
          </span>
          <span class="tier-label">{r.label}</span>
          <ul class="unlocks">
            {#each r.unlocks as u}
              <li><Icon name="check" size={11} /> {u}</li>
            {/each}
          </ul>
          {#if r.id === role}
            <span class="current"><Icon name="star" size={11} /> ACTIVE TIER</span>
          {/if}
        </button>
      {/each}
    </div>
  </section>

  <section class="block">
    <h4 class="block-title"><Icon name="cpu" size={15} /> Sensor permission matrix</h4>
    <p class="block-sub">
      Every capability degrades to a deterministic simulator rather than failing —
      a beach with no camera still gets a valid dosimetry reading.
    </p>

    <div class="matrix">
      <div class="mhead mono">
        <span>CAPABILITY</span><span>BACKEND</span><span>TECH</span><span></span>
      </div>
      {#each PERMISSIONS as p}
        {@const row = perms[p.id] ?? { state: 'RESTRICTED', detail: '' }}
        <div class="mrow">
          <div class="cap">
            <span class="cap-name">{p.label}</span>
            <span class="cap-detail">{row.detail || p.detail}</span>
            <span class="cap-risk mono">RISK · {p.risk}</span>
          </div>
          <div class="backend">
            <span class="pill" data-tone={backendTone[row.state] ?? 'accent'}>{row.state}</span>
          </div>
          <div class="tech mono">{p.tech}</div>
          <div class="acts">
            <button class="mini" onclick={() => request(p.id)}>
              <Icon name="target" size={12} /> Request
            </button>
            <button class="mini ghost" onclick={() => simulate(p.id)}>
              <Icon name="flask" size={12} /> Simulate
            </button>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section class="block runtime">
    <h4 class="block-title"><Icon name="terminal" size={15} /> Runtime</h4>
    <div class="runtime-grid">
      <div><span>Origin</span><code>{originLabel}</code></div>
      <div><span>User agent</span><code>{typeof navigator !== 'undefined' ? navigator.platform || 'unknown' : 'ssr'}</code></div>
      <div><span>Storage</span><code>{app.vaultState.storageMode ?? 'probing'}</code></div>
      <div><span>GPU mode</span><code>{app.gpuMode}</code></div>
      <div><span>Reduced motion</span><code>{app.reducedMotion ? 'yes' : 'no'}</code></div>
      <div><span>Offline</span><code>{typeof navigator !== 'undefined' && navigator.onLine === false ? 'yes' : 'no'}</code></div>
    </div>
    <div class="runtime-actions">
      <button class="mini" onclick={() => app.setGpu(app.gpuMode === 'low' ? 'high' : 'low')}>
        <Icon name="bolt" size={12} /> Toggle GPU tier
      </button>
      <button class="mini ghost" onclick={() => app.openModal('vault')}>
        <Icon name="vault" size={12} /> Open vault
      </button>
      <button class="mini ghost" onclick={() => app.openModal('apk')}>
        <Icon name="android" size={12} /> APK centre
      </button>
    </div>
  </section>
</div>

<style>
  .drawer {
    display: flex;
    flex-direction: column;
    gap: 1.3rem;
  }

  .block-title {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0 0 0.25rem;
    font-size: 0.82rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink);
  }

  .block-sub {
    margin: 0 0 0.85rem;
    font-size: 0.76rem;
    line-height: 1.55;
    color: var(--ink-muted);
    max-width: 78ch;
  }

  /* ------------------------------------------------------------------- tiers */
  .tiers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(212px, 1fr));
    gap: 0.6rem;
  }

  .tier {
    position: relative;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.8rem;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: var(--surface-3);
    color: var(--ink);
    cursor: pointer;
    transition: 160ms ease;
  }

  .tier:hover {
    border-color: var(--line-strong);
    transform: translateY(-1px);
  }

  .tier.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--surface-3));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 34%, transparent);
  }

  .tier[data-tone='violet'].active {
    border-color: var(--violet);
  }

  .tier[data-tone='gold'].active {
    border-color: var(--gold);
  }

  .tier-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem;
  }

  .tier-name {
    font-weight: 650;
    font-size: 0.9rem;
  }

  .tier-badge {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    padding: 0.1rem 0.35rem;
    border-radius: 5px;
    background: var(--surface-2);
    color: var(--ink-muted);
  }

  .tier-label {
    font-size: 0.7rem;
    color: var(--ink-muted);
    line-height: 1.35;
  }

  .unlocks {
    list-style: none;
    margin: 0.2rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .unlocks li {
    display: flex;
    gap: 0.3rem;
    align-items: flex-start;
    font-size: 0.68rem;
    color: var(--ink-muted);
    line-height: 1.4;
  }

  .unlocks :global(svg) {
    flex: none;
    color: var(--ok);
    margin-top: 2px;
  }

  .current {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--font-mono);
    font-size: 0.58rem;
    letter-spacing: 0.14em;
    color: var(--accent);
  }

  /* ------------------------------------------------------------------ matrix */
  .matrix {
    display: flex;
    flex-direction: column;
    border-radius: 14px;
    border: 1px solid var(--line);
    overflow: hidden;
  }

  .mhead,
  .mrow {
    display: grid;
    grid-template-columns: minmax(190px, 1.5fr) 140px minmax(150px, 1.1fr) 150px;
    gap: 0.7rem;
    padding: 0.65rem 0.8rem;
    align-items: center;
  }

  .mhead {
    font-size: 0.58rem;
    letter-spacing: 0.14em;
    color: var(--ink-muted);
    background: var(--surface-2);
    border-bottom: 1px solid var(--line);
  }

  .mrow {
    border-bottom: 1px solid var(--line);
  }

  .mrow:last-child {
    border-bottom: none;
  }

  .cap {
    display: flex;
    flex-direction: column;
    gap: 0.12rem;
  }

  .cap-name {
    font-size: 0.78rem;
    font-weight: 600;
  }

  .cap-detail {
    font-size: 0.68rem;
    color: var(--ink-muted);
    line-height: 1.4;
  }

  .cap-risk {
    font-size: 0.58rem;
    letter-spacing: 0.1em;
    color: var(--ink-faint);
  }

  .pill {
    display: inline-block;
    padding: 0.16rem 0.45rem;
    border-radius: 999px;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }

  .pill[data-tone='ok'] {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 15%, transparent);
  }
  .pill[data-tone='accent'] {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .pill[data-tone='warn'] {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 15%, transparent);
  }
  .pill[data-tone='danger'] {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 15%, transparent);
  }

  .tech {
    font-size: 0.62rem;
    color: var(--ink-faint);
    line-height: 1.45;
  }

  .acts {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .mini {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    padding: 0.32rem 0.5rem;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink-muted);
    font-size: 0.66rem;
    cursor: pointer;
    transition: 140ms ease;
    white-space: nowrap;
  }

  .mini:hover {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .mini.ghost {
    background: transparent;
  }

  /* ----------------------------------------------------------------- runtime */
  .runtime-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .runtime-grid > div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem 0.6rem;
    border-radius: 10px;
    background: var(--surface-3);
    border: 1px solid var(--line);
  }

  .runtime-grid span {
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }

  .runtime-grid code {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--ink);
    overflow-wrap: anywhere;
  }

  .runtime-actions {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  @media (max-width: 760px) {
    .mhead { display: none; }
    .mrow {
      grid-template-columns: 1fr;
      gap: 0.4rem;
    }
    .acts { justify-content: flex-start; }
  }
</style>
