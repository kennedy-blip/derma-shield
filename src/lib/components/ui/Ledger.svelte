<script>
  /**
   * Compact key/value readout list used across every module's "engine output"
   * column. Values can carry a tone for clinical grading.
   */
  let { rows = [], dense = false } = $props();
</script>

<dl class="ledger" class:dense>
  {#each rows as row}
    <div class="kv">
      <dt>
        {row.label}
        {#if row.hint}<span class="hint" title={row.hint}>ⓘ</span>{/if}
      </dt>
      <dd class="mono" data-tone={row.tone ?? 'default'}>
        {row.value}
        {#if row.unit}<span class="u">{row.unit}</span>{/if}
      </dd>
    </div>
  {/each}
</dl>

<style>
  .ledger {
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  .dense :global(.kv) {
    padding: 5px 0;
  }
  dt {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .hint {
    font-size: 9px;
    color: var(--ink-faint);
    cursor: help;
  }
  .u {
    font-size: 9.5px;
    color: var(--ink-faint);
    margin-left: 3px;
    letter-spacing: 0.04em;
  }
  dd[data-tone='ok'] {
    color: var(--ok);
  }
  dd[data-tone='warn'] {
    color: var(--warn);
  }
  dd[data-tone='danger'] {
    color: var(--danger);
  }
  dd[data-tone='violet'] {
    color: var(--violet);
  }
  dd[data-tone='gold'] {
    color: var(--gold);
  }
</style>
