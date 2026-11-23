<script>
  /**
   * Toast queue renderer.
   *
   * Sits above the dock, below modals. Toasts are aria-live so screen readers
   * announce clinical alarms (SPF reapply, MED threshold) exactly once.
   */
  import { app } from '$lib/db/store.svelte.js';
  import Icon from '../ui/Icon.svelte';
  import { fly } from 'svelte/transition';

  const ICONS = {
    ok: 'check',
    info: 'info',
    warn: 'alert',
    danger: 'alert',
    accent: 'sparkle'
  };
</script>

<div class="toast-host" aria-live="polite" aria-atomic="false">
  {#each app.toasts as t (t.id)}
    <div
      class="toast glass"
      data-tone={t.tone}
      in:fly={{ y: 14, duration: 220 }}
      out:fly={{ y: 8, duration: 160 }}
    >
      <span class="ticon"><Icon name={ICONS[t.tone] ?? 'info'} size={14} /></span>
      <span class="msg">{t.message}</span>
      <button class="x" onclick={() => app.dismissToast(t.id)} aria-label="Dismiss">
        <Icon name="close" size={12} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-host {
    position: fixed;
    bottom: calc(96px + env(safe-area-inset-bottom, 0px));
    left: 50%;
    transform: translateX(-50%);
    z-index: 800;
    display: flex;
    flex-direction: column-reverse;
    align-items: center;
    gap: 0.4rem;
    pointer-events: none;
    width: min(520px, calc(100vw - 2rem));
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.7rem;
    border-radius: 12px;
    font-size: 0.76rem;
    width: fit-content;
    max-width: 100%;
    box-shadow: 0 16px 40px -22px rgba(0, 0, 0, 0.9);
    border: 1px solid var(--line);
  }

  .ticon {
    display: grid;
    place-items: center;
    flex: none;
  }

  .toast[data-tone='ok'] .ticon { color: var(--ok); }
  .toast[data-tone='info'] .ticon { color: var(--accent); }
  .toast[data-tone='warn'] .ticon { color: var(--warn); }
  .toast[data-tone='danger'] .ticon { color: var(--danger); }
  .toast[data-tone='accent'] .ticon { color: var(--accent-2); }

  .toast[data-tone='ok'] { border-color: color-mix(in srgb, var(--ok) 34%, var(--line)); }
  .toast[data-tone='warn'] { border-color: color-mix(in srgb, var(--warn) 34%, var(--line)); }
  .toast[data-tone='danger'] { border-color: color-mix(in srgb, var(--danger) 40%, var(--line)); }

  .msg {
    line-height: 1.4;
  }

  .x {
    margin-left: 0.2rem;
    background: none;
    border: none;
    color: var(--ink-muted);
    cursor: pointer;
    display: grid;
    place-items: center;
    padding: 0.1rem;
  }

  .x:hover {
    color: var(--ink);
  }

  @media (max-width: 620px) {
    .toast-host {
      bottom: calc(88px + env(safe-area-inset-bottom, 0px));
    }
  }
</style>
