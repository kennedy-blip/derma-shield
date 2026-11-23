<script>
  /**
   * MODULE 4 · Sunscreen & Skincare Photostability Auditor
   *
   * 100 % offline INCI parser + 14-rule photochemistry pack over an 89-row
   * ingredient database. Emits a Photostability Score, projected 2 h film decay
   * and a prioritised finding list.
   */
  import { app } from '$lib/db/store.svelte.js';
  import Panel from '../ui/Panel.svelte';
  import Icon from '../ui/Icon.svelte';
  import Sparkline from '../ui/Sparkline.svelte';
  import Ledger from '../ui/Ledger.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import { auditIngredients, DATABASE_STATS, parseInciList } from '$lib/engines/sunscreen-auditor.js';
  import { PRODUCT_PRESETS, DEFAULT_INCI } from '$lib/data/product-presets.js';
  import { INGREDIENTS } from '$lib/data/ingredient-database.js';

  let text = $state(DEFAULT_INCI);
  let activePreset = $state('unstable-us');
  let result = $state(auditIngredients(DEFAULT_INCI, { spf: 30, activity: 'walk' }));
  let tab = $state('findings');
  let simSpf = $state('30');
  let simActivity = $state('walk');
  let search = $state('');

  const severityMeta = {
    critical: { tone: 'danger', icon: 'alert', label: 'CRITICAL' },
    warning: { tone: 'warn', icon: 'alert', label: 'WARNING' },
    info: { tone: '', icon: 'info', label: 'INFO' },
    good: { tone: 'ok', icon: 'check', label: 'GOOD' }
  };

  function analyse() {
    result = auditIngredients(text, { spf: Number(simSpf), activity: simActivity });
    activePreset = null;
  }

  function loadPreset(p) {
    text = p.inci;
    activePreset = p.id;
    result = auditIngredients(p.inci, { spf: Number(simSpf), activity: simActivity });
    app.toast(`Loaded preset · ${p.name}`, 'info');
  }

  $effect(() => {
    // re-run the engine when the simulation context changes
    void simSpf;
    void simActivity;
    result = auditIngredients(text, { spf: Number(simSpf), activity: simActivity });
  });

  const decaySeries = $derived([
    {
      label: 'Protection remaining %',
      color: 'var(--accent)',
      points: result.decay2h.map((d) => ({ x: d.t, y: d.protectionRemaining }))
    }
  ]);

  const filteredDb = $derived(
    INGREDIENTS.filter((i) => {
      const q = search.trim().toLowerCase();
      if (!q) return ['uva', 'uvb', 'broad', 'mineral'].includes(i.role);
      return (
        i.name.toLowerCase().includes(q) ||
        i.aliases.some((a) => a.includes(q)) ||
        i.role.includes(q)
      );
    }).slice(0, 14)
  );

  const ledger = $derived([
    { label: 'Ingredients parsed', value: `${result.counts.total}` },
    { label: 'Resolved against database', value: `${result.counts.matched}` },
    { label: 'UV filters detected', value: `${result.counts.filters}` },
    { label: 'UVA coverage', value: `${result.coverage.uva} %`, tone: result.coverage.uva < 45 ? 'warn' : 'ok' },
    { label: 'UVB coverage', value: `${result.coverage.uvb} %`, tone: result.coverage.uvb < 45 ? 'warn' : 'ok' },
    { label: 'Broad spectrum', value: result.coverage.broadSpectrum ? 'YES' : 'NO', tone: result.coverage.broadSpectrum ? 'ok' : 'danger' },
    { label: 'Photostabiliser present', value: result.coverage.stabilised ? 'YES' : 'NO', tone: result.coverage.stabilised ? 'ok' : 'warn' },
    { label: 'Worst filter t½', value: result.stability.worstPhotostability != null ? `×${result.stability.worstPhotostability.toFixed(2)}` : '—' },
    { label: 'Comedogenic load', value: `${result.comedogenicScore} / 5`, tone: result.comedogenicScore >= 4 ? 'danger' : result.comedogenicScore >= 2 ? 'warn' : 'ok' },
    { label: 'Reapply at', value: result.reapplyMinute != null ? `${result.reapplyMinute} min` : 'stable', tone: result.reapplyMinute != null && result.reapplyMinute < 60 ? 'warn' : 'ok' }
  ]);
</script>

<div class="grid g-main">
  <Panel
    title="Sunscreen & Skincare Photostability Auditor"
    sub={`Offline photochemistry engine · ${DATABASE_STATS.total} ingredients · 14 rules · zero network`}
    icon="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"
  >
    {#snippet actions()}
      <span class="pill accent">OFFLINE DB</span>
    {/snippet}

    <div class="presets">
      {#each PRODUCT_PRESETS as p}
        <button class="preset" class:active={activePreset === p.id} data-tone={p.tone} onclick={() => loadPreset(p)}>
          <span class="p-name">{p.name}</span>
          <span class="p-tag mono">{p.tagline}</span>
        </button>
      {/each}
    </div>

    <div class="input-wrap">
      <div class="input-head">
        <span class="label">INCI / ingredient list</span>
        <span class="mono tiny faint">{parseInciList(text).length} tokens</span>
      </div>
      <textarea bind:value={text} spellcheck="false" placeholder="Paste an INCI list — e.g. Avobenzone 3%, Octinoxate 7.5%, …"></textarea>
      <div class="input-actions">
        <button class="btn btn-primary btn-sm" onclick={analyse}><Icon name="flask" size={13} /> Audit formulation</button>
        <button class="btn btn-sm" onclick={() => { text = ''; analyse(); }}><Icon name="trash" size={13} /> Clear</button>
        <div class="sim">
          <Segmented
            size="sm"
            value={simSpf}
            onchange={(v) => (simSpf = v)}
            options={[{ id: '15', label: 'SPF 15' }, { id: '30', label: 'SPF 30' }, { id: '50', label: 'SPF 50' }]}
          />
          <Segmented
            size="sm"
            value={simActivity}
            onchange={(v) => (simActivity = v)}
            options={[{ id: 'rest', label: 'Rest' }, { id: 'walk', label: 'Walk' }, { id: 'swim', label: 'Swim' }]}
          />
        </div>
      </div>
    </div>

    <div class="result-head">
      <div class="grade" data-tone={result.grade.tone}>
        <strong>{result.grade.letter}</strong>
        <span>{result.score}</span>
      </div>
      <div class="result-meta">
        <strong>{result.grade.label}</strong>
        <p class="tiny muted">
          {activePreset
            ? PRODUCT_PRESETS.find((p) => p.id === activePreset)?.expected.summary
            : 'Scored from filter photostability, spectral breadth, formulation stability and photosensitisation rules.'}
        </p>
      </div>
      <div class="coverage-rings">
        <div class="ring" style="--pct:{result.coverage.uva}">
          <span>{result.coverage.uva}%</span><em>UVA</em>
        </div>
        <div class="ring" style="--pct:{result.coverage.uvb}">
          <span>{result.coverage.uvb}%</span><em>UVB</em>
        </div>
      </div>
    </div>

    <div class="tabs">
      <Segmented
        size="sm"
        value={tab}
        onchange={(v) => (tab = v)}
        options={[
          { id: 'findings', label: `Findings (${result.findings.length})` },
          { id: 'filters', label: `Filters (${result.filters.length})` },
          { id: 'decay', label: 'Film decay' },
          { id: 'database', label: 'Database' }
        ]}
      />
    </div>

    {#if tab === 'findings'}
      <div class="findings">
        {#if !result.findings.length}
          <div class="warn-strip ok"><Icon name="check" size={15} /> No rule violations — this formulation passes every photostability check.</div>
        {/if}
        {#each result.findings as f (f.id)}
          {@const meta = severityMeta[f.severity] ?? severityMeta.info}
          <article class="finding" data-tone={f.severity}>
            <header>
              <span class="f-icon" data-tone={meta.tone}><Icon name={meta.icon} size={13} /></span>
              <span class="f-id mono">{f.id}</span>
              <h4>{f.title}</h4>
              <span class="pill {meta.tone}">{meta.label}</span>
            </header>
            <p class="tiny">{f.detail}</p>
            {#if f.metrics && Object.keys(f.metrics).length}
              <div class="metrics">
                {#each Object.entries(f.metrics) as [k, v]}
                  <span class="metric"><em>{k}</em><strong class="mono">{v}</strong></span>
                {/each}
              </div>
            {/if}
            {#if f.tags?.length}
              <div class="chip-list">{#each f.tags as t}<span class="badge-sq">{t}</span>{/each}</div>
            {/if}
          </article>
        {/each}
      </div>
    {:else if tab === 'filters'}
      <div class="filter-list">
        {#each result.filters as f}
          <div class="frow">
            <div class="fname">
              <strong>{f.name.split(' (')[0]}</strong>
              <span class="mono tiny faint">{f.role.toUpperCase()} · λmax {f.uvPeakNm} nm</span>
            </div>
            <div class="fbar">
              <div class="meter"><i style="width:{f.uvCoverage * 100}%"></i></div>
              <span class="tiny mono">breadth {Math.round(f.uvCoverage * 100)}%</span>
            </div>
            <div class="fstability" data-tone={f.photostability < 0.4 ? 'danger' : f.photostability < 0.75 ? 'warn' : 'ok'}>
              {Math.round((f.photostability ?? 0) * 100)}<small>%</small>
            </div>
          </div>
        {/each}
      </div>
    {:else if tab === 'decay'}
      <Sparkline
        series={decaySeries}
        height={190}
        xMax={120}
        yMax={100}
        xLabel="minutes"
        yLabel="protection remaining"
        threshold={40}
        thresholdLabel="40 % reapply threshold"
      />
      <Ledger rows={ledger} dense />
    {:else}
      <div class="db">
        <input type="text" bind:value={search} placeholder="Search 89 ingredients — try 'avobenzone', 'reef', 'retinoid'" />
        <div class="db-list">
          {#each filteredDb as i}
            <div class="db-row">
              <div class="db-name">
                <strong>{i.name.split(' (')[0]}</strong>
                <span class="mono tiny faint">{i.role} · {i.filterClass}</span>
              </div>
              <div class="db-flags">
                {#if i.photostability < 0.4}<span class="badge-sq" style="color:var(--danger)">photolabile</span>{/if}
                {#if i.comedogenic >= 4}<span class="badge-sq" style="color:var(--warn)">comedo {i.comedogenic}</span>{/if}
                {#if i.reefBanned}<span class="badge-sq" style="color:var(--rose)">reef</span>{/if}
                {#if i.photosensitizing}<span class="badge-sq" style="color:var(--gold)">photoactive</span>{/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </Panel>

  <div class="stack">
    <Panel title="Photostability ledger" sub="Every derived number" icon="M4 19V5M4 19h16">
      <Ledger rows={ledger} dense />
    </Panel>

    <Panel title="Detected actives" sub="Resolved INCI tokens with their photochemical flags" icon="M9 3h6M10 3v6L5 19a2 2 0 0 0 1.8 2h10.4A2 2 0 0 0 19 19l-5-10V3">
      <div class="actives">
        {#each result.items as item}
          <div class="act" class:unknown={!item.matched} data-role={item.role}>
            <span class="act-dot"></span>
            <span class="act-name">{item.matched ? item.name.split(' (')[0] : item.token}</span>
            {#if item.matched}
              <span class="badge-sq">{item.role}</span>
              {#if item.pct}<span class="mono tiny faint">{item.pct}%</span>{/if}
            {:else}
              <span class="badge-sq">unresolved</span>
            {/if}
          </div>
        {/each}
      </div>
      <div class="db-stats">
        {#each Object.entries(DATABASE_STATS) as [k, v]}
          <div class="tile">
            <span class="unit">{k}</span>
            <strong class="stat-sm">{v}</strong>
          </div>
        {/each}
      </div>
    </Panel>
  </div>
</div>

<style>
  .presets {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 7px;
    margin-bottom: 12px;
  }
  .preset {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 9px 11px;
    border-radius: var(--r-sm);
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    text-align: left;
    transition: 240ms var(--ease-out);
  }
  .preset:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--accent) 44%, transparent);
  }
  .preset.active {
    border-color: color-mix(in srgb, var(--accent) 68%, transparent);
    background: color-mix(in srgb, var(--accent) 11%, transparent);
  }
  .preset[data-tone='danger'].active {
    border-color: color-mix(in srgb, var(--danger) 64%, transparent);
    background: color-mix(in srgb, var(--danger) 9%, transparent);
  }
  .preset[data-tone='ok'].active {
    border-color: color-mix(in srgb, var(--ok) 60%, transparent);
    background: color-mix(in srgb, var(--ok) 9%, transparent);
  }
  .p-name {
    font-size: 11.5px;
    font-weight: 580;
    color: var(--ink-strong);
    line-height: 1.25;
  }
  .p-tag {
    font-size: 9px;
    color: var(--ink-faint);
    letter-spacing: 0;
  }
  .input-wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .input-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .input-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .sim {
    display: flex;
    gap: 5px;
    margin-left: auto;
    flex-wrap: wrap;
  }
  .result-head {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 14px 0 12px;
    padding: 12px;
    border-radius: var(--r-md);
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    flex-wrap: wrap;
  }
  .grade {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 66px;
    height: 66px;
    border-radius: 20px;
    border: 1px solid var(--glass-line);
    justify-content: center;
    flex: none;
  }
  .grade strong {
    font-size: 26px;
    line-height: 1;
    letter-spacing: -0.04em;
    color: var(--ink-strong);
  }
  .grade span {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--ink-faint);
  }
  .grade[data-tone='ok'] {
    border-color: color-mix(in srgb, var(--ok) 50%, transparent);
    background: color-mix(in srgb, var(--ok) 10%, transparent);
  }
  .grade[data-tone='warn'] {
    border-color: color-mix(in srgb, var(--warn) 50%, transparent);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
  }
  .grade[data-tone='danger'] {
    border-color: color-mix(in srgb, var(--danger) 52%, transparent);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }
  .result-meta {
    flex: 1;
    min-width: 180px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .result-meta strong {
    font-size: 14px;
    color: var(--ink-strong);
  }
  .coverage-rings {
    display: flex;
    gap: 8px;
  }
  .ring {
    width: 58px;
    height: 58px;
    border-radius: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: conic-gradient(
      var(--accent) calc(var(--pct) * 1%),
      color-mix(in srgb, var(--ink-faint) 16%, transparent) 0
    );
    position: relative;
  }
  .ring::before {
    content: '';
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    background: var(--glass-bg-strong);
  }
  .ring span {
    position: relative;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 620;
    color: var(--ink-strong);
  }
  .ring em {
    position: relative;
    font-style: normal;
    font-family: var(--font-mono);
    font-size: 7.5px;
    letter-spacing: 0.1em;
    color: var(--ink-faint);
  }
  .tabs {
    margin-bottom: 10px;
  }
  .findings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .finding {
    border-radius: var(--r-sm);
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    border-left-width: 2px;
  }
  .finding[data-tone='critical'] {
    border-left-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 6%, transparent);
  }
  .finding[data-tone='warning'] {
    border-left-color: var(--warn);
    background: color-mix(in srgb, var(--warn) 5%, transparent);
  }
  .finding[data-tone='info'] {
    border-left-color: var(--accent);
  }
  .finding[data-tone='good'] {
    border-left-color: var(--ok);
  }
  .finding header {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
  }
  .f-icon {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    flex: none;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .f-icon[data-tone='danger'] {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .f-icon[data-tone='warn'] {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }
  .f-icon[data-tone='ok'] {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 14%, transparent);
  }
  .f-id {
    font-size: 8.5px;
    color: var(--ink-faint);
    letter-spacing: 0.08em;
  }
  .finding h4 {
    font-size: 12.5px;
    font-weight: 600;
    flex: 1;
    min-width: 120px;
    line-height: 1.3;
  }
  .finding p {
    color: var(--ink-muted);
    line-height: 1.55;
  }
  .metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .metric {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 5px;
    border: 1px solid var(--glass-line-soft);
    background: color-mix(in srgb, var(--bg-void) 30%, transparent);
  }
  .metric em {
    font-style: normal;
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--ink-faint);
  }
  .metric strong {
    font-size: 10px;
    color: var(--ink-strong);
  }
  .filter-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .frow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    flex-wrap: wrap;
  }
  .fname {
    display: flex;
    flex-direction: column;
    min-width: 150px;
    flex: 1;
  }
  .fname strong {
    font-size: 11.5px;
    color: var(--ink-strong);
  }
  .fbar {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 120px;
  }
  .fstability {
    font-family: var(--font-mono);
    font-size: 15px;
    font-weight: 620;
    min-width: 52px;
    text-align: right;
  }
  .fstability small {
    font-size: 9px;
    font-weight: 400;
    color: var(--ink-faint);
  }
  .fstability[data-tone='ok'] {
    color: var(--ok);
  }
  .fstability[data-tone='warn'] {
    color: var(--warn);
  }
  .fstability[data-tone='danger'] {
    color: var(--danger);
  }
  .db {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .db-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 300px;
    overflow: auto;
  }
  .db-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 9px;
    border-radius: 8px;
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    flex-wrap: wrap;
  }
  .db-name {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 130px;
  }
  .db-name strong {
    font-size: 11px;
    color: var(--ink-strong);
  }
  .db-flags {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
  }
  .actives {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 260px;
    overflow: auto;
    margin-bottom: 10px;
  }
  .act {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 7px;
    border-radius: 7px;
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
  }
  .act.unknown {
    opacity: 0.55;
  }
  .act-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
  .act[data-role='uva'] .act-dot,
  .act[data-role='broad'] .act-dot {
    background: var(--violet);
  }
  .act[data-role='mineral'] .act-dot {
    background: var(--gold);
  }
  .act[data-role='retinoid'] .act-dot,
  .act[data-role='acid'] .act-dot {
    background: var(--danger);
  }
  .act-name {
    flex: 1;
    font-size: 10.5px;
    color: var(--ink);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .db-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 5px;
  }
  .db-stats .tile {
    padding: 6px 7px;
    gap: 0;
  }
  .db-stats .unit {
    font-size: 8px;
  }
  .db-stats .stat-sm {
    font-size: 14px;
  }
</style>
