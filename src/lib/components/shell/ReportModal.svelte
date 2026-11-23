<script>
  /**
   * Clinical session report.
   *
   * Aggregates whatever the five modules currently hold — phototype, erythema
   * index, solar advisory, lesion morphometry, sunscreen audit — into a single
   * printable document. Rendering happens in-app (no PDF library, no network);
   * the operator can print to PDF via the browser, or copy/download the JSON.
   */
  import { app } from '$lib/db/store.svelte.js';
  import Icon from '../ui/Icon.svelte';
  import Ledger from '../ui/Ledger.svelte';
  import { fmt, fmtInt, fmtMinutes, fmtClock, fmtPct } from '../ui/Stat.js';
  import { solarAdvisory } from '$lib/engines/photobiology.js';
  import { downloadText } from '$lib/db/vault.js';

  const scan = $derived(app.scan);
  const solar = $derived(app.solar);
  const lesion = $derived(app.lesion);

  const advisory = $derived.by(() => {
    try {
      return solarAdvisory({
        uvIndex: solar.uvIndex,
        ita: scan.ita ?? 52.4,
        bsaFraction: solar.bsaFraction,
        spf: solar.spf,
        albedo: solar.albedo,
        altitudeM: solar.altitudeM,
        elevationDeg: solar.elevationDeg,
        ozoneDU: solar.ozoneDU
      });
    } catch {
      return null;
    }
  });

  // The sunscreen module keeps its own local result; a report opened from there
  // passes it through `app.modal.payload`.
  const audit = $derived(app.modal.payload?.audit ?? app.auditResult ?? null);

  const generated = $derived(new Date());

  const identityRows = $derived([
    { label: 'Phototype', value: scan.phototype?.type ?? '—', unit: scan.phototype?.label ? '' : '', tone: 'accent' },
    { label: 'ITA°', value: fmt(scan.ita, 1), unit: '°' },
    { label: 'Erythema index', value: fmt(scan.erythemaIndex, 1), unit: 'EI' },
    { label: 'Melanin index', value: fmt(scan.melaninIndex, 1), unit: 'MI' },
    { label: 'MED', value: fmt(scan.med, 0), unit: 'J/m²' },
    { label: 'Hydration', value: fmt(scan.hydration, 1), unit: '%' },
    { label: 'L*a*b*', value: `${fmt(scan.lab?.L, 1)} · ${fmt(scan.lab?.a, 1)} · ${fmt(scan.lab?.b, 1)}` },
    { label: 'Sample', value: scan.source === 'camera' ? 'Live camera' : 'Phantom', unit: scan.phantomId ?? '' }
  ]);

  const solarRows = $derived([
    { label: 'UV Index', value: fmt(solar.uvIndex, 1), unit: 'UVI', tone: 'accent' },
    { label: 'Solar elevation', value: fmt(solar.elevationDeg, 1), unit: '°' },
    { label: 'Altitude', value: fmtInt(solar.altitudeM), unit: 'm' },
    { label: 'Albedo', value: fmt(solar.albedo, 2) },
    { label: 'Ozone', value: fmtInt(solar.ozoneDU), unit: 'DU' },
    { label: 'SPF applied', value: fmt(solar.spf, 0), unit: '' },
    { label: 'BSA exposed', value: fmtPct(solar.bsaFraction * 100, 0) },
    { label: 'Activity', value: solar.activity ?? 'walk' }
  ]);

  const burnRows = $derived(
    advisory
      ? [
          { label: 'Time to 1.0 MED', value: fmtMinutes(advisory.burn.minutesToMed), tone: advisory.burn.minutesToMed < 60 ? 'danger' : 'ok' },
          { label: 'Time to vitamin D₃ target', value: fmtMinutes(advisory.vitd.minutesToTarget), tone: 'accent' },
          { label: 'Synthesis rate', value: `${fmt(advisory.vitd.iuPerMin, 1)} IU/min` },
          { label: 'UV band', value: advisory.band, tone: advisory.band === 'extreme' ? 'danger' : advisory.band === 'very-high' ? 'warn' : 'ok' },
          { label: 'Safe window', value: fmtMinutes(advisory.safeWindowMin) },
          { label: 'MED at this ITA°', value: `${fmt(advisory.med, 0)} J/m²` }
        ]
      : []
  );

  const lesionRows = $derived(
    lesion?.result
      ? [
          { label: 'Risk tier', value: lesion.result.risk?.label ?? '—', tone: lesion.result.risk?.tone ?? 'warn' },
          { label: 'A · Asymmetry', value: fmt(lesion.result.A?.score, 2) },
          { label: 'B · Border index', value: fmt(lesion.result.B?.index, 3) },
          { label: 'C · Colour entropy', value: fmt(lesion.result.C?.entropy, 2), unit: `bits · ${lesion.result.C?.colorsPresent ?? 0} zones` },
          { label: 'D · Max diameter', value: fmt(lesion.result.D?.maxMm, 1), unit: 'mm' },
          { label: 'E · Evolution', value: lesion.result.E?.label ?? lesion.result.E?.trend ?? '—' }
        ]
      : []
  );

  const auditRows = $derived(
    audit
      ? [
          { label: 'Photostability score', value: fmt(audit.score, 0), unit: '/100', tone: audit.score > 60 ? 'ok' : 'danger' },
          { label: 'Grade', value: `${audit.grade?.letter ?? '—'} · ${audit.grade?.label ?? ''}` },
          { label: 'Findings', value: String(audit.findings?.length ?? 0) },
          { label: 'UVA coverage', value: fmt(audit.coverage?.uva, 0), unit: '%' },
          { label: 'UVB coverage', value: fmt(audit.coverage?.uvb, 0), unit: '%' },
          { label: 'Broad spectrum', value: audit.coverage?.broadSpectrum ? 'yes' : 'no', tone: audit.coverage?.broadSpectrum ? 'ok' : 'warn' },
          { label: 'Reapply at', value: fmtMinutes(audit.reapplyMinute) }
        ]
      : []
  );

  function payload() {
    return {
      app: 'DERMA-SHIELD',
      version: '1.0.0',
      generatedAt: generated.toISOString(),
      role: app.role,
      phototype: scan.phototype ?? null,
      chromophore: {
        ita: scan.ita,
        med: scan.med,
        erythemaIndex: scan.erythemaIndex,
        melaninIndex: scan.melaninIndex,
        lab: scan.lab,
        rgb: scan.rgb,
        sampleSource: scan.source
      },
      solar: { ...solar },
      advisory,
      lesion: lesion?.result ?? null,
      sunscreenAudit: audit,
      disclaimer:
        'Not a medical device. Donor/phantom calibration only — no diagnostic claims. Seek a dermatologist for any changing lesion.'
    };
  }

  function copyJson() {
    navigator.clipboard
      .writeText(JSON.stringify(payload(), null, 2))
      .then(() => app.toast('Report JSON copied', 'ok'))
      .catch(() => app.toast('Clipboard blocked', 'warn'));
  }

  function downloadJson() {
    downloadText(
      `dermashield-report-${generated.toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload(), null, 2),
      'application/json'
    );
    app.toast('Report downloaded', 'ok');
  }

  function print() {
    window.print();
  }
</script>

<div class="report">
  <header class="doc-head">
    <div>
      <span class="wordmark mono">DERMA-SHIELD · CLINICAL SESSION</span>
      <h3>{scan.phototype?.label ?? scan.phototype?.type ?? 'Unclassified'} · ITA° {fmt(scan.ita, 1)}</h3>
      <p class="meta mono">
        {generated.toLocaleString()} · role {app.role} · sample {scan.source}
        {#if scan.calibrated}<span class="cal">CALIBRATED</span>{/if}
      </p>
    </div>
    <div class="acts">
      <button class="btn" onclick={print}><Icon name="export" size={14} /> Print / PDF</button>
      <button class="btn" onclick={downloadJson}><Icon name="download" size={14} /> JSON</button>
      <button class="btn ghost" onclick={copyJson}><Icon name="copy" size={14} /> Copy</button>
    </div>
  </header>

  <div class="cols">
    <section class="card">
      <h4><Icon name="microscope" size={14} /> Optical chromophore</h4>
      <Ledger rows={identityRows} dense />
    </section>

    <section class="card">
      <h4><Icon name="sun" size={14} /> Solar context</h4>
      <Ledger rows={solarRows} dense />
    </section>

    <section class="card">
      <h4><Icon name="clock" size={14} /> Dosimetry</h4>
      {#if burnRows.length}
        <Ledger rows={burnRows} dense />
      {:else}
        <p class="empty">No advisory computed.</p>
      {/if}
    </section>

    {#if lesionRows.length}
      <section class="card">
        <h4><Icon name="mole" size={14} /> ABCDE morphometry</h4>
        <Ledger rows={lesionRows} dense />
      </section>
    {/if}

    {#if auditRows.length}
      <section class="card">
        <h4><Icon name="flask" size={14} /> Sunscreen audit</h4>
        <Ledger rows={auditRows} dense />
      </section>
    {/if}

    <section class="card span">
      <h4><Icon name="alert" size={14} /> Interpretation &amp; disclaimer</h4>
      <ul class="findings">
        {#if advisory}
          <li>
            At UV Index {fmt(solar.uvIndex, 1)} with SPF {fmt(solar.spf, 0)}, unprotected
            erythema would take {fmtMinutes(advisory.burn.minutesToMedUnprotected ?? advisory.burn.minutesToMed)}
            {#if solar.spf > 1}
              without sunscreen and {fmtMinutes(advisory.burn.minutesToMed)} with it.
            {:else}
              — that is inside the burn window for this phototype.
            {/if}
          </li>
          <li>
            Vitamin D₃ target of {fmtInt(solar.targetIU ?? 1000)} IU is reached in roughly
            {fmtMinutes(advisory.vitd.minutesToTarget)} at {fmt(advisory.vitd.iuPerMin, 1)} IU/min
            over {fmtPct(solar.bsaFraction * 100, 0)} of body surface.
          </li>
        {/if}
        {#if lesion?.result?.risk}
          <li>
            Lesion morphometry places this sample in the
            <strong>{lesion.result.risk.label}</strong> tier (score {fmt(lesion.result.risk.score, 0)}/100);
            the dominant contributor is {lesion.result.risk.driver ?? lesion.result.risk.topFactor ?? 'border irregularity'}.
          </li>
        {/if}
        {#if audit}
          <li>
            The audited formula scores {audit.score}/100 ({audit.grade?.letter ?? '—'}) with
            {audit.findings?.length ?? 0} photochemistry findings; reapplication is indicated
            at {fmtMinutes(audit.reapplyMinute)}.
          </li>
        {/if}
      </ul>
      <p class="disclaimer">
        Not a medical device. All figures derive from published photobiology models
        (McKinlay–Diffey, Holick, Kasten–Young) evaluated against phantom or
        camera-calibrated reflectance. No diagnostic claims are made; any changing
        lesion should be reviewed by a dermatologist.
      </p>
    </section>
  </div>
</div>

<style>
  .report {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .doc-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
    padding-bottom: 0.8rem;
    border-bottom: 1px solid var(--line);
  }

  .wordmark {
    font-size: 0.6rem;
    letter-spacing: 0.2em;
    color: var(--accent);
  }

  .doc-head h3 {
    margin: 0.3rem 0 0.2rem;
    font-size: 1.15rem;
    letter-spacing: -0.01em;
  }

  .meta {
    margin: 0;
    font-size: 0.66rem;
    color: var(--ink-muted);
  }

  .cal {
    margin-left: 0.4rem;
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 16%, transparent);
  }

  .acts {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.42rem 0.7rem;
    border-radius: 9px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink);
    font-size: 0.72rem;
    cursor: pointer;
  }

  .btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .btn.ghost {
    background: transparent;
  }

  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 0.7rem;
  }

  .card {
    padding: 0.75rem 0.8rem;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--surface-3);
  }

  .card.span {
    grid-column: 1 / -1;
  }

  .card h4 {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0 0 0.55rem;
    font-size: 0.76rem;
    letter-spacing: 0.03em;
    color: var(--ink);
  }

  .findings {
    margin: 0 0 0.7rem;
    padding-left: 1.05rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 0.76rem;
    line-height: 1.55;
    color: var(--ink-muted);
  }

  .findings strong {
    color: var(--ink);
  }

  .disclaimer {
    margin: 0;
    padding: 0.55rem 0.65rem;
    border-radius: 9px;
    background: color-mix(in srgb, var(--warn) 9%, transparent);
    border: 1px solid color-mix(in srgb, var(--warn) 26%, transparent);
    font-size: 0.7rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }

  .empty {
    margin: 0;
    font-size: 0.72rem;
    color: var(--ink-muted);
  }

  @media print {
    .acts { display: none; }
    .card { break-inside: avoid; }
  }
</style>
