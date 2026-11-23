<script>
  /**
   * Global glass header: brand, live solar vitals, role switcher, theme menu,
   * form-factor toggle and the glowing APK button.
   */
  import { app, ROLES } from '$lib/db/store.svelte.js';
  import Icon from '../ui/Icon.svelte';
  import ThemeMenu from './ThemeMenu.svelte';
  import { spring } from 'svelte/motion';

  let { onApk = () => {}, onPrivileges = () => {}, onReport = () => {}, onVault = () => {} } = $props();

  const uvi = $derived(app.solar.uvIndex);
  const band = $derived(
    uvi >= 11 ? 'EXTREME' : uvi >= 8 ? 'VERY HIGH' : uvi >= 6 ? 'HIGH' : uvi >= 3 ? 'MODERATE' : uvi > 0 ? 'LOW' : 'NONE'
  );
  const bandTone = $derived(uvi >= 8 ? 'danger' : uvi >= 3 ? 'warn' : 'ok');

  let roleOpen = $state(false);
  let roleWrap = $state(null);
  const roleScale = spring(1, { stiffness: 0.2, damping: 0.6 });

  $effect(() => {
    roleScale.set(roleOpen ? 1 : 0.98);
  });

  function onDocClick(ev) {
    if (roleOpen && roleWrap && !roleWrap.contains(ev.target)) roleOpen = false;
  }
  $effect(() => {
    document.addEventListener('pointerdown', onDocClick);
    return () => document.removeEventListener('pointerdown', onDocClick);
  });
</script>

<header class="topbar">
  <div class="inner">
    <!-- BRAND -->
    <a href="/" class="brand" aria-label="DERMA-SHIELD home">
      <span class="mark" aria-hidden="true">
        <span class="ring r1"></span>
        <span class="ring r2"></span>
        <span class="core"></span>
      </span>
      <span class="brand-txt">
        <strong>DERMA<span class="thin">·</span>SHIELD</strong>
        <em class="hide-mobile">Photobiology Optics Station</em>
      </span>
    </a>

    <!-- LIVE VITALS -->
    <div class="vitals hide-mobile" aria-label="Live solar vitals">
      <div class="vital">
        <span class="vlabel">UVI</span>
        <span class="vval mono">{uvi.toFixed(1)}</span>
        <span class="pill {bandTone}" style="padding:2px 6px">{band}</span>
      </div>
      <div class="vital">
        <span class="vlabel">ITA°</span>
        <span class="vval mono">{app.scan.ita.toFixed(1)}</span>
        <span class="pill">TYPE {app.phototype.type}</span>
      </div>
      <div class="vital">
        <span class="vlabel">EI</span>
        <span class="vval mono">{app.scan.erythemaIndex.toFixed(1)}</span>
        <span class="pill {app.scan.erythemaIndex > 35 ? 'danger' : app.scan.erythemaIndex > 30 ? 'warn' : 'ok'}">
          {app.scan.erythemaIndex > 35 ? 'SUBCLINICAL' : app.scan.erythemaIndex > 30 ? 'ELEVATED' : 'CALM'}
        </span>
      </div>
      <div class="vital hide-mobile">
        <span class="vlabel">MED</span>
        <span class="vval mono">{app.med.toFixed(0)}</span>
        <span class="unit">J/m²</span>
      </div>
    </div>

    <!-- ACTIONS -->
    <div class="actions">
      <!-- RBAC role switcher -->
      <div class="role-wrap" bind:this={roleWrap}>
        <button
          class="role-btn"
          onclick={() => (roleOpen = !roleOpen)}
          aria-expanded={roleOpen}
          aria-haspopup="menu"
          style="transform:scale({$roleScale})"
        >
          <span class="role-dot" data-tier={app.roleMeta.tier}></span>
          <span class="role-txt">
            <em class="hide-mobile">Access</em>
            <strong>{app.roleMeta.short}</strong>
          </span>
          <Icon name="chevronDown" size={12} />
        </button>
        {#if roleOpen}
          <div class="role-menu glass" role="menu">
            <div class="eyebrow" style="margin:2px 0 8px">Privilege tier</div>
            {#each ROLES as r}
              <button
                class="role-opt"
                class:active={app.role === r.id}
                role="menuitemradio"
                aria-checked={app.role === r.id}
                onclick={() => {
                  app.setRole(r.id);
                  roleOpen = false;
                }}
              >
                <span class="tier-chip" data-tier={r.tier}>{r.tier}</span>
                <span class="role-txt2">
                  <strong>{r.label}</strong>
                  <em>{r.unlocks.length} capabilities</em>
                </span>
                {#if app.role === r.id}<Icon name="check" size={14} />{/if}
              </button>
            {/each}
            <hr class="divider" />
            <button class="link-row" onclick={() => { roleOpen = false; onPrivileges(); }}>
              <Icon name="shield" size={14} /> Privileges &amp; runtime matrix
              <Icon name="chevronRight" size={13} />
            </button>
          </div>
        {/if}
      </div>

      <ThemeMenu />

      <button class="icon-btn" title="Dermatological optics report" onclick={onReport} aria-label="Open report">
        <Icon name="graph" size={16} />
      </button>

      <button
        class="icon-btn"
        title="PIN-locked biometric lesion vault"
        onclick={onVault}
        aria-label="Open vault"
      >
        <Icon name="vault" size={16} />
        {#if !app.vaultState.unlocked}<span class="locked-dot" aria-hidden="true"></span>{/if}
      </button>

      <button class="icon-btn hide-mobile" title="Privileges & sensor matrix" onclick={onPrivileges} aria-label="Privileges">
        <Icon name="shield" size={16} />
      </button>

      <!-- FORM FACTOR -->
      <div class="ff hide-mobile" role="group" aria-label="Form factor">
        <button
          aria-pressed={app.formFactor !== 'mobile'}
          onclick={() => app.setFormFactor('desktop')}
          title="Desktop clinical station"
        >Station</button>
        <button
          aria-pressed={app.formFactor === 'mobile'}
          onclick={() => app.setFormFactor('mobile')}
          title="Mobile field APK preview"
        >Field</button>
      </div>

      <button class="apk-btn" onclick={onApk} title="Download the Android .APK">
        <Icon name="android" size={16} />
        <span class="hide-mobile">Download .APK</span>
      </button>
    </div>
  </div>
</header>

<style>
  .locked-dot {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--warn);
    box-shadow: 0 0 6px var(--warn);
  }
  .topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
    padding: calc(8px + var(--safe-top)) 12px 8px;
    background: color-mix(in srgb, var(--bg-void) 58%, transparent);
    backdrop-filter: blur(18px) saturate(160%);
    -webkit-backdrop-filter: blur(18px) saturate(160%);
    border-bottom: 1px solid var(--glass-line-soft);
  }
  :global(html[data-gpu='low']) .topbar,
  :global(html[data-theme='eco']) .topbar {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: var(--bg-void);
  }
  .inner {
    width: min(1720px, 100%);
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  /* brand */
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    flex: none;
  }
  .mark {
    position: relative;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    flex: none;
  }
  .ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1.4px solid color-mix(in srgb, var(--accent) 60%, transparent);
    animation: spin 22s linear infinite;
  }
  .r1 {
    border-style: dashed;
    border-color: color-mix(in srgb, var(--accent) 42%, transparent);
  }
  .r2 {
    inset: 4px;
    animation-direction: reverse;
    animation-duration: 14s;
    border-color: color-mix(in srgb, var(--gold) 52%, transparent);
  }
  .core {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: radial-gradient(circle at 34% 30%, #fff, var(--accent) 55%, var(--accent-2));
    box-shadow: 0 0 16px color-mix(in srgb, var(--accent) 85%, transparent);
  }
  .brand-txt {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }
  .brand-txt strong {
    font-size: 13.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--ink-strong);
  }
  .thin {
    color: var(--accent);
    font-weight: 400;
  }
  .brand-txt em {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  /* vitals */
  .vitals {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    justify-content: center;
    min-width: 0;
    overflow: hidden;
  }
  .vital {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: var(--r-pill);
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    flex: none;
  }
  .vlabel {
    font-family: var(--font-mono);
    font-size: 8.5px;
    letter-spacing: 0.1em;
    color: var(--ink-faint);
  }
  .vval {
    font-size: 12px;
    font-weight: 620;
    color: var(--ink-strong);
    font-variant-numeric: tabular-nums;
  }
  .vital .unit {
    font-size: 8px;
    color: var(--ink-faint);
  }
  /* actions */
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  .role-wrap {
    position: relative;
  }
  .role-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 9px;
    height: 34px;
    border-radius: var(--r-pill);
    border: 1px solid var(--glass-line);
    background: var(--glass-bg-soft);
    color: var(--ink);
    transition: 220ms;
    will-change: transform;
  }
  .role-btn:hover {
    border-color: color-mix(in srgb, var(--accent) 44%, transparent);
  }
  .role-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    box-shadow: 0 0 9px currentColor;
  }
  .role-dot[data-tier='Standard'] {
    background: var(--teal);
    color: var(--teal);
  }
  .role-dot[data-tier='Pro'] {
    background: var(--violet);
    color: var(--violet);
  }
  .role-dot[data-tier='Admin'] {
    background: var(--gold);
    color: var(--gold);
  }
  .role-txt {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
    text-align: left;
  }
  .role-txt em {
    font-style: normal;
    font-size: 7.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-faint);
    font-family: var(--font-mono);
  }
  .role-txt strong {
    font-size: 11.5px;
    font-weight: 600;
  }
  .role-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    width: 340px;
    padding: 12px;
    z-index: 80;
    animation: drop 300ms var(--ease-spring);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.97);
    }
  }
  .role-opt {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 8px;
    border-radius: 11px;
    text-align: left;
    border: 1px solid transparent;
    transition: 200ms;
  }
  .role-opt:hover {
    background: var(--glass-bg-soft);
  }
  .role-opt.active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent) 32%, transparent);
  }
  .tier-chip {
    font-family: var(--font-mono);
    font-size: 8.5px;
    letter-spacing: 0.08em;
    padding: 3px 6px;
    border-radius: 5px;
    border: 1px solid var(--glass-line);
    flex: none;
    text-transform: uppercase;
  }
  .tier-chip[data-tier='Standard'] { color: var(--teal); }
  .tier-chip[data-tier='Pro'] { color: var(--violet); }
  .tier-chip[data-tier='Admin'] { color: var(--gold); }
  .role-txt2 {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .role-txt2 strong {
    font-size: 11.5px;
    font-weight: 580;
    line-height: 1.3;
  }
  .role-txt2 em {
    font-style: normal;
    font-size: 9.5px;
    color: var(--ink-faint);
  }
  .link-row {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 7px 6px 3px;
    font-size: 11px;
    color: var(--ink-muted);
    transition: color 200ms;
  }
  .link-row:hover {
    color: var(--accent);
  }
  .link-row :global(svg:last-child) {
    margin-left: auto;
  }
  .ff {
    display: flex;
    padding: 2px;
    border-radius: var(--r-pill);
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
  }
  .ff button {
    padding: 5px 9px;
    border-radius: var(--r-pill);
    font-size: 10.5px;
    color: var(--ink-faint);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
    transition: 200ms;
  }
  .ff button[aria-pressed='true'] {
    color: var(--ink-strong);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .apk-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 34px;
    padding: 0 13px;
    border-radius: var(--r-pill);
    background: linear-gradient(124deg, var(--gold), color-mix(in srgb, var(--rose) 55%, var(--gold)));
    color: #1a1204;
    font-size: 11.5px;
    font-weight: 680;
    letter-spacing: 0.02em;
    box-shadow:
      0 8px 28px -12px color-mix(in srgb, var(--gold) 92%, transparent),
      inset 0 1px 1px rgba(255, 255, 255, 0.5);
    transition: 240ms var(--ease-spring);
    animation: apk-glow 4.5s ease-in-out infinite;
  }
  .apk-btn:hover {
    transform: translateY(-1px) scale(1.02);
  }
  .apk-btn:active {
    transform: scale(0.96);
  }
  @keyframes apk-glow {
    0%,
    100% {
      box-shadow: 0 8px 24px -12px color-mix(in srgb, var(--gold) 80%, transparent), inset 0 1px 1px rgba(255,255,255,.5);
    }
    50% {
      box-shadow: 0 10px 36px -10px color-mix(in srgb, var(--gold) 100%, transparent), inset 0 1px 1px rgba(255,255,255,.6);
    }
  }
  @media (max-width: 1200px) {
    .vitals {
      display: none;
    }
  }
</style>
