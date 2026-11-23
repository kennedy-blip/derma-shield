<script>
  /** Mission-control hero strip with live verdict and quick actions. */
  import { app } from '$lib/db/store.svelte.js';
  import Icon from '../ui/Icon.svelte';

  let { onModule = () => {}, onReport = () => {} } = $props();

  const uvi = $derived(app.solar.uvIndex);
  const verdict = $derived.by(() => {
    const ei = app.scan.erythemaIndex;
    if (uvi >= 9 || ei >= 42)
      return {
        tone: 'danger',
        title: 'Erythemal risk — limit exposure now',
        body: 'UV Index is in the extreme band and/or a sub-clinical erythema spike is detected. Shade, cover, reapply SPF 50+, and cool the skin.'
      };
    if (uvi >= 6 || ei >= 33)
      return {
        tone: 'warn',
        title: 'High UV — short, protected window only',
        body: 'Vitamin D3 synthesis is efficient but the burn clock is running. Aim for the calculated window, then cover up or reapply.'
      };
    if (uvi >= 3)
      return {
        tone: 'ok',
        title: 'Moderate UV — ideal dosimetry conditions',
        body: 'Both the vitamin D3 target and a safe erythemal margin are reachable. Track the timers and keep the film topped up.'
      };
    return {
      tone: 'ok',
      title: 'Low UV — minimal synthesis, no burn risk',
      body: 'UVB is too weak for meaningful previtamin D3 in most phototypes. Consider dietary/supplement sources; no photoprotection stress.'
    };
  });
</script>

<section class="hero glass" aria-labelledby="hero-title">
  <div class="hero-bg" aria-hidden="true">
    <span class="orb o1"></span>
    <span class="orb o2"></span>
    <span class="orb o3"></span>
    <span class="scan"></span>
  </div>

  <div class="hero-content">
    <div class="hero-left">
      <span class="eyebrow">Day 17 · Polyglot Photobiology Instrument</span>
      <h1 id="hero-title" class="display">
        Optical dosimetry for<br />skin, sun &amp; vitamin D3
      </h1>
      <p class="lede">
        A calibrated ITA° melanin &amp; haemoglobin erythema scanner, a solar UV vs.
        previtamin-D3 dosimeter, an ABCDE lesion morphometry caliper and an offline
        sunscreen photostability auditor — Svelte + JavaScript + Python 3.12 + Kotlin + GLSL,
        zero TypeScript.
      </p>

      <div class="hero-actions">
        <button class="btn btn-primary" onclick={() => onModule('solar')}>
          <Icon name="sun" size={15} /> Open solar dosimeter
        </button>
        <button class="btn" onclick={() => onModule('chromophore')}>
          <Icon name="microscope" size={15} /> Scan skin optics
        </button>
        <button class="btn btn-ghost" onclick={onReport}>
          <Icon name="graph" size={15} /> Optics report
        </button>
      </div>

      <div class="hero-stats">
        <div class="hs">
          <span class="unit">Fitzpatrick</span>
          <strong class="mono">TYPE {app.phototype.type}</strong>
          <em>{app.phototype.label}</em>
        </div>
        <div class="hs">
          <span class="unit">ITA° angle</span>
          <strong class="mono">{app.scan.ita.toFixed(1)}°</strong>
          <em>Chardon 1991</em>
        </div>
        <div class="hs">
          <span class="unit">MED threshold</span>
          <strong class="mono">{app.med.toFixed(0)}</strong>
          <em>J/m² CIE erythema</em>
        </div>
        <div class="hs">
          <span class="unit">Erythema index</span>
          <strong class="mono" class:crimson={app.scan.erythemaIndex > 35}>
            {app.scan.erythemaIndex.toFixed(1)}
          </strong>
          <em>Dawson EI · 540 nm</em>
        </div>
      </div>
    </div>

    <aside class="verdict" data-tone={verdict.tone}>
      <div class="v-head">
        <span class="dot live"></span>
        <span class="unit">Live verdict</span>
        <span class="pill {verdict.tone === 'danger' ? 'danger' : verdict.tone === 'warn' ? 'warn' : 'ok'}">UVI {uvi.toFixed(1)}</span>
      </div>
      <h2>{verdict.title}</h2>
      <p>{verdict.body}</p>
      <dl class="v-grid">
        <div>
          <dt>Vitamin D3 window</dt>
          <dd class="mono">{app.timers.running ? 'RUNNING' : 'STANDBY'}</dd>
        </div>
        <div>
          <dt>Safe exposure</dt>
          <dd class="mono">{app.solar.spf > 1 ? `SPF ${app.solar.spf}` : 'UNPROTECTED'}</dd>
        </div>
        <div>
          <dt>Surface albedo</dt>
          <dd class="mono">+{Math.round(app.solar.albedo * 100)} %</dd>
        </div>
        <div>
          <dt>Altitude</dt>
          <dd class="mono">{app.solar.altitudeM.toFixed(0)} m</dd>
        </div>
      </dl>
      <div class="v-foot tiny">
        <Icon name="shield" size={12} />
        Clinical screening aid — not a diagnosis. Seek a dermatologist for suspicious lesions.
      </div>
    </aside>
  </div>
</section>

<style>
  .hero {
    position: relative;
    overflow: hidden;
    border-radius: var(--r-xl);
    padding: clamp(18px, 2.6vw, 34px);
  }
  .hero-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(46px);
    opacity: 0.6;
    animation: float 22s ease-in-out infinite;
  }
  .o1 {
    width: 46%;
    aspect-ratio: 1;
    left: -8%;
    top: -34%;
    background: radial-gradient(circle, color-mix(in srgb, var(--cyan) 45%, transparent), transparent 68%);
  }
  .o2 {
    width: 34%;
    aspect-ratio: 1;
    right: 6%;
    top: -22%;
    background: radial-gradient(circle, color-mix(in srgb, var(--violet) 40%, transparent), transparent 68%);
    animation-delay: -7s;
  }
  .o3 {
    width: 40%;
    aspect-ratio: 1;
    right: -6%;
    bottom: -40%;
    background: radial-gradient(circle, color-mix(in srgb, var(--gold) 32%, transparent), transparent 68%);
    animation-delay: -13s;
  }
  .scan {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      180deg,
      transparent 0%,
      color-mix(in srgb, var(--accent) 7%, transparent) 48%,
      transparent 52%
    );
    background-size: 100% 220%;
    animation: sweep 9s linear infinite;
    opacity: 0.7;
  }
  @keyframes float {
    0%,
    100% {
      transform: translate3d(0, 0, 0) scale(1);
    }
    50% {
      transform: translate3d(4%, 6%, 0) scale(1.12);
    }
  }
  @keyframes sweep {
    from {
      background-position: 0 -120%;
    }
    to {
      background-position: 0 120%;
    }
  }
  .hero-content {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.85fr);
    gap: clamp(16px, 2.4vw, 30px);
    align-items: start;
  }
  .hero-left {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 2px;
  }
  .hero-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-top: 6px;
  }
  .hs {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--glass-line-soft);
    background: var(--glass-bg-soft);
    min-width: 0;
  }
  .hs strong {
    font-size: 15px;
    font-weight: 620;
    color: var(--ink-strong);
    letter-spacing: -0.01em;
  }
  .hs em {
    font-style: normal;
    font-size: 9.5px;
    color: var(--ink-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .verdict {
    border-radius: var(--r-lg);
    padding: 16px;
    border: 1px solid var(--glass-line);
    background: color-mix(in srgb, var(--glass-bg-strong) 88%, transparent);
    display: flex;
    flex-direction: column;
    gap: 9px;
    box-shadow: inset 0 1px 1px var(--specular);
    position: relative;
    overflow: hidden;
  }
  .verdict::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
    box-shadow: 0 0 16px var(--accent);
  }
  .verdict[data-tone='warn']::before {
    background: var(--warn);
    box-shadow: 0 0 16px var(--warn);
  }
  .verdict[data-tone='danger']::before {
    background: var(--danger);
    box-shadow: 0 0 18px var(--danger);
  }
  .v-head {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .v-head .unit {
    flex: 1;
  }
  .verdict h2 {
    font-size: 16px;
    line-height: 1.24;
    letter-spacing: -0.015em;
  }
  .verdict p {
    font-size: 12.5px;
    color: var(--ink-muted);
    line-height: 1.5;
  }
  .v-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin: 2px 0 0;
  }
  .v-grid > div {
    display: flex;
    flex-direction: column;
    padding: 6px 8px;
    border-radius: 8px;
    background: var(--glass-bg-soft);
    border: 1px solid var(--glass-line-soft);
  }
  .v-grid dt {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--ink-faint);
    font-family: var(--font-mono);
  }
  .v-grid dd {
    margin: 0;
    font-size: 12px;
    font-weight: 620;
    color: var(--ink-strong);
  }
  .v-foot {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    color: var(--ink-faint);
    border-top: 1px dashed var(--glass-line-soft);
    padding-top: 8px;
    line-height: 1.4;
  }
  @media (max-width: 1080px) {
    .hero-content {
      grid-template-columns: minmax(0, 1fr);
    }
    .hero-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
