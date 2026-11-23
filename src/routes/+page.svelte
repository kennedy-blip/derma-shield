<script>
  /**
   * DERMA-SHIELD · single-page module host
   * ---------------------------------------------------------------------------
   * Deliberately one route: the five clinical modules swap in place so the WebGL
   * background, specular field and dock never remount (remounting the canvas was
   * the original source of dropped frames). `app.activeModule` is the only
   * router in the app.
   */
  import { app } from '$lib/db/store.svelte.js';
  import Header from '$lib/components/shell/Header.svelte';
  import Dock from '$lib/components/shell/Dock.svelte';
  import Hero from '$lib/components/shell/Hero.svelte';
  import ScatterField from '$lib/components/shell/ScatterField.svelte';
  import SpecularOverlay from '$lib/components/shell/SpecularOverlay.svelte';
  import ModalHost from '$lib/components/shell/ModalHost.svelte';
  import ToastHost from '$lib/components/shell/ToastHost.svelte';

  import SolarEngine from '$lib/components/modules/SolarEngine.svelte';
  import ChromophoreLab from '$lib/components/modules/ChromophoreLab.svelte';
  import AbcdCaliper from '$lib/components/modules/AbcdCaliper.svelte';
  import SunscreenAuditor from '$lib/components/modules/SunscreenAuditor.svelte';
  import RuntimeVault from '$lib/components/modules/RuntimeVault.svelte';

  const modules = [
    {
      id: 'solar',
      label: 'Solar UV & Vitamin D3',
      short: 'SOLAR',
      icon: 'M12 4v1.5M12 18.5V20M4 12h1.5M18.5 12H20M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'
    },
    {
      id: 'chromophore',
      label: 'Optical Chromophore Lab',
      short: 'OPTICS',
      icon: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'
    },
    {
      id: 'abcd',
      label: 'ABCDE Morphometry',
      short: 'ABCDE',
      icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
      gated: 'pro'
    },
    {
      id: 'sunscreen',
      label: 'Photostability Auditor',
      short: 'SPF',
      icon: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z'
    },
    {
      id: 'runtime',
      label: 'Polyglot Vault',
      short: 'VAULT',
      icon: 'M4 5h16v14H4zM7.5 9.5l2.5 2.5-2.5 2.5M12.5 15h4',
      gated: 'director'
    }
  ];

  // Which module shells exist. `gated` modules render a paywall/privilege panel.
  const SECTIONS = {
    solar: SolarEngine,
    chromophore: ChromophoreLab,
    abcd: AbcdCaliper,
    sunscreen: SunscreenAuditor,
    runtime: RuntimeVault
  };

  const active = $derived(modules.find((m) => m.id === app.activeModule) ?? modules[0]);
  const Section = $derived(SECTIONS[app.activeModule] ?? SolarEngine);
  const blocked = $derived(
    (active.gated === 'pro' && !app.isPro) ||
      (active.gated === 'director' && !app.isDirector)
  );

  let mounted = $state(false);
  $effect(() => {
    mounted = true;
  });
</script>

<ScatterField />
<SpecularOverlay />

<Header
  onApk={() => app.openModal('apk')}
  onPrivileges={() => app.openModal('privileges')}
  onReport={() => app.openModal('report')}
  onVault={() => app.openModal('vault')}
/>

<div class="shell" class:depth-pushed={app.modal.id !== null}>
  <main class="page">
    <Hero onModule={(m) => app.setModule(m)} onReport={() => app.openModal('report')} />

    {#if mounted}
      {#if blocked}
        <section class="glass panel-pad gate">
          <span class="eyebrow">PRIVILEGE GATE · {active.gated.toUpperCase()}</span>
          <h2>{active.label}</h2>
          <p>
            This module is locked behind the
            <strong>{active.gated === 'pro' ? 'Pro Clinician' : 'Director'}</strong>
            privilege tier. Elevate your role to continue.
          </p>
          <div class="gate-actions">
            <button class="btn primary" onclick={() => app.openModal('privileges')}>
              Open privileges drawer
            </button>
            <button
              class="btn"
              onclick={() =>
                app.setRole(active.gated === 'pro' ? 'pro' : 'director')}
            >
              Elevate to {active.gated === 'pro' ? 'Pro' : 'Director'}
            </button>
          </div>
        </section>
      {:else}
        <!-- key keeps per-module local state alive across switches only if needed;
             the modules rebuild cheaply and this guarantees a clean effect graph -->
        {#key app.activeModule}
          <Section />
        {/key}
      {/if}
    {/if}
  </main>
</div>

<Dock {modules} onApk={() => app.openModal('apk')} />

<ModalHost />
<ToastHost />

<style>
  .gate {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.7rem;
    min-height: 260px;
    justify-content: center;
  }

  .gate h2 {
    margin: 0;
    font-size: 1.4rem;
  }

  .gate p {
    margin: 0;
    max-width: 62ch;
    color: var(--ink-muted);
    font-size: 0.86rem;
    line-height: 1.6;
  }

  .eyebrow {
    font-family: var(--font-mono);
    font-size: 0.64rem;
    letter-spacing: 0.22em;
    color: var(--accent);
  }

  .gate-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.4rem;
  }

  .btn {
    padding: 0.55rem 0.9rem;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink);
    font-size: 0.78rem;
    cursor: pointer;
  }

  .btn.primary {
    border-color: color-mix(in oklab, var(--accent) 55%, transparent);
    background: color-mix(in oklab, var(--accent) 16%, var(--surface-2));
    color: var(--accent);
  }
</style>
