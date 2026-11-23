<script>
  /**
   * MODULE 3 · ABCDE Morphometry Caliper  (Pro Tier)
   *
   * Runs real segmentation → image moments → biaxial fold asymmetry →
   * Polsby-Popper compactness → chromatic entropy → calibrated Feret diameter
   * over either the live macro camera or the 4 synthetic dermatoscopic phantoms.
   */
  import { untrack } from 'svelte';
  import { app, LESION_PHANTOMS } from '$lib/db/store.svelte.js';
  import Panel from '../ui/Panel.svelte';
  import Icon from '../ui/Icon.svelte';
  import Ledger from '../ui/Ledger.svelte';
  import Slider from '../ui/Slider.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Gauge from '../ui/Gauge.svelte';
  import {
    analyzeLesion,
    renderLesionPhantom,
    paintSegmentationOverlay,
    imageDataFromCanvas,
    computeEvolution
  } from '$lib/engines/abcd-morphometry.js';
  import {
    openCameraStream,
    closeStream,
    readTrackCaps,
    setTorch
  } from '$lib/engines/camera-optics.js';
  import { alarm } from '$lib/engines/audio-haptics.js';

  let work = $state(null); // the offscreen canvas that holds the ROI
  let overlay = $state(null); // visible canvas (image + contours)
  let phantomId = $state('benign-nevus');
  let source = $state('phantom');
  let result = $state(null);
  let busy = $state(false);
  let pxPerMm = $state(12.5);
  let priorMonths = $state(6);
  let showOverlay = $state(true);
  let videoEl = $state(null);
  let stream = $state(null);
  let cameraState = $state('idle');
  let torchOn = $state(false);
  let torchAvailable = $state(false);

  const phantom = $derived(LESION_PHANTOMS.find((p) => p.id === phantomId) ?? LESION_PHANTOMS[0]);

  const ledger = $derived(
    result?.ok
      ? [
          { label: 'A · Biaxial asymmetry', value: `${result.A.score.toFixed(1)} %`, tone: result.A.score > 20 ? 'warn' : 'ok', hint: 'Non-overlapping area after reflection across both principal axes' },
          { label: 'B · Polsby-Popper index', value: result.B.index.toFixed(2), tone: result.B.index > 1.8 ? 'danger' : result.B.index > 1.3 ? 'warn' : 'ok', hint: 'P² / (4πA) — 1.00 is a perfect circle' },
          { label: 'B · Circularity', value: result.B.circularity.toFixed(2) },
          { label: 'B · Perimeter (calibrated)', value: `${result.B.perimeterMm.toFixed(1)} mm` },
          { label: 'C · Colors present', value: `${result.C.colorsPresent} / 6`, tone: result.C.colorsPresent >= 3 ? 'danger' : result.C.colorsPresent === 2 ? 'warn' : 'ok' },
          { label: 'C · Chromatic entropy', value: result.C.entropy.toFixed(2), unit: 'bits' },
          { label: 'D · Max diameter (Feret)', value: `${result.D.maxMm.toFixed(1)} mm`, tone: result.D.maxMm > 6 ? 'warn' : 'ok' },
          { label: 'D · Equivalent diameter', value: `${result.D.equivalentMm.toFixed(1)} mm` },
          { label: 'D · Lesion area', value: `${result.D.areaMm2.toFixed(1)} mm²` },
          { label: 'Solver', value: `${result.moments.area} px · ${pxPerMm.toFixed(1)} px/mm` }
        ]
      : []
  );

  const evolution = $derived(
    result?.ok && phantom.prior
      ? computeEvolution(
          { maxMm: phantom.prior.radiusMm * 2, areaMm2: Math.PI * phantom.prior.radiusMm ** 2 },
          { maxMm: result.D.maxMm, areaMm2: result.D.areaMm2 },
          priorMonths
        )
      : result?.E ?? null
  );

  /* ---------------------------------------------------------------- render */
  function renderPhantomInto(canvas, spec) {
    const ctx = canvas.getContext('2d');
    canvas.width = 520;
    canvas.height = 400;
    renderLesionPhantom(ctx, canvas.width, canvas.height, { ...spec, pxPerMm });
  }

  function runAnalysis() {
    if (!work || !overlay) return;
    busy = true;
    try {
      const image = imageDataFromCanvas(work);
      const res = analyzeLesion(image, { pxPerMm, label: phantom.label });
      result = res;
      app.setLesion({ result: res, phantomId, source, analyzing: false });

      // paint the visible overlay
      const ctx = overlay.getContext('2d');
      overlay.width = work.width;
      overlay.height = work.height;
      ctx.drawImage(work, 0, 0);
      if (showOverlay && res.ok) {
        paintSegmentationOverlay(ctx, res, 'rgba(6,182,212,0.95)');
        // reticle
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.24)';
        ctx.lineWidth = 0.8;
        const cx = overlay.width / 2;
        const cy = overlay.height / 2;
        for (let r = 40; r < 220; r += 20) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(cx, 8);
        ctx.lineTo(cx, overlay.height - 8);
        ctx.moveTo(8, cy);
        ctx.lineTo(overlay.width - 8, cy);
        ctx.stroke();
        ctx.restore();
      }
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    const id = phantomId;
    const p = pxPerMm;
    void id;
    void p;
    if (source !== 'phantom' || !work) return;
    untrack(() => {
      renderPhantomInto(work, phantom.spec);
      runAnalysis();
    });
  });

  /* ---------------------------------------------------------------- camera */
  async function attachCamera() {
    cameraState = 'requesting';
    try {
      stream = await openCameraStream({ facingMode: 'environment', width: 1280, height: 960 });
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }
      const caps = readTrackCaps(stream);
      torchAvailable = caps.torch;
      cameraState = 'live';
      source = 'camera';
      app.setPermission('camera', 'WEB ACTIVE', 'ABCDE macro ROI active');
      app.toast('Macro stream attached — align the reticle then capture', 'ok');
    } catch (err) {
      cameraState = 'denied';
      app.toast(`Camera restricted: ${err?.message ?? err}`, 'warn');
      app.setPermission('camera', 'SIMULATOR ACTIVE', 'ABCDE phantoms active');
    }
  }

  function detach() {
    closeStream(stream);
    stream = null;
    if (videoEl) videoEl.srcObject = null;
    cameraState = 'idle';
    source = 'phantom';
    torchOn = false;
  }

  async function toggleTorch() {
    if (!stream) return;
    torchOn = !torchOn;
    if (!(await setTorch(stream, torchOn))) torchOn = false;
  }

  function captureFromCamera() {
    if (!work || !videoEl || !videoEl.videoWidth) return;
    const ctx = work.getContext('2d');
    const sw = videoEl.videoWidth;
    const sh = videoEl.videoHeight;
    const side = Math.min(sw, sh) * 0.72;
    work.width = 520;
    work.height = 400;
    ctx.drawImage(
      videoEl,
      (sw - side) / 2,
      (sh - side * 0.77) / 2,
      side,
      side * 0.77,
      0,
      0,
      520,
      400
    );
    runAnalysis();
    alarm('scan-confirm', { haptic: app.hapticEnabled, sound: app.soundEnabled });
  }

  async function saveLesion() {
    if (!result?.ok || !app.vault) return;
    if (!app.vaultState.unlocked) {
      app.openModal('vault');
      return;
    }
    try {
      await app.vault.securePut('lesions', {
        kind: 'abcd-lesion',
        summary: {
          label: result.label,
          diameterMm: result.D.maxMm,
          borderIndex: result.B.index,
          asymmetry: result.A.score,
          colors: result.C.colorsPresent,
          tier: result.risk.tier
        },
        A: result.A,
        B: result.B,
        C: { colorsPresent: result.C.colorsPresent, entropy: result.C.entropy, zones: result.C.zones },
        D: result.D,
        E: evolution,
        risk: result.risk,
        contour: result.contour,
        pxPerMm
      });
      const n = await app.vault.adapter.count('lesions');
      app.setVault({ records: { ...app.vaultState.records, lesions: n } });
      app.toast('Lesion morphometry sealed into the PIN vault', 'ok');
    } catch (err) {
      app.toast(`Vault write failed: ${err?.message ?? err}`, 'danger');
    }
  }

  $effect(() => {
    return () => detach();
  });

  // `showOverlay` is bound in the template (line ~247) as well as read by
  // renderOverlay(), so it is already reactive; no `void` escape hatch needed.
</script>

<div class="grid g-main">
  <Panel
    title="ABCDE Morphometry Caliper"
    sub="Real segmentation · image-moment asymmetry · Polsby-Popper compactness · calibrated Feret diameter"
    icon="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"
    tone="violet"
  >
    {#snippet actions()}
      <span class="pill violet-p"><Icon name="lock" size={10} /> PRO TIER</span>
      <button class="btn btn-sm" onclick={() => (showOverlay = !showOverlay)}>
        <Icon name="eye" size={13} /> {showOverlay ? 'Hide' : 'Show'} contour
      </button>
    {/snippet}

    <div class="stage">
      <canvas bind:this={overlay} class="stage-canvas"></canvas>
      <video bind:this={videoEl} playsinline muted class="stage-video" class:hidden={source !== 'camera'}></video>
      <canvas bind:this={work} class="work" aria-hidden="true"></canvas>

      <div class="stage-tags">
        <span class="telemetry-tag">
          {source === 'camera' ? 'MACRO STREAM' : 'DERMATOSCOPIC PHANTOM'}
        </span>
        <span class="telemetry-tag" style="right:8px">
          {pxPerMm.toFixed(1)} px/mm · 0.1 mm reticle
        </span>
        {#if result?.ok}
          <span class="telemetry-tag" style="left:8px;bottom:8px">
            A {result.A.score.toFixed(0)}% · B {result.B.index.toFixed(2)} · C {result.C.colorsPresent} · D {result.D.maxMm.toFixed(1)} mm
          </span>
        {/if}
        <span class="telemetry-tag" style="right:8px;bottom:8px">
          {result?.risk?.label ?? 'IDLE'}
        </span>
      </div>

      {#if !result?.ok && result?.reason}
        <div class="stage-msg">{result.reason}</div>
      {/if}
    </div>

    <div class="capture-row">
      {#if source === 'camera'}
        <button class="btn btn-primary" onclick={captureFromCamera} disabled={busy}>
          <Icon name="target" size={14} /> Capture &amp; analyse
        </button>
        {#if torchAvailable}
          <button class="btn" class:btn-gold={torchOn} onclick={toggleTorch}><Icon name="bolt" size={13} /> Torch</button>
        {/if}
        <button class="btn" onclick={detach}><Icon name="close" size={13} /> Detach</button>
      {:else}
        <button class="btn btn-primary" onclick={attachCamera} disabled={cameraState === 'requesting'}>
          <Icon name="camera" size={14} /> Use macro camera
        </button>
      {/if}
      <div class="px-mm">
        <Slider
          label="Reticle calibration"
          value={pxPerMm}
          min={4}
          max={40}
          step={0.5}
          digits={1}
          unit="px/mm"
          onchange={(v) => (pxPerMm = v)}
        />
      </div>
    </div>

    <div class="phantom-row">
      {#each LESION_PHANTOMS as p}
        <button
          class="ph-card"
          class:active={phantomId === p.id}
          onclick={() => {
            if (source === 'camera') detach();
            phantomId = p.id;
          }}
        >
          <strong>{p.label}</strong>
          <em>{p.sub}</em>
          <span class="ph-exp mono">
            {#if p.expected}
              {Object.entries(p.expected).map(([k, v]) => `${k} ${v}`).join(' · ')}
            {/if}
          </span>
        </button>
      {/each}
    </div>
  </Panel>

  <div class="stack">
    <Panel title="ABCDE readout" sub="Quantitative morphometry" icon="M4 19V5M4 19h16">
      {#snippet actions()}
        {#if result?.ok}
          <span class="pill {result.risk.tone}">{result.risk.label}</span>
        {/if}
      {/snippet}

      {#if result?.ok}
        <div class="abcd-bars">
          {#each [
            { k: 'A', label: 'Asymmetry', v: result.A.score, max: 100, unit: '%', danger: 35 },
            { k: 'B', label: 'Border (P²/4πA)', v: result.B.index, max: 3, unit: '', danger: 1.8 },
            { k: 'C', label: 'Colors', v: result.C.colorsPresent, max: 6, unit: '/6', danger: 3 },
            { k: 'D', label: 'Diameter', v: result.D.maxMm, max: 12, unit: 'mm', danger: 6 }
          ] as m}
            <div class="ab">
              <span class="ab-key">{m.k}</span>
              <div class="ab-body">
                <div class="ab-head">
                  <span>{m.label}</span>
                  <strong class="mono">{m.v.toFixed(m.k === 'B' ? 2 : 1)}{m.unit}</strong>
                </div>
                <div class="meter" class:danger={m.v >= m.danger} class:warn={m.v < m.danger && m.v > m.danger * 0.6}>
                  <i style="width:{Math.min(100, (m.v / m.max) * 100)}%"></i>
                </div>
              </div>
            </div>
          {/each}
        </div>

        <div class="two-col">
          <div>
            <span class="label">Chromatic zones</span>
            <div class="zones">
              {#each result.C.zones as z}
                <span class="zone" class:present={z.present} title="{z.label} · {z.pct}%">
                  <i style="background:{z.swatch}"></i>
                  <span class="mono">{z.pct.toFixed(0)}%</span>
                </span>
              {/each}
            </div>
          </div>
          <Gauge
            value={result.risk.score}
            max={100}
            size={112}
            label="risk score"
            unit="AUX"
            digits={0}
            tone="auto"
            ticks={24}
          />
        </div>

        {#if evolution}
          <div class="evo">
            <div class="evo-head">
              <span class="unit">E · Longitudinal evolution</span>
              <span class="pill {evolution.tone}">{evolution.verdict}</span>
            </div>
            <div class="evo-stats">
              <div class="tile">
                <span class="unit">Δ diameter</span>
                <strong class="stat-sm" data-tone={evolution.tone}>{evolution.deltaMm > 0 ? '+' : ''}{evolution.deltaMm.toFixed(2)} mm</strong>
              </div>
              <div class="tile">
                <span class="unit">Growth rate</span>
                <strong class="stat-sm">{evolution.growthRateMmPerMonth.toFixed(2)}<small>mm/mo</small></strong>
              </div>
              <div class="tile">
                <span class="unit">Interval</span>
                <strong class="stat-sm">{priorMonths}<small>months</small></strong>
              </div>
            </div>
          </div>
        {/if}

        <div class="row">
          <button class="btn btn-primary btn-sm" onclick={saveLesion}>
            <Icon name={app.vaultState.unlocked ? 'vault' : 'lock'} size={13} />
            {app.vaultState.unlocked ? 'Seal into vault' : 'Unlock vault'}
          </button>
          <button class="btn btn-sm" onclick={runAnalysis}><Icon name="refresh" size={13} /> Re-analyse</button>
        </div>

        <Ledger rows={ledger} dense />
      {:else}
        <div class="empty">
          <Icon name="target" size={26} />
          <p class="tiny">Align a pigmented lesion inside the polar reticle, set the px/mm
            calibration for your camera's macro distance, then capture.</p>
        </div>
      {/if}
    </Panel>

    <Panel title="Polar radius signature" sub="Contour distance from the centroid · 48 angular bins" icon="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z">
      <div class="polar-wrap">
        <svg viewBox="-110 -110 220 220" class="polar" aria-hidden="true">
          <circle r="100" fill="none" stroke="var(--glass-line-soft)" />
          <circle r="70" fill="none" stroke="var(--glass-line-soft)" stroke-dasharray="2 4" />
          <circle r="40" fill="none" stroke="var(--glass-line-soft)" stroke-dasharray="2 4" />
          {#if result?.ok}
            {@const pts = result.polar.radii}
            {@const maxR = Math.max(1, ...pts)}
            <polygon
              points={pts.map((r, i) => {
                const a = (i / pts.length) * Math.PI * 2 - Math.PI / 2;
                const rr = (r / maxR) * 96;
                return `${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr).toFixed(1)}`;
              }).join(' ')}
              fill="color-mix(in srgb, var(--accent) 18%, transparent)"
              stroke="var(--accent)"
              stroke-width="1.8"
            />
            {#each pts as r, i}
              {@const a = (i / pts.length) * Math.PI * 2 - Math.PI / 2}
              {@const rr = (r / maxR) * 96}
              <circle cx={Math.cos(a) * rr} cy={Math.sin(a) * rr} r="1.6" fill="var(--accent)" />
            {/each}
          {/if}
          <circle r="2" fill="var(--ink-faint)" />
        </svg>
        <div class="polar-meta">
          <div class="tile">
            <span class="unit">Radial CV</span>
            <strong class="stat-sm">{result?.ok ? result.polar.cv.toFixed(3) : '—'}</strong>
            <span class="tiny faint">Higher = more scalloped</span>
          </div>
          <div class="tile">
            <span class="unit">Elongation</span>
            <strong class="stat-sm">{result?.ok ? result.moments.elongation.toFixed(2) : '—'}</strong>
            <span class="tiny faint">Major ÷ minor principal axis</span>
          </div>
          <div class="tile">
            <span class="unit">Orientation</span>
            <strong class="stat-sm">{result?.ok ? `${result.moments.orientationDeg.toFixed(0)}°` : '—'}</strong>
            <span class="tiny faint">2nd-order image moment</span>
          </div>
        </div>
      </div>
    </Panel>
  </div>
</div>

<style>
  .stage {
    position: relative;
    border-radius: var(--r-md);
    overflow: hidden;
    background: #06080d;
    border: 1px solid var(--glass-line-soft);
    aspect-ratio: 520 / 400;
  }
  .stage-canvas,
  .stage-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .stage-video.hidden {
    display: none;
  }
  .work {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }
  .stage-tags {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .telemetry-tag {
    position: absolute;
    top: 8px;
    left: 8px;
  }
  .stage-msg {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: rgba(6, 10, 18, 0.82);
    border: 1px solid var(--glass-line);
    border-radius: var(--r-sm);
    padding: 10px 14px;
    font-size: 12px;
    color: var(--ink-muted);
    text-align: center;
    max-width: 80%;
  }
  .capture-row {
    display: flex;
    gap: 10px;
    align-items: flex-end;
    margin-top: 11px;
    flex-wrap: wrap;
  }
  .px-mm {
    flex: 1;
    min-width: 180px;
  }
  .phantom-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 6px;
    margin-top: 11px;
  }
  .ph-card {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    text-align: left;
    transition: 240ms var(--ease-out);
  }
  .ph-card:hover {
    border-color: color-mix(in srgb, var(--accent) 42%, transparent);
    transform: translateY(-1px);
  }
  .ph-card.active {
    border-color: color-mix(in srgb, var(--accent) 68%, transparent);
    background: color-mix(in srgb, var(--accent) 11%, transparent);
  }
  .ph-card strong {
    font-size: 11px;
    color: var(--ink-strong);
    font-weight: 590;
  }
  .ph-card em {
    font-style: normal;
    font-size: 9.5px;
    color: var(--ink-faint);
  }
  .ph-exp {
    font-size: 8.5px;
    color: var(--ink-faint);
    margin-top: 2px;
    line-height: 1.35;
  }
  .abcd-bars {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  }
  .ab {
    display: flex;
    gap: 9px;
    align-items: center;
  }
  .ab-key {
    width: 22px;
    height: 22px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 640;
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    flex: none;
  }
  .ab-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .ab-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 11px;
    color: var(--ink-muted);
  }
  .ab-head strong {
    font-size: 12px;
    color: var(--ink-strong);
  }
  .two-col {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .two-col > div:first-child {
    flex: 1;
    min-width: 150px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .zones {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .zone {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px;
    border-radius: 6px;
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    opacity: 0.42;
    transition: 240ms;
  }
  .zone.present {
    opacity: 1;
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .zone i {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    display: block;
  }
  .zone span {
    font-size: 9px;
    color: var(--ink-muted);
  }
  .evo {
    border: 1px solid var(--glass-line-soft);
    border-radius: var(--r-sm);
    padding: 9px 11px;
    background: var(--glass-bg-soft);
    margin-bottom: 11px;
  }
  .evo-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 7px;
    flex-wrap: wrap;
  }
  .evo-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .evo-stats .tile {
    padding: 6px 8px;
  }
  .stat-sm[data-tone='ok'] {
    color: var(--ok);
  }
  .stat-sm[data-tone='warn'] {
    color: var(--warn);
  }
  .stat-sm[data-tone='danger'] {
    color: var(--danger);
  }
  .stat-sm small {
    font-size: 9px;
    color: var(--ink-faint);
    font-weight: 400;
    margin-left: 2px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 26px 14px;
    color: var(--ink-faint);
    text-align: center;
  }
  .polar-wrap {
    display: flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
  }
  .polar {
    width: 190px;
    flex: none;
    overflow: visible;
  }
  .polar-meta {
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex: 1;
    min-width: 130px;
  }
  .polar-meta .tile {
    padding: 6px 9px;
    gap: 0;
  }
</style>
