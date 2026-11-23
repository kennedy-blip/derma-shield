<script>
  /**
   * MODULE 2 · Solar UV, Vitamin D3 & Sunscreen SPF Kinetics
   *
   * Combines the JS mirror of the Python photobiology package with live controls:
   * UV Index, ITA°-linked phototype, exposed BSA, surface albedo, altitude,
   * sunscreen SPF and sweat/water activity. Produces the two headline timers
   * (vitamin D3 window, 1.0 MED burn countdown), a live film-integrity gauge, a
   * 60 fps bi-exponential SPF decay curve and a reapplication alarm.
   */
  import { untrack } from 'svelte';
  import { app, ROLES } from '$lib/db/store.svelte.js';
  import {
    ALBEDO_PRESETS,
    BSA_PRESETS,
    SPF_PRESETS,
    ACTIVITY_PRESETS,
    solarAdvisory,
    spfDecayCurve,
    reapplyMinute,
    spfFilmIntegrity,
    spfBandLabels
  } from '$lib/engines/photobiology.js';
  import {
    createSensorBridge,
    shadowClinometerReport,
    estimateSolarElevationNow,
    SENSOR_STATES
  } from '$lib/engines/sensor-bridge.js';
  import Panel from '../ui/Panel.svelte';
  import Icon from '../ui/Icon.svelte';
  import Dial from '../ui/Dial.svelte';
  import Slider from '../ui/Slider.svelte';
  import Sparkline from '../ui/Sparkline.svelte';
  import Gauge from '../ui/Gauge.svelte';
  import Ledger from '../ui/Ledger.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import { fmt, fmtInt, fmtMinutes } from '../ui/Stat.js';
  import { alarm } from '$lib/engines/audio-haptics.js';
  import { createShaderField } from '$lib/engines/webgl-renderer.js';

  /* ------------------------------------------------------------------ state */
  let sensor = $state(null);
  let sensorLive = $state(false);
  let clinometer = $state({ heightM: 1.75, shadowM: 1.2, measuring: false });
  let shadowReport = $state(null);
  let coronaCanvas = $state(null);
  let coronaField = null;
  let clock = $state(Date.now());
  let alarmLog = $state([]);

  const solar = $derived(app.solar);
  const advisory = $derived(
    solarAdvisory({
      uvIndex: solar.uvIndex,
      ita: app.scan.ita,
      medJm2: app.med,
      bsaFraction: solar.bsaFraction,
      spf: solar.spf,
      albedo: solar.albedo,
      altitudeM: solar.altitudeM,
      elevationDeg: solar.elevationDeg,
      ozoneDU: solar.ozoneDU,
      targetIU: solar.targetIU,
      altitudeInUvi: solar.altitudeInUvi
    })
  );

  const burnMin = $derived(advisory.burn.minutesToMed);
  const vitdMin = $derived(advisory.vitd.minutesToTarget);
  const elapsed = $derived(app.timers.exposureElapsedMin);
  const remaining = $derived(burnMin != null ? Math.max(0, burnMin - elapsed) : null);
  const vitdProgress = $derived(
    vitdMin ? Math.min(100, (app.timers.vitdAccumulatedIU / solar.targetIU) * 100) : 0
  );
  const doseProgress = $derived(burnMin ? Math.min(100, (elapsed / burnMin) * 100) : 0);

  const film = $derived(
    spfFilmIntegrity({
      minutes: elapsed,
      spf: solar.spf,
      activity: solar.activity,
      filterKey: solar.filterKey,
      waterResistanceMin: solar.waterResistanceMin
    })
  );

  const decayCurve = $derived(
    spfDecayCurve({
      horizon: 180,
      step: 2,
      spf: solar.spf,
      activity: solar.activity,
      filterKey: solar.filterKey,
      waterResistanceMin: solar.waterResistanceMin
    })
  );

  const reapply = $derived(
    reapplyMinute({
      thresholdPct: 40,
      spf: solar.spf,
      activity: solar.activity,
      filterKey: solar.filterKey,
      waterResistanceMin: solar.waterResistanceMin
    })
  );

  const band = $derived(spfBandLabels(solar.uvIndex));

  const uviBands = [
    { from: 0, to: 3, color: '#10B981', label: 'LOW' },
    { from: 3, to: 6, color: '#EAB308', label: 'MODERATE' },
    { from: 6, to: 8, color: '#F59E0B', label: 'HIGH' },
    { from: 8, to: 11, color: '#F43F5E', label: 'VERY HIGH' },
    { from: 11, to: 99, color: '#EC4899', label: 'EXTREME' }
  ];

  const decaySeries = $derived([
    {
      label: 'Film integrity %',
      color: 'var(--accent)',
      points: decayCurve.map((p) => ({ x: p.t, y: p.protectionRemaining }))
    },
    {
      label: 'Effective SPF',
      color: 'var(--gold)',
      dashed: true,
      points: decayCurve.map((p) => ({ x: p.t, y: p.effectiveSpf * (100 / Math.max(1, solar.spf)) }))
    }
  ]);

  const ledger = $derived([
    {
      label: 'Erythemal irradiance',
      value: fmt(advisory.burn.erythemalWm2, 4),
      unit: 'W/m²',
      hint: 'UV Index × 0.025 × albedo × altitude ÷ SPF'
    },
    { label: 'Dose rate', value: fmt(advisory.burn.joulesPerMin, 2), unit: 'J/m²/min' },
    { label: 'MED threshold', value: fmt(app.med, 0), unit: 'J/m²', tone: 'ok' },
    { label: 'Burn threshold (1.0 MED)', value: fmtMinutes(burnMin), tone: 'danger' },
    { label: 'Unprotected burn threshold', value: fmtMinutes(advisory.burn.minutesToMedUnprotected) },
    { label: 'Vitamin D3 synthesis rate', value: fmt(advisory.vitd.iuPerMin, 1), unit: 'IU/min', tone: 'gold' },
    { label: `Minutes to ${fmtInt(solar.targetIU)} IU`, value: fmtMinutes(vitdMin), tone: 'gold' },
    { label: 'Vitamin D / erythema spectral ratio', value: fmt(advisory.vitd.spectralRatio, 3) },
    { label: 'Albedo multiplier', value: `×${fmt(advisory.burn.albedoMultiplier, 2)}` },
    { label: 'Altitude multiplier', value: `×${fmt(advisory.burn.altitudeMultiplier, 2)}` },
    { label: 'Exposed BSA', value: `${Math.round(solar.bsaFraction * 100)} %` },
    { label: 'Safe exposure window', value: fmtMinutes(advisory.safeWindowMin), tone: 'ok' }
  ]);

  /* --------------------------------------------------------------- timers */
  $effect(() => {
    const id = setInterval(() => {
      clock = Date.now();
      if (!app.timers.running) return;
      untrack(() => tickTimer());
    }, 1000);
    return () => clearInterval(id);
  });

  function tickTimer() {
    const t = app.timers;
    if (!t.running) return;
    const nextMin = t.exposureElapsedMin + 1 / 60;
    const iuPerMin = advisory.vitd.iuPerMin ?? 0;
    const dosePerMin = advisory.burn.joulesPerMin ?? 0;
    const nextIU = t.vitdAccumulatedIU + iuPerMin / 60;
    const nextDose = t.doseAccumulatedJm2 + dosePerMin / 60;

    // alarms fire once per crossing
    const log = alarmLog.slice();
    if (nextIU >= solar.targetIU && t.vitdAccumulatedIU < solar.targetIU) {
      fireAlarm('vitamin-d-achieved', `Vitamin D3 target reached — ${fmtInt(solar.targetIU)} IU synthesised`);
      log.unshift({ at: Date.now(), kind: 'vitamin-d-achieved', text: `${fmtInt(solar.targetIU)} IU reached` });
    }
    if (burnMin != null && nextMin >= burnMin * 0.85 && t.exposureElapsedMin < burnMin * 0.85) {
      fireAlarm('burn-warning', `85 % of your MED consumed — ${fmtMinutes(Math.max(0, burnMin - nextMin))} to erythema`);
      log.unshift({ at: Date.now(), kind: 'burn-warning', text: '85 % MED warning' });
    }
    if (nextMin >= burnMin && t.exposureElapsedMin < burnMin) {
      fireAlarm('burn-warning', '1.0 MED reached — erythema threshold. Get out of direct sun.');
      log.unshift({ at: Date.now(), kind: 'burn-warning', text: '1.0 MED exceeded' });
    }
    if (reapply != null && nextMin >= reapply && t.exposureElapsedMin < reapply) {
      fireAlarm('spf-reapply', `Sunscreen film below 40 % — reapply now (effective SPF ${fmt(film.effectiveSpf, 1)})`);
      log.unshift({ at: Date.now(), kind: 'spf-reapply', text: 'Reapply sunscreen' });
    }
    alarmLog = log.slice(0, 8);

    app.setTimers({
      exposureElapsedMin: nextMin,
      vitdAccumulatedIU: nextIU,
      doseAccumulatedJm2: nextDose
    });
  }

  async function fireAlarm(name, message) {
    app.toast(message, name === 'spf-reapply' ? 'warn' : 'ok', 7000);
    await alarm(name, { haptic: app.hapticEnabled, sound: app.soundEnabled });
  }

  function resetRun() {
    app.resetTimers();
    alarmLog = [];
    app.toast('Exposure timers reset', 'info');
  }

  /* ------------------------------------------------------------ clinometer */
  $effect(() => {
    const bridge = createSensorBridge();
    sensor = bridge;
    return () => bridge.stop();
  });

  async function activateSensors() {
    if (!sensor) return;
    await sensor.requestMotionPermission();
    await sensor.start();
    sensorLive = true;
    app.setPermission('lux', sensor.state.backend, sensor.state.source);
    app.toast(`Sensor backend: ${sensor.state.backend}`, 'ok');
  }

  function measureShadow() {
    const rep = shadowClinometerReport({
      heightM: clinometer.heightM,
      shadowM: clinometer.shadowM,
      altitudeM: solar.altitudeM,
      albedo: solar.albedo,
      ozoneDU: solar.ozoneDU
    });
    shadowReport = rep;
    app.setSolar({ uvIndex: rep.uvIndex, elevationDeg: rep.elevationDeg, altitudeInUvi: true });
    app.toast(`Shadow clinometer → α ${rep.elevationDeg.toFixed(1)}° · UVI ${rep.uvIndex.toFixed(1)} (off-grid)`, 'ok');
  }

  function useNow() {
    const elev = estimateSolarElevationNow(solar.latitude, solar.longitude, new Date());
    app.setSolar({ elevationDeg: Math.max(0, elev), altitudeInUvi: false });
    app.toast(`Solar elevation from ephemeris: ${elev.toFixed(1)}°`, 'info');
  }

  /* ------------------------------------------------------------- corona GPU */
  $effect(() => {
    if (!coronaCanvas || app.gpuMode === 'low' || app.theme === 'eco') return;
    coronaField = createShaderField(coronaCanvas, {
      program: 'corona',
      rasterPixels: 520 * 240,
      maxDpr: 1.4
    });
    if (!coronaField.start()) {
      coronaField = null;
      return;
    }
    return () => {
      coronaField?.destroy();
      coronaField = null;
    };
  });

  $effect(() => {
    if (!coronaField) return;
    coronaField.setUniforms({
      uUvIndex: solar.uvIndex,
      uSolarElevation: solar.elevationDeg,
      uMode: clinometer.measuring ? 1 : 0,
      uCorona: 0.3 + (solar.ozoneDU - 220) / 400,
      uPointer: [app.specular.x, app.specular.y],
      uIntensity: 1
    });
  });

  void ROLES;
</script>

<div class="grid g-main">
  <!-- ======================= LEFT: CONTROLS + DIAL ======================= -->
  <Panel
    title="Solar UV · Vitamin D3 · SPF kinetics"
    sub="McKinlay–Diffey erythemal spectrum · Holick previtamin-D3 synthesis · bi-exponential film breakdown"
    icon="M12 4v1.5M12 18.5V20M4 12h1.5M18.5 12H20M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
    tone="gold"
  >
    {#snippet actions()}
      <span class="pill {band.tone === 'danger' ? 'danger' : band.tone === 'warn' ? 'warn' : 'ok'}">
        {band.label} · {band.advice}
      </span>
    {/snippet}

    <div class="solar-hero">
      <div class="corona-wrap">
        {#if app.gpuMode !== 'low' && app.theme !== 'eco'}
          <canvas bind:this={coronaCanvas} class="corona" width="520" height="240"></canvas>
        {:else}
          <div class="corona-fallback"></div>
        {/if}
        <Dial
          value={solar.uvIndex}
          min={0}
          max={15}
          size={214}
          bands={uviBands}
          label={band.label}
          unit="UV INDEX"
          sub={`α ${solar.elevationDeg.toFixed(0)}° · ${solar.altitudeM.toFixed(0)} m`}
        />
      </div>

      <div class="timers">
        <div class="timer-card" data-tone="gold">
          <span class="unit">Optimal vitamin D3 window</span>
          <strong class="timer mono">{fmtMinutes(vitdMin)}</strong>
          <span class="tiny">to synthesise {fmtInt(solar.targetIU)} IU</span>
          <div class="meter">
            <i style="width:{vitdProgress}%;background:linear-gradient(90deg,var(--amber),var(--gold))"></i>
          </div>
          <span class="tiny faint mono">
            {fmtInt(app.timers.vitdAccumulatedIU)} / {fmtInt(solar.targetIU)} IU · {fmt(advisory.vitd.iuPerMin, 1)} IU/min
          </span>
        </div>

        <div class="timer-card" data-tone={remaining != null && remaining < 15 ? 'danger' : 'ok'}>
          <span class="unit">Max safe exposure · 1.0 MED</span>
          <strong class="timer mono">
            {remaining != null ? fmtMinutes(remaining) : '—'}
          </strong>
          <span class="tiny">
            {solar.spf > 1 ? `with SPF ${solar.spf}` : 'unprotected'} · {fmt(app.med, 0)} J/m² MED
          </span>
          <div class="meter {doseProgress > 85 ? 'danger' : doseProgress > 60 ? 'warn' : ''}">
            <i style="width:{doseProgress}%"></i>
          </div>
          <span class="tiny faint mono">
            {fmt(app.timers.doseAccumulatedJm2, 1)} / {fmt(app.med, 0)} J/m² · {fmt(doseProgress, 0)}% MED
          </span>
        </div>

        <div class="run-row">
          <button class="btn btn-primary" onclick={() => { app.toggleTimers(); if (!app.timers.running) fireAlarm('scan-confirm', 'Dosimeter armed — tracking your exposure'); }}>
            <Icon name={app.timers.running ? 'pause' : 'play'} size={14} />
            {app.timers.running ? 'Pause dosimeter' : 'Start dosimeter'}
          </button>
          <button class="btn" onclick={resetRun}><Icon name="reset" size={14} /> Reset</button>
          <span class="clock mono">{Math.floor(elapsed)} min elapsed</span>
        </div>
      </div>
    </div>

    <!-- controls -->
    <div class="controls">
      <Slider
        label="UV Index"
        value={solar.uvIndex}
        min={0}
        max={15}
        step={0.1}
        digits={1}
        unit="UVI"
        hints={[
          { at: 0, label: '0' },
          { at: 3, label: '3' },
          { at: 6, label: '6' },
          { at: 8, label: '8' },
          { at: 11, label: '11+' }
        ]}
        onchange={(v) => app.setSolar({ uvIndex: v, altitudeInUvi: false })}
      />
      <Slider
        label="Solar elevation α"
        value={solar.elevationDeg}
        min={0}
        max={90}
        step={1}
        digits={0}
        unit="°"
        onchange={(v) => app.setSolar({ elevationDeg: v, altitudeInUvi: false })}
      />
      <Slider
        label="Altitude"
        value={solar.altitudeM}
        min={0}
        max={4000}
        step={50}
        digits={0}
        unit="m"
        hints={[
          { at: 0, label: 'Sea' },
          { at: 1650, label: 'Nairobi' },
          { at: 2500, label: 'Alpine' },
          { at: 4000, label: 'High' }
        ]}
        onchange={(v) => app.setSolar({ altitudeM: v })}
      />
      <Slider
        label="Ozone column"
        value={solar.ozoneDU}
        min={220}
        max={420}
        step={5}
        digits={0}
        unit="DU"
        hints={[
          { at: 220, label: 'Thin' },
          { at: 300, label: '300' },
          { at: 420, label: 'Thick' }
        ]}
        onchange={(v) => app.setSolar({ ozoneDU: v })}
      />
    </div>

    <div class="selectors">
      <div class="sel">
        <span class="label">Surface albedo</span>
        <div class="chips">
          {#each ALBEDO_PRESETS as a}
            <button class="chip" class:active={Math.abs(solar.albedo - a.albedo) < 0.01}
              onclick={() => app.setSolar({ albedo: a.albedo })}>
              <Icon name={a.icon} size={13} /> {a.label}
              <em>+{Math.round(a.albedo * 100)}%</em>
            </button>
          {/each}
        </div>
      </div>

      <div class="sel">
        <span class="label">Exposed body surface area</span>
        <Segmented
          size="sm"
          value={String(Math.round(solar.bsaFraction * 100))}
          onchange={(v) => app.setSolar({ bsaFraction: Number(v) / 100 })}
          options={BSA_PRESETS.map((b) => ({ id: String(Math.round(b.bsa * 100)), label: `${b.label} ${Math.round(b.bsa * 100)}%` }))}
        />
      </div>

      <div class="sel">
        <span class="label">Applied sunscreen</span>
        <Segmented
          size="sm"
          value={SPF_PRESETS.find((s) => s.spf === solar.spf)?.id ?? 'none'}
          onchange={(id) => {
            const p = SPF_PRESETS.find((s) => s.id === id);
            app.setSolar({ spf: p.spf });
          }}
          options={SPF_PRESETS.map((s) => ({ id: s.id, label: s.label }))}
        />
      </div>

      <div class="sel">
        <span class="label">Activity / wash-off</span>
        <Segmented
          size="sm"
          value={solar.activity}
          onchange={(v) => app.setSolar({ activity: v })}
          options={ACTIVITY_PRESETS.map((a) => ({ id: a.id, label: a.label }))}
        />
      </div>
    </div>
  </Panel>

  <!-- ============================ RIGHT COLUMN ============================ -->
  <div class="stack">
    <Panel
      title="Sunscreen film integrity"
      sub={`${SPF_PRESETS.find((s) => s.spf === solar.spf)?.label ?? 'None'} · ${ACTIVITY_PRESETS.find((a) => a.id === solar.activity)?.label}`}
      icon="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"
      tone={film.protectionRemaining < 40 ? 'danger' : film.protectionRemaining < 70 ? 'warn' : 'default'}
    >
      {#snippet actions()}
        <span class="pill {film.protectionRemaining < 40 ? 'danger' : film.protectionRemaining < 70 ? 'warn' : 'ok'}">
          {film.protectionRemaining < 40 ? 'REAPPLY NOW' : film.protectionRemaining < 70 ? 'DEGRADING' : 'PROTECTED'}
        </span>
      {/snippet}

      {#if solar.spf <= 1}
        <div class="warn-strip ok">
          <Icon name="info" size={15} />
          No sunscreen modelled — the burn timer is running at the full unprotected rate.
        </div>
      {:else}
        <div class="film-row">
          <Gauge
            value={film.protectionRemaining}
            max={100}
            size={112}
            label="film"
            unit="% LEFT"
            tone="auto"
            digits={0}
            ticks={24}
          />
          <div class="film-stats">
            <div class="tile">
              <span class="unit">Effective SPF</span>
              <strong class="stat-sm">{fmt(film.effectiveSpf, 1)}</strong>
            </div>
            <div class="tile">
              <span class="unit">Reapply in</span>
              <strong class="stat-sm gold">
                {reapply != null ? fmtMinutes(Math.max(0, reapply - elapsed)) : '—'}
              </strong>
            </div>
            <div class="tile">
              <span class="unit">Wash-off τ</span>
              <strong class="stat-sm">{fmt(film.tauFast, 0)}<small>min</small></strong>
            </div>
            <div class="tile">
              <span class="unit">Photolysis t½</span>
              <strong class="stat-sm">
                {film.photolysisHalfLife != null && film.photolysisHalfLife < 1e6
                  ? `${fmt(film.photolysisHalfLife, 0)} min`
                  : 'stable'}
              </strong>
            </div>
          </div>
        </div>
        <Sparkline
          series={decaySeries}
          height={168}
          xMax={180}
          yMax={100}
          xLabel="minutes of exposure"
          yLabel="protection remaining %"
          threshold={40}
          thresholdLabel="Reapply threshold 40 %"
          marker={{ x: Math.min(180, elapsed), y: film.protectionRemaining }}
        />
        <div class="reapply-note tiny faint">
          Bi-exponential model: fast term = sweat/water wash-off (τ ≈ {fmt(film.tauFast, 0)} min);
          slow term = UV-filter photolysis (t½ ≈ {film.photolysisHalfLife ?? '∞'} min). Water-resistance
          rated at {solar.waterResistanceMin} min.
        </div>
      {/if}
    </Panel>

    <Panel
      title="Off-grid shadow clinometer"
      sub="William's shadow-ratio method — no network, no weather API"
      icon="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11ZM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"
      tone="violet"
    >
      {#snippet actions()}
        <button class="btn btn-sm" onclick={activateSensors}>
          <Icon name="wave" size={13} /> {sensorLive ? 'Sensors live' : 'Attach sensors'}
        </button>
      {/snippet}

      <p class="tiny muted">
        Stand a {clinometer.heightM.toFixed(2)} m reference (your own height at arm's length works)
        and measure the shadow it casts. elevation α = arctan(height ÷ shadow).
      </p>

      <div class="clin-grid">
        <Slider
          label="Reference height"
          value={clinometer.heightM}
          min={0.3}
          max={2.2}
          step={0.01}
          digits={2}
          unit="m"
          onchange={(v) => (clinometer = { ...clinometer, heightM: v })}
        />
        <Slider
          label="Measured shadow length"
          value={clinometer.shadowM}
          min={0.02}
          max={8}
          step={0.01}
          digits={2}
          unit="m"
          onchange={(v) => (clinometer = { ...clinometer, shadowM: v })}
        />
      </div>

      <div class="shadow-viz">
        <svg viewBox="0 0 300 130" aria-hidden="true">
          <line x1="20" y1="108" x2="280" y2="108" stroke="var(--glass-line)" stroke-width="1.4" />
          <!-- gnomon -->
          <line x1="60" y1="108" x2="60" y2={108 - Math.min(92, 92 * (clinometer.heightM / 2.2))} stroke="var(--accent)" stroke-width="3" stroke-linecap="round" />
          <!-- shadow -->
          <line x1="60" y1="108" x2={60 + Math.min(200, 26 * clinometer.shadowM)} y2="108" stroke="var(--gold)" stroke-width="5" stroke-linecap="round" opacity="0.82" />
          <!-- hypotenuse -->
          <line x1={60 + Math.min(200, 26 * clinometer.shadowM)} y1="108" x2="60" y2={108 - Math.min(92, 92 * (clinometer.heightM / 2.2))} stroke="var(--violet)" stroke-width="1.2" stroke-dasharray="4 3" />
          <text x="66" y={104 - Math.min(92, 92 * (clinometer.heightM / 2.2))} class="viz-lbl">h {clinometer.heightM.toFixed(2)} m</text>
          <text x={60 + Math.min(200, 26 * clinometer.shadowM) - 26} y="124" class="viz-lbl gold">s {clinometer.shadowM.toFixed(2)} m</text>
          <path d="M 76 108 A 16 16 0 0 0 76 92" fill="none" stroke="var(--ink-faint)" stroke-width="0.9" />
        </svg>
      </div>

      <div class="row row-wrap">
        <button class="btn btn-primary btn-sm" onclick={measureShadow}>
          <Icon name="compass" size={13} /> Compute off-grid UVI
        </button>
        <button class="btn btn-sm" onclick={useNow}>
          <Icon name="clock" size={13} /> Use ephemeris now
        </button>
      </div>

      {#if shadowReport}
        <div class="shadow-report glass-soft">
          <div class="sr-row">
            <span>Solar elevation</span><strong class="mono">{shadowReport.elevationDeg.toFixed(2)}°</strong>
          </div>
          <div class="sr-row">
            <span>Shadow ratio</span><strong class="mono">{shadowReport.shadowRatio.toFixed(2)}×</strong>
          </div>
          <div class="sr-row">
            <span>Optical air mass</span><strong class="mono">m = {shadowReport.opticalAirMass.toFixed(2)}</strong>
          </div>
          <div class="sr-row">
            <span>Off-grid UV Index</span><strong class="mono gold">{shadowReport.uvIndex.toFixed(2)}</strong>
          </div>
          <div class="sr-row">
            <span>Confidence</span><strong class="mono tiny">{shadowReport.confidence}</strong>
          </div>
        </div>
      {/if}

      {#if sensor}
        <div class="backend tiny">
          <span class="pill {sensor.state.backend === SENSOR_STATES.SIM ? 'warn' : 'ok'}">
            <span class="dot"></span> {sensor.state.backend}
          </span>
          <span class="mono faint">
            lux {sensor.state.lux != null ? fmt(sensor.state.lux, 0) : '—'} ·
            {sensor.state.pressureHpa != null ? fmt(sensor.state.pressureHpa, 1) : '—'} hPa ·
            alt {fmt(sensor.state.altitudeM, 0)} m
          </span>
        </div>
      {/if}
    </Panel>

    <Panel title="Photobiology ledger" sub="Every derived quantity, traceable" icon="M4 19V5M4 19h16">
      <Ledger rows={ledger} dense />
    </Panel>

    {#if alarmLog.length}
      <Panel title="Alarm history" sub="Haptic + chime events this session" icon="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 8v5M12 16v.5" tone="danger">
        <ul class="alarm-list">
          {#each alarmLog as a}
            <li>
              <span class="pill {a.kind === 'spf-reapply' ? 'warn' : a.kind === 'burn-warning' ? 'danger' : 'ok'}">{a.kind}</span>
              <span class="tiny">{a.text}</span>
              <time class="mono tiny faint">{new Date(a.at).toLocaleTimeString()}</time>
            </li>
          {/each}
        </ul>
      </Panel>
    {/if}
  </div>
</div>

<style>
  .solar-hero {
    display: grid;
    grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
    gap: 16px;
    align-items: center;
  }
  .corona-wrap {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 200px;
  }
  .corona {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: var(--r-md);
    opacity: 0.9;
    z-index: 0;
  }
  .corona-fallback {
    position: absolute;
    inset: 0;
    border-radius: var(--r-md);
    background: radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--gold) 22%, transparent), transparent 68%);
    z-index: 0;
  }
  .corona-wrap :global(.dial) {
    position: relative;
    z-index: 1;
  }
  .timers {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .timer-card {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 11px 13px;
    border-radius: var(--r-md);
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    position: relative;
    overflow: hidden;
  }
  .timer-card[data-tone='gold'] {
    border-color: color-mix(in srgb, var(--gold) 34%, transparent);
    background: color-mix(in srgb, var(--gold) 7%, transparent);
  }
  .timer-card[data-tone='danger'] {
    border-color: color-mix(in srgb, var(--danger) 42%, transparent);
    background: color-mix(in srgb, var(--danger) 8%, transparent);
  }
  .timer {
    font-size: 25px;
    font-weight: 660;
    letter-spacing: -0.035em;
    color: var(--ink-strong);
    line-height: 1.06;
  }
  .timer-card[data-tone='gold'] .timer {
    color: var(--gold);
  }
  .timer-card[data-tone='danger'] .timer {
    color: var(--danger);
  }
  .run-row {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    margin-top: 2px;
  }
  .clock {
    margin-left: auto;
    font-size: 11px;
    color: var(--ink-faint);
  }
  .controls {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-top: 14px;
    padding-top: 13px;
    border-top: 1px solid var(--glass-line-soft);
  }
  .selectors {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-top: 12px;
  }
  .sel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 9px;
    border-radius: var(--r-pill);
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    font-size: 10.5px;
    color: var(--ink-muted);
    transition: 220ms;
  }
  .chip em {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--ink-faint);
  }
  .chip:hover {
    color: var(--ink-strong);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .chip.active {
    color: var(--ink-strong);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    border-color: color-mix(in srgb, var(--accent) 54%, transparent);
  }
  .film-row {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 10px;
  }
  .film-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .film-stats .tile {
    padding: 7px 9px;
    gap: 1px;
  }
  .stat-sm small {
    font-size: 9px;
    color: var(--ink-faint);
    font-weight: 400;
  }
  .gold {
    color: var(--gold);
  }
  .reapply-note {
    margin-top: 6px;
    padding-top: 7px;
    border-top: 1px dashed var(--glass-line-soft);
    line-height: 1.5;
  }
  .clin-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin: 9px 0;
  }
  .shadow-viz {
    border-radius: var(--r-sm);
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    padding: 4px;
    margin-bottom: 9px;
  }
  .shadow-viz svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .viz-lbl {
    font-family: var(--font-mono);
    font-size: 8px;
    fill: var(--accent);
  }
  .viz-lbl.gold {
    fill: var(--gold);
  }
  .shadow-report {
    margin-top: 9px;
    padding: 8px 11px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sr-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    font-size: 11.5px;
    color: var(--ink-muted);
    padding: 3px 0;
    border-bottom: 1px dashed var(--glass-line-soft);
  }
  .sr-row:last-child {
    border-bottom: 0;
  }
  .sr-row strong {
    color: var(--ink-strong);
    font-size: 12px;
  }
  .backend {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 9px;
    flex-wrap: wrap;
  }
  .alarm-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .alarm-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
    border-bottom: 1px dashed var(--glass-line-soft);
  }
  .alarm-list li:last-child {
    border-bottom: 0;
  }
  .alarm-list time {
    margin-left: auto;
  }
  @media (max-width: 1240px) {
    .controls {
      grid-template-columns: 1fr 1fr;
    }
    .selectors {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 900px) {
    .solar-hero {
      grid-template-columns: 1fr;
    }
    .clin-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
