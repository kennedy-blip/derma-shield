<script>
  /**
   * Depth-push modal host.
   *
   * One component owns every dialog so that z-index, scrim, focus trapping and
   * the "shell recedes" animation stay consistent. Children are mounted lazily:
   * the APK centre probes the network, the vault asks for a PIN — neither should
   * do work until the operator actually opens it.
   */
  import { onDestroy } from 'svelte';
  import { app } from '$lib/db/store.svelte.js';
  import PrivilegeDrawer from './PrivilegeDrawer.svelte';
  import ApkCenter from './ApkCenter.svelte';
  import ReportModal from './ReportModal.svelte';
  import VaultModal from './VaultModal.svelte';
  import Icon from '../ui/Icon.svelte';

  const REGISTRY = {
    privileges: { title: 'Privileges & Runtime', sub: 'RBAC tiers · sensor permission matrix', icon: 'shield', component: PrivilegeDrawer },
    apk: { title: 'Android Release Centre', sub: 'Self-hosted APK · QR install', icon: 'android', component: ApkCenter },
    report: { title: 'Clinical Report', sub: 'Export the current session', icon: 'export', component: ReportModal },
    vault: { title: 'Biometric Vault', sub: 'PIN-locked lesion ledger', icon: 'vault', component: VaultModal }
  };

  const open = $derived(app.modal.id !== null);
  const meta = $derived(app.modal.id ? REGISTRY[app.modal.id] ?? null : null);
  const Component = $derived(meta?.component ?? null);

  let panel = $state(null);

  // Modal payloads are read once at open time; children receive a stable prop.
  const payload = $derived(app.modal.payload);

  function onKey(ev) {
    if (ev.key === 'Escape' && open) {
      ev.stopPropagation();
      app.closeModal();
    }
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Lock body scroll without shifting layout (compensate scrollbar).
  $effect(() => {
    if (typeof document === 'undefined') return;
    if (open) {
      const gap = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      document.body.style.paddingRight = gap > 0 ? `${gap}px` : '';
      panel?.focus?.();
    } else {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') document.body.style.overflow = '';
  });
</script>

{#if open && meta}
  <div class="scrim" role="presentation" onclick={() => app.closeModal()}></div>
  <div
    class="host"
    role="dialog"
    aria-modal="true"
    aria-label={meta.title}
    tabindex="-1"
    bind:this={panel}
  >
    <div class="frame glass">
      <header class="frame-head">
        <span class="ficon"><Icon name={meta.icon} size={17} /></span>
        <div class="ftitles">
          <h3>{meta.title}</h3>
          <p>{meta.sub}</p>
        </div>
        <button class="close" onclick={() => app.closeModal()} aria-label="Close dialog">
          <Icon name="close" size={16} />
        </button>
      </header>
      <div class="frame-body">
        <Component {payload} />
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 900;
    background: var(--scrim);
    backdrop-filter: blur(6px) saturate(120%);
    -webkit-backdrop-filter: blur(6px) saturate(120%);
    animation: fade 220ms ease both;
  }

  .host {
    position: fixed;
    inset: 0;
    z-index: 901;
    display: grid;
    place-items: center;
    padding: clamp(0.6rem, 3vw, 2.2rem);
    outline: none;
    animation: push-in 320ms cubic-bezier(0.2, 0.9, 0.2, 1) both;
  }

  .frame {
    width: min(940px, 100%);
    max-height: min(88vh, 900px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 22px;
    box-shadow:
      0 40px 120px -40px rgba(0, 0, 0, 0.9),
      0 0 0 1px color-mix(in srgb, var(--accent) 26%, transparent),
      0 0 90px -50px var(--accent-glow);
    transform: translateZ(0);
  }

  .frame-head {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 1rem 1.1rem;
    border-bottom: 1px solid var(--line);
    background: linear-gradient(120deg, var(--surface-2), transparent 70%);
  }

  .ficon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 11px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .ftitles h3 {
    margin: 0;
    font-size: 1rem;
    letter-spacing: -0.01em;
  }

  .ftitles p {
    margin: 0.1rem 0 0;
    font-size: 0.7rem;
    color: var(--ink-muted);
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
  }

  .close {
    margin-left: auto;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink-muted);
    cursor: pointer;
    transition: 150ms ease;
  }

  .close:hover {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 50%, transparent);
  }

  .frame-body {
    padding: 1.1rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  @keyframes fade {
    from { opacity: 0; }
  }

  @keyframes push-in {
    from {
      opacity: 0;
      transform: translateY(18px) scale(0.97);
    }
  }

  @media (max-width: 640px) {
    .frame {
      max-height: 92vh;
      border-radius: 18px;
    }
    .frame-body { padding: 0.85rem; }
  }

  @media (prefers-reduced-motion: reduce) {
    .host, .scrim { animation: none; }
  }
</style>
