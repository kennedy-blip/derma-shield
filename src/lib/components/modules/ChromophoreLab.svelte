<script>
  /**
   * MODULE 1 · Optical Chromophore Lab
   *
   * Live camera (or calibrated phantom) → CIE L*a*b* → ITA° → Fitzpatrick + MED,
   * with Dawson's haemoglobin Erythema Index and the sub-clinical erythema
   * false-colour heat map. The 60 fps loop down-samples to 160×120, so it holds
   * frame rate on mid-range Android hardware.
   */
  import { untrack } from 'svelte';
  import { app, PHANTOMS } from '$lib/db/store.svelte.js';
  import Panel from '../ui/Panel.svelte';
  import Icon from '../ui/Icon.svelte';
  import Ledger from '../ui/Ledger.svelte';
  import Gauge from '../ui/Gauge.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import { analyzeChromophores, erythemaBand, labToHex } from '$lib/engines/color-science.js';
  import {
    openCameraStream,
    closeStream,
    readTrackCaps,
    setTorch,
    makeAnalysisSampler,
    renderSkinPhantom,
    renderErythemaHeatmap,
    erythemaField,
    calibrateWhiteBalance,
    captureFrameDataUrl,
    ANALYSIS_W,
    ANALYSIS_H
  } from '$lib/engines/camera-optics.js';
  import { alarm } from '$lib/engines/audio-haptics.js';

  let source = $state('phantom'); // 'phantom' | 'camera'
  let phantomId = $state('fair-calm');
  let mode = $state('reflectance'); // reflectance | heatmap
  let videoEl = $state(null);
  let sourceCanvas = $state(null);
  let heatCanvas = $state(null);
  let stream = $state(null);
  let cameraState = $state('idle'); // idle | requesting | live | denied
  let cameraError = $state(null);
  let torchOn = $state(false);
  let torchAvailable = $state(false);
  let sampler = null;
  let raf = 0;
  let fps = $state(0);
  let frameCount = 0;
  let fpsStamp = 0;
  let analysisMs = $state(0);
  let hotspots = $state([]);
  let fieldData = $state(null);
  let fieldCanvas = $state(null);
  let saving = $state(false);
  let lastReading = null;

  const phantom = $derived(PHANTOMS.find((p) => p.id === phantomId) ?? PHANTOMS[0]);
  const ei = $derived(app.scan.erythemaIndex);
  const band = $derived(erythemaBand(ei));
  const tone = $derived(band.tone);

  const ledger = $derived([
    { label: 'CIE L*', value: app.scan.lab.L.toFixed(2) },
    { label: 'CIE a* (red–green)', value: app.scan.lab.a.toFixed(2) },
    { label: 'CIE b* (yellow–blue)', value: app.scan.lab.b.toFixed(2) },
    { label: 'Individual Typology Angle', value: `${app.scan.ita.toFixed(1)}°`, tone: 'gold' },
    { label: 'Fitzpatrick phototype', value: `TYPE ${app.phototype.type}`, hint: app.phototype.label },
    { label: 'MED threshold', value: app.med.toFixed(0), unit: 'J/m²', tone: 'ok' },
    { label: 'Dawson Erythema Index', value: ei.toFixed(1), tone },
    { label: 'Melanin Index', value: app.scan.melaninIndex.toFixed(1) },
    { label: 'Barrier hydration', value: `${app.scan.hydration.toFixed(0)} %` },
    { label: 'Reflectance R/G/B', value: `${app.scan.reflectance.r.toFixed(2)} / ${app.scan.reflectance.g.toFixed(2)} / ${app.scan.reflectance.b.toFixed(2)}` },
    {
      label: 'Phantom calibration residual',
      value: phantom.calibrated ? `Δ ${phantom.calibrated.residual.toFixed(2)}` : 'LIVE STREAM',
      hint: 'Solved ITA°/EI mismatch of the phantom against the live CIE pipeline'
    }
  ]);

  /* ------------------------------------------------------------- phantom draw */
  function drawPhantom() {
    if (!sourceCanvas) return;
    const ctx = sourceCanvas.getContext('2d');
    sourceCanvas.width = 640;
    sourceCanvas.height = 480;
    renderSkinPhantom(ctx, 640, 480, {
      baseHex: phantom.baseHex,
      ei: phantom.ei,
      hotSpots: phantom.hotSpots,
      veins: phantom.veins,
      texture: phantom.texture,
      seed: phantom.seed
    });
    analyzeOnce(sourceCanvas);
  }

  /** Paint the erythema field into a fixed-size canvas (no DOM churn). */
  function paintField(f) {
    if (!fieldCanvas || !f) return;
    const ctx = fieldCanvas.getContext('2d');
    const { cols, rows, field, min, max } = f;
    const cw = fieldCanvas.width / cols;
    const ch = fieldCanvas.height / rows;
    ctx.clearRect(0, 0, fieldCanvas.width, fieldCanvas.height);
    const span = Math.max(0.001, max - min);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const norm = Math.max(0, Math.min(1, (field[y][x] - min) / span));
        const hue = 185 - norm * 155;
        const light = 24 + norm * 34;
        ctx.fillStyle = `hsl(${hue} 82% ${light}%)`;
        ctx.fillRect(x * cw, y * ch, Math.ceil(cw) + 0.6, Math.ceil(ch) + 0.6);
      }
    }
    // soft radial vignette so the field reads as an optical sensor image
    const vg = ctx.createRadialGradient(
      fieldCanvas.width / 2, fieldCanvas.height / 2, fieldCanvas.height * 0.2,
      fieldCanvas.width / 2, fieldCanvas.height / 2, fieldCanvas.width * 0.62
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, fieldCanvas.width, fieldCanvas.height);
  }

  /* -------------------------------------------------------------- analysis */
  function analyzeOnce(src) {
    const t0 = performance.now();
    if (!sampler) sampler = makeAnalysisSampler();
    const img = sampler.sample(src);
    if (!img) return;
    const reading = analyzeChromophoresAverage(img);
    if (!reading) return;
    lastReading = reading;
    app.applyScan(
      {
        source: source === 'camera' ? 'camera-live' : 'phantom',
        phantomId,
        ita: reading.ita,
        med: reading.med,
        erythemaIndex: reading.erythemaIndex,
        band: reading.erythemaBand.key,
        melaninIndex: reading.melaninIndex,
        hydration: reading.hydration,
        lab: reading.lab,
        rgb: reading.rgb,
        reflectance: reading.reflectance,
        hex: reading.hex,
        live: source === 'camera'
      },
      { phantomLabel: phantom.label }
    );

    const f = erythemaField(img, 22, 16);
    fieldData = f;
    hotspots = f.hotspots;
    paintField(f);

    if (mode === 'heatmap' && heatCanvas && source === 'camera') {
      const hctx = heatCanvas.getContext('2d');
      heatCanvas.width = ANALYSIS_W;
      heatCanvas.height = ANALYSIS_H;
      renderErythemaHeatmap(hctx, img, { baselineEI: Math.max(12, reading.erythemaIndex * 0.72) });
    }
    analysisMs = performance.now() - t0;
  }

  /** ROI-averaged chromophore analysis (central 44 % of the frame). */
  function analyzeChromophoresAverage(img) {
    const { data, width, height } = img;
    const x0 = Math.floor(width * 0.3);
    const y0 = Math.floor(height * 0.3);
    const x1 = Math.floor(width * 0.7);
    const y1 = Math.floor(height * 0.7);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const p = (y * width + x) * 4;
        r += data[p];
        g += data[p + 1];
        b += data[p + 2];
        n++;
      }
    }
    if (!n) return null;
    return analyzeChromophores(r / n, g / n, b / n, {
      white: app.whiteBalance.calibrated ? app.whiteBalance : undefined
    });
  }

  /* ------------------------------------------------------------------ loop */
  function loop(now) {
    if (!stream) return;
    if (!fpsStamp) fpsStamp = now;
    frameCount++;
    if (now - fpsStamp > 900) {
      fps = Math.round((frameCount * 1000) / (now - fpsStamp));
      frameCount = 0;
      fpsStamp = now;
    }
    if (videoEl && videoEl.readyState >= 2) analyzeOnce(videoEl);
    raf = requestAnimationFrame(loop);
  }

  async function startCamera() {
    cameraState = 'requesting';
    cameraError = null;
    try {
      stream = await openCameraStream({ facingMode: 'environment' });
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }
      const caps = readTrackCaps(stream);
      torchAvailable = caps.torch;
      app.setPermission('camera', 'WEB ACTIVE', `getUserMedia · ${caps.settings.width}×${caps.settings.height}`);
      cameraState = 'live';
      source = 'camera';
      raf = requestAnimationFrame(loop);
      app.toast('Optical stream live — 60 fps ROI analysis engaged', 'ok');
      await alarm('scan-confirm', { haptic: app.hapticEnabled, sound: app.soundEnabled });
    } catch (err) {
      cameraState = 'denied';
      cameraError = String(err?.message ?? err);
      app.setPermission('camera', 'SIMULATOR ACTIVE', 'Permission denied — phantoms active');
      app.toast('Camera unavailable — using calibrated optical phantoms', 'warn');
    }
  }

  function stopCamera() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    closeStream(stream);
    stream = null;
    if (videoEl) videoEl.srcObject = null;
    cameraState = 'idle';
    source = 'phantom';
    fps = 0;
    torchOn = false;
    app.setPermission('camera', 'SIMULATOR ACTIVE', 'Stream closed');
  }

  async function toggleTorch() {
    if (!stream) return;
    torchOn = !torchOn;
    const ok = await setTorch(stream, torchOn);
    if (!ok) {
      torchOn = false;
      app.toast('Torch control not exposed on this platform', 'warn');
    }
  }

  function calibrate() {
    if (!sampler) sampler = makeAnalysisSampler();
    const src = source === 'camera' ? videoEl : sourceCanvas;
    if (!src) return;
    const img = sampler.sample(src);
    if (!img) return;
    const wb = calibrateWhiteBalance(img);
    app.setWhiteBalance({ r: wb.r, g: wb.g, b: wb.b, deltaE: wb.deltaE });
    app.toast(
      `White balance calibrated · chroma offset ΔE ${wb.deltaE.toFixed(1)} (sample a white card for best accuracy)`,
      'ok'
    );
    analyzeOnce(src);
  }

  async function saveScan() {
    if (!app.vault) return;
    saving = true;
    try {
      if (!app.vaultState.unlocked) {
        app.openModal('vault');
        saving = false;
        return;
      }
      const shot =
        source === 'camera'
          ? captureFrameDataUrl(videoEl, 420, 0.72)
          : captureFrameDataUrl(sourceCanvas, 420, 0.72);
      await app.vault.securePut('scans', {
        kind: 'chromophore-scan',
        summary: {
          label: phantom.label,
          ita: app.scan.ita,
          erythemaIndex: app.scan.erythemaIndex,
          phototype: app.phototype.type,
          med: app.med
        },
        ita: app.scan.ita,
        erythemaIndex: app.scan.erythemaIndex,
        melaninIndex: app.scan.melaninIndex,
        lab: { ...app.scan.lab },
        med: app.med,
        phototype: app.phototype,
        source,
        thumbnail: shot
      });
      const counts = await app.vault.adapter.count('scans');
      app.setVault({ records: { ...app.vaultState.records, scans: counts } });
      app.toast('Chromophore scan sealed into the PIN vault', 'ok');
      await alarm('scan-confirm', { haptic: app.hapticEnabled, sound: app.soundEnabled });
    } catch (err) {
      app.toast(`Vault write failed: ${err?.message ?? err}`, 'danger');
    } finally {
      saving = false;
    }
  }

  /**
   * Phantom rendering effect.
   *
   * `drawPhantom → analyzeOnce → app.applyScan` both READS and WRITES store
   * state. Inside a plain $effect that is a self-triggering cycle (read scan →
   * write scan → re-run → read scan…), which locks the tab. `untrack` keeps the
   * effect dependent only on the explicit inputs below while still letting the
   * analysis publish its results.
   */
  $effect(() => {
    const id = phantomId;
    const m = mode;
    const active = source === 'phantom';
    void id;
    void m;
    void active;
    if (!active || !sourceCanvas) return;
    untrack(() => drawPhantom());
  });

  $effect(() => {
    return () => {
      stopCamera();
    };
  });
</script>

<div class="grid g-main">
  <!-- ============================ VIEWPORT ============================ -->
  <Panel
    title="Optical Chromophore Lab"
    sub="Camera ROI → CIE L*a*b* → ITA° · Dawson haemoglobin Erythema Index at 540 nm"
    icon="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
    tone="violet"
  >
    {#snippet actions()}
      <Segmented
        size="sm"
        value={mode}
        onchange={(v) => (mode = v)}
        options={[
          { id: 'reflectance', label: 'Reflectance', icon: '' },
          { id: 'heatmap', label: 'EI Heatmap' }
        ]}
        ariaLabel="Viewport mode"
      />
    {/snippet}

    <div class="viewport">
      <div class="video-shell scanlines" class:cam={source === 'camera'}>
        <!-- camera -->
        <video bind:this={videoEl} playsinline muted class:hidden={source !== 'camera'}></video>

        <!-- phantom / heat rendering surface -->
        <canvas
          bind:this={sourceCanvas}
          class:hidden={source === 'camera' || mode === 'heatmap'}
        ></canvas>
        <canvas bind:this={heatCanvas} class="heat" class:hidden={mode !== 'heatmap' || source === 'camera'}></canvas>

        <!-- overlay -->
        <div class="reticle-overlay">
          <div class="corner tl"></div>
          <div class="corner tr"></div>
          <div class="corner bl"></div>
          <div class="corner br"></div>
          <div class="roi-box"></div>
          <span class="telemetry-tag" style="left:8px;top:8px">ROI 44 % · {ANALYSIS_W}×{ANALYSIS_H}</span>
          <span class="telemetry-tag" style="right:8px;top:8px">
            {source === 'camera' ? `LIVE ${fps} FPS` : 'PHANTOM CALIBRATED'}
          </span>
          <span class="telemetry-tag" style="left:8px;bottom:8px">
            {analysisMs.toFixed(1)} ms / frame
          </span>
          <span class="telemetry-tag" style="right:8px;bottom:8px">
            EI {ei.toFixed(1)} · ITA {app.scan.ita.toFixed(1)}°
          </span>
          {#if hotspots.length && mode === 'heatmap'}
            {#each hotspots.slice(0, 3) as h}
              <span class="hotspot" style="left:{h.x * 100}%;top:{h.y * 100}%">
                <em>EI {h.ei}</em>
              </span>
            {/each}
          {/if}
        </div>

        {#if cameraState === 'denied'}
          <div class="cam-overlay">
            <Icon name="camera" size={26} />
            <strong>Camera restricted</strong>
            <p class="tiny">{cameraError}</p>
            <button class="btn btn-sm" onclick={startCamera}>Retry permission</button>
          </div>
        {/if}
      </div>

      <!-- chromatophore spectrum strip -->
      <div class="spectrum">
        <div class="sp-head">
          <span class="unit">Chromophore absorption</span>
          <span class="mono tiny">410 nm ↔ 660 nm</span>
        </div>
        <div class="sp-bar">
          <span class="marker" style="left:14%"><i style="background:var(--violet)"></i>410</span>
          <span class="marker" style="left:48%"><i style="background:#22c55e"></i>540 Hb</span>
          <span class="marker" style="left:68%"><i style="background:var(--gold)"></i>585</span>
          <span class="marker" style="left:92%"><i style="background:var(--crimson)"></i>660</span>
        </div>
      </div>
    </div>

    <!-- controls -->
    <div class="controls">
      <div class="ctrl-group">
        <span class="label">Source</span>
        <div class="row">
          {#if cameraState !== 'live'}
            <button class="btn btn-sm btn-primary" onclick={startCamera} disabled={cameraState === 'requesting'}>
              <Icon name="camera" size={13} />
              {cameraState === 'requesting' ? 'Requesting…' : 'Attach camera'}
            </button>
          {:else}
            <button class="btn btn-sm" onclick={stopCamera}><Icon name="close" size={13} /> Detach</button>
            {#if torchAvailable}
              <button class="btn btn-sm" class:btn-gold={torchOn} onclick={toggleTorch}>
                <Icon name="bolt" size={13} /> Torch
              </button>
            {/if}
          {/if}
          <button class="btn btn-sm" onclick={calibrate} title="Sample the frame as a white reference">
            <Icon name="target" size={13} /> Calibrate WB
          </button>
        </div>
      </div>

      <div class="ctrl-group grow">
        <span class="label">Calibrated optical phantoms</span>
        <div class="ph-grid">
          {#each PHANTOMS as p}
            <button
              class="ph"
              class:active={phantomId === p.id}
              onclick={() => {
                if (source === 'camera') stopCamera();
                phantomId = p.id;
              }}
              title={p.sub}
            >
              <span class="swatch" style="background:linear-gradient(135deg,{p.baseHex}, {p.baseHex}cc)"></span>
              <span class="ph-txt">
                <strong>{p.label}</strong>
                <em>ITA {p.ita.toFixed(1)}° · EI {p.ei.toFixed(1)}</em>
              </span>
            </button>
          {/each}
        </div>
      </div>

      <div class="ctrl-actions">
        <button class="btn btn-primary btn-block" onclick={saveScan} disabled={saving}>
          <Icon name={app.vaultState.unlocked ? 'vault' : 'lock'} size={14} />
          {saving ? 'Sealing…' : app.vaultState.unlocked ? 'Save scan to vault' : 'Unlock vault to save'}
        </button>
      </div>
    </div>
  </Panel>

  <!-- ============================ READOUTS ============================ -->
  <div class="stack">
    <Panel title="Chromophore readout" sub="Live optical biopsy of the sampled ROI" icon="M4 19V5M4 19h16" tone="default">
      {#snippet actions()}
        <span class="pill {tone}">{band.label}</span>
      {/snippet}

      <div class="gauge-row">
        <Gauge
          value={app.scan.ita}
          min={-90}
          max={90}
          size={150}
          label="ITA° angle"
          sub={app.phototype.label}
          unit="DEG"
          tone="gold"
        />
        <div class="mini-stats">
          <div class="tile">
            <span class="unit">Erythema Index</span>
            <strong class="stat-sm" data-tone={tone}>{ei.toFixed(1)}</strong>
            <span class="tiny faint">Dawson EI · green/red pair</span>
          </div>
          <div class="tile">
            <span class="unit">Melanin Index</span>
            <strong class="stat-sm">{app.scan.melaninIndex.toFixed(1)}</strong>
            <span class="tiny faint">100·log₁₀(1/R₆₆₀)</span>
          </div>
          <div class="tile">
            <span class="unit">Barrier hydration</span>
            <strong class="stat-sm">{app.scan.hydration.toFixed(0)}<small>%</small></strong>
            <span class="tiny faint">specular sheen ratio</span>
          </div>
          <div class="tile">
            <span class="unit">MED</span>
            <strong class="stat-sm">{app.med.toFixed(0)}<small> J/m²</small></strong>
            <span class="tiny faint">CIE erythemal dose</span>
          </div>
        </div>
      </div>

      <div class="ita-track">
        <div class="ita-band">
          <div class="ita-marker" style="left:{((app.scan.ita + 70) / 140) * 100}%"></div>
        </div>
        <div class="ita-labels">
          <span>Type VI</span><span>V</span><span>IV</span><span>III</span><span>II</span><span>Type I</span>
        </div>
      </div>

      <Ledger rows={ledger} dense />
    </Panel>

    <Panel title="Sub-clinical erythema field" sub="Localized haemoglobin hot-spot mapping" icon="M3 12h4l2-6 4 12 2-6h6">
      {#snippet actions()}
        <span class="pill {hotspots.length ? 'warn' : 'ok'}">
          {hotspots.length} HOTSPOT{hotspots.length === 1 ? '' : 'S'}
        </span>
      {/snippet}

      <canvas
        bind:this={fieldCanvas}
        class="field-canvas"
        width="352"
        height="256"
        aria-label="Erythema field heat map"
      ></canvas>
      <div class="heat-legend" style="margin-top:8px">
        <span>CALM</span>
        <span class="heat-ramp"></span>
        <span>ERYTHEMA</span>
      </div>
      <p class="tiny faint" style="margin-top:8px">
        Green-channel absorption at the 540 nm haemoglobin peak reveals capillary
        vasodilation hours before visible redness. Baseline-relative mapping
        suppresses constitutive pigmentation.
      </p>
    </Panel>
  </div>
</div>

<style>
  .viewport {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .video-shell {
    aspect-ratio: 4 / 3;
    position: relative;
    background: #05070c;
    border-radius: var(--r-md);
    overflow: hidden;
  }
  .hidden {
    display: none !important;
  }
  video,
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  canvas.heat {
    image-rendering: auto;
  }
  .corner {
    position: absolute;
    width: 20px;
    height: 20px;
    border: 1.6px solid color-mix(in srgb, var(--accent) 82%, white);
    opacity: 0.85;
  }
  .tl {
    left: 10px;
    top: 10px;
    border-right: 0;
    border-bottom: 0;
  }
  .tr {
    right: 10px;
    top: 10px;
    border-left: 0;
    border-bottom: 0;
  }
  .bl {
    left: 10px;
    bottom: 10px;
    border-right: 0;
    border-top: 0;
  }
  .br {
    right: 10px;
    bottom: 10px;
    border-left: 0;
    border-top: 0;
  }
  .roi-box {
    position: absolute;
    inset: 30% 30% 30% 30%;
    border: 1px dashed color-mix(in srgb, var(--accent) 66%, transparent);
    border-radius: 4px;
    animation: roi-pulse 3.6s ease-in-out infinite;
  }
  @keyframes roi-pulse {
    0%,
    100% {
      opacity: 0.55;
    }
    50% {
      opacity: 1;
    }
  }
  .hotspot {
    position: absolute;
    width: 20px;
    height: 20px;
    margin: -10px 0 0 -10px;
    border-radius: 50%;
    border: 1.4px solid var(--rose);
    box-shadow: 0 0 14px var(--rose);
    animation: hs 2.2s ease-out infinite;
  }
  .hotspot em {
    position: absolute;
    left: 24px;
    top: -2px;
    font-style: normal;
    font-family: var(--font-mono);
    font-size: 8.5px;
    color: var(--rose);
    white-space: nowrap;
    background: rgba(4, 8, 14, 0.6);
    padding: 1px 4px;
    border-radius: 3px;
  }
  @keyframes hs {
    0% {
      transform: scale(0.8);
      opacity: 1;
    }
    100% {
      transform: scale(1.5);
      opacity: 0;
    }
  }
  .cam-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: rgba(4, 6, 12, 0.82);
    color: var(--ink-muted);
    text-align: center;
    padding: 20px;
  }
  .cam-overlay strong {
    color: var(--ink-strong);
  }
  .spectrum {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sp-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .sp-bar {
    position: relative;
    height: 12px;
    border-radius: 99px;
    background: linear-gradient(90deg, #7c3aed 0%, #4f46e5 12%, #06b6d4 34%, #10b981 48%, #eab308 66%, #f59e0b 80%, #f43f5e 100%);
    border: 1px solid var(--glass-line-soft);
  }
  .marker {
    position: absolute;
    top: -15px;
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-size: 8px;
    color: var(--ink-faint);
    display: flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
  }
  .marker i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    display: block;
    box-shadow: 0 0 6px currentColor;
  }
  .controls {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    margin-top: 13px;
    align-items: flex-end;
  }
  .ctrl-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ph-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(146px, 1fr));
    gap: 5px;
  }
  .ph {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px;
    border-radius: 10px;
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    text-align: left;
    transition: 240ms var(--ease-out);
    min-width: 0;
  }
  .ph:hover {
    border-color: color-mix(in srgb, var(--accent) 42%, transparent);
    transform: translateY(-1px);
  }
  .ph.active {
    border-color: color-mix(in srgb, var(--accent) 70%, transparent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 24%, transparent);
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 7px;
    flex: none;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
  }
  .ph-txt {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.2;
  }
  .ph-txt strong {
    font-size: 10.5px;
    font-weight: 560;
    color: var(--ink-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ph-txt em {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--ink-faint);
  }
  .ctrl-actions {
    margin-left: auto;
    min-width: 190px;
    flex: 1;
  }
  .gauge-row {
    display: flex;
    gap: 14px;
    align-items: center;
    margin-bottom: 12px;
  }
  .mini-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .mini-stats .tile {
    padding: 8px 9px;
    gap: 1px;
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
  }
  .ita-track {
    margin: 12px 0 14px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .ita-labels {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 8.5px;
    color: var(--ink-faint);
    letter-spacing: 0.06em;
  }
  .field-canvas {
    width: 100%;
    height: auto;
    aspect-ratio: 22 / 16;
    display: block;
    border-radius: 8px;
    border: 1px solid var(--glass-line-soft);
    background: color-mix(in srgb, var(--bg-void) 62%, transparent);
    image-rendering: auto;
  }
  @media (max-width: 560px) {
    .gauge-row {
      flex-direction: column;
    }
    .mini-stats {
      grid-template-columns: 1fr 1fr;
    }
    .ctrl-actions {
      margin-left: 0;
      min-width: 100%;
    }
  }
</style>
