<script>
  /**
   * Biometric vault quick-access dialog.
   *
   * A compact version of Module 05's vault tab, reachable from the header at any
   * time (e.g. mid-ABCDE analysis when a record needs archiving). It shares the
   * same singleton vault + store state, so unlocking here unlocks the module.
   */
  import { app } from '$lib/db/store.svelte.js';
  import Icon from '../ui/Icon.svelte';
  import Ledger from '../ui/Ledger.svelte';
  import { fmtInt, fmtWhen } from '../ui/Stat.js';
  import { STORES, downloadText } from '$lib/db/vault.js';

  let pin = $state('');
  let error = $state('');
  let busy = $state(false);
  let records = $state([]);

  const state = $derived(app.vaultState);
  const unlocked = $derived(state.unlocked);

  $effect(() => {
    if (!state.ready) app.initVault();
  });

  async function unlock() {
    error = '';
    busy = true;
    try {
      await app.vault.unlock(pin);
      app.setVault({ unlocked: true, enrolled: true, error: null });
      pin = '';
      await load();
      app.toast('Vault unlocked', 'ok');
    } catch (err) {
      error = String(err.message ?? err);
    } finally {
      busy = false;
    }
  }

  async function load() {
    if (!app.vault) return;
    try {
      records = await app.vault.secureList(STORES.LESIONS, { limit: 20 });
    } catch (err) {
      error = String(err.message ?? err);
    }
  }

  async function archiveLesion() {
    const result = app.lesion?.result;
    if (!result) {
      error = 'Run an ABCDE analysis first';
      return;
    }
    busy = true;
    try {
      await app.vault.securePut(STORES.LESIONS, {
        kind: 'abcd-morphometry',
        A: result.A,
        B: result.B,
        C: result.C,
        D: result.D,
        E: result.E,
        risk: result.risk,
        summary: {
          label: `${result.D?.maxMm?.toFixed?.(1) ?? '—'} mm · ${result.risk?.label ?? '—'}`,
          diameterMm: result.D?.maxMm ?? null,
          risk: result.risk?.label ?? null
        }
      });
      await load();
      await app.initVault();
      app.toast('Lesion archived', 'ok');
    } catch (err) {
      error = String(err.message ?? err);
    } finally {
      busy = false;
    }
  }

  async function exportCsv() {
    if (!app.vault) return;
    if (!unlocked) {
      error = 'Unlock the vault to export';
      return;
    }
    busy = true;
    try {
      downloadText(
        `dermashield-lesions-${new Date().toISOString().slice(0, 10)}.csv`,
        await app.vault.exportCsv(),
        'text/csv'
      );
      app.toast('CSV exported', 'ok');
    } catch (err) {
      error = String(err.message ?? err);
    } finally {
      busy = false;
    }
  }

  const rows = $derived(
    records.slice(0, 10).map((r) => ({
      label: r.summary?.label ?? r.kind ?? r.id,
      value: fmtWhen(r.createdAt),
      unit: r.encrypted ? 'ENC' : 'PLAIN',
      tone: r.encrypted ? 'ok' : 'warn'
    }))
  );
</script>

<div class="vault-modal">
  {#if state.storageMode === 'memory'}
    <div class="banner warn">
      <Icon name="alert" size={14} />
      IndexedDB is unavailable in this context — records live in memory and vanish on reload.
    </div>
  {/if}

  {#if !unlocked}
    <div class="gate">
      <div class="lock-glyph"><Icon name="lock" size={30} /></div>
      <h4>{state.enrolled ? 'Unlock the lesion ledger' : 'Create a vault PIN'}</h4>
      <p>
        {state.enrolled
          ? 'Records are encrypted with a key derived from your PIN. Nothing is sent anywhere.'
          : 'Choose 4–8 digits. The PIN is never stored — only a PBKDF2 verifier.'}
      </p>

      <input
        class="pin mono"
        type="password"
        inputmode="numeric"
        maxlength="8"
        placeholder="••••"
        bind:value={pin}
        onkeydown={(e) => e.key === 'Enter' && pin.length >= 4 && unlock()}
      />

      {#if error}<p class="err"><Icon name="alert" size={12} /> {error}</p>{/if}

      <button class="btn primary" disabled={busy || pin.length < 4} onclick={unlock}>
        {#if busy}
          <Icon name="refresh" size={14} /> Working…
        {:else}
          <Icon name={state.enrolled ? 'unlock' : 'lock'} size={14} />
          {state.enrolled ? 'Unlock' : 'Create & unlock'}
        {/if}
      </button>
      <button class="link" onclick={() => app.openModal('privileges')}>
        Manage privileges &amp; runtime →
      </button>
    </div>
  {:else}
    <div class="unlocked">
      <div class="counts">
        {#each Object.entries(state.records ?? {}) as [name, count]}
          <div class="count">
            <span class="n mono">{fmtInt(count)}</span>
            <span class="l">{name}</span>
          </div>
        {/each}
      </div>

      {#if error}<p class="err"><Icon name="alert" size={12} /> {error}</p>{/if}

      <div class="actions">
        <button class="btn" onclick={archiveLesion} disabled={busy}>
          <Icon name="plus" size={14} /> Archive lesion
        </button>
        <button class="btn" onclick={load} disabled={busy}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
        <button class="btn" onclick={exportCsv} disabled={busy}>
          <Icon name="export" size={14} /> CSV
        </button>
        <button
          class="btn ghost"
          onclick={() => {
            app.vault.lock();
            app.setVault({ unlocked: false });
            records = [];
            pin = '';
          }}
        >
          <Icon name="lock" size={14} /> Lock
        </button>
      </div>

      {#if rows.length}
        <Ledger rows={rows} dense />
      {:else}
        <p class="empty">
          No lesion records yet. Run an ABCDE analysis, then archive it here.
        </p>
      {/if}

      <button class="link" onclick={() => app.openModal('report')}>
        Generate a full session report →
      </button>
    </div>
  {/if}
</div>

<style>
  .vault-modal {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .gate,
  .unlocked {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.65rem;
  }

  .unlocked {
    align-items: stretch;
  }

  .lock-glyph {
    display: grid;
    place-items: center;
    width: 58px;
    height: 58px;
    border-radius: 18px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  }

  h4 {
    margin: 0;
    font-size: 0.95rem;
  }

  .gate p {
    margin: 0;
    max-width: 42ch;
    text-align: center;
    font-size: 0.76rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }

  .pin {
    width: 160px;
    text-align: center;
    padding: 0.55rem;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface-3);
    color: var(--ink);
    letter-spacing: 0.45em;
    font-size: 1rem;
  }

  .pin:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .counts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(78px, 1fr));
    gap: 0.45rem;
  }

  .count {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    padding: 0.5rem;
    border-radius: 10px;
    background: var(--surface-3);
    border: 1px solid var(--line);
  }

  .count .n {
    font-size: 1.05rem;
    color: var(--accent);
  }

  .count .l {
    font-size: 0.58rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }

  .actions {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem 0.7rem;
    border-radius: 9px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink);
    font-size: 0.72rem;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.primary {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
    color: var(--accent);
  }

  .btn.ghost {
    background: transparent;
  }

  .link {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 0.7rem;
    cursor: pointer;
    text-decoration: underline;
    padding: 0.2rem;
  }

  .err {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin: 0;
    font-size: 0.72rem;
    color: var(--danger);
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.65rem;
    border-radius: 9px;
    font-size: 0.72rem;
    border: 1px solid color-mix(in srgb, var(--warn) 36%, transparent);
    color: var(--ink-muted);
  }

  .empty {
    margin: 0;
    font-size: 0.75rem;
    color: var(--ink-muted);
    text-align: center;
  }
</style>
