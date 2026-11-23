<script>
  /**
   * Android Release Centre.
   *
   * The web app is the reference implementation; the .APK is a self-hosted
   * replica built by CI from the identical `dist/` bundle. This panel:
   *
   *   1. reads `releases/release-manifest.json` for version + notes,
   *   2. HEAD-probes the binary so a 404 never becomes a broken download,
   *   3. renders a real QR code (qrcode-generator, SVG path output) pointing at
   *      the same URL, and
   *   4. falls back to the exact three-command stream build recipe when the
   *      binary has not been produced yet.
   */
  import { onMount } from 'svelte';
  import qrcode from 'qrcode-generator';
  import { app } from '$lib/db/store.svelte.js';
  import Icon from '../ui/Icon.svelte';
  import Ledger from '../ui/Ledger.svelte';
  import { fmtInt } from '../ui/Stat.js';

  /** Bytes → "4.8 MB" / "860 kB", for the binary-size ledger row and hint. */
  function fmtBytes(v) {
    if (v == null || !Number.isFinite(v) || v <= 0) return '—';
    if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
    if (v >= 1024) return `${Math.round(v / 1024)} kB`;
    return `${v} B`;
  }

  const APK_URL = '/releases/dermashield-release.apk';
  const MANIFEST_URL = '/releases/release-manifest.json';

  let status = $state('probing'); // probing | ready | missing | building
  const DEFAULT_MANIFEST = {
    appId: 'com.dermashield.bio',
    version: '1.0.0',
    versionCode: 1,
    minSdk: 24,
    targetSdk: 35,
    channel: 'stable',
    checksum: '/releases/dermashield-release.apk.sha256',
    buildPipeline: 'https://github.com/kennedy-blip/derma-shield/actions/workflows/build-and-bundle-apk.yml',
    notes: [
      'Offline photobiology kernel bundled — no network needed for dosing math',
      'Native lux / barometer / rotation-vector sensor bridge',
      'PIN-locked IndexedDB lesion vault with AES-GCM at rest'
    ]
  };
  let manifest = $state(DEFAULT_MANIFEST);
  let bytes = $state(null);
  let httpStatus = $state(null);
  let contentType = $state('');
  let qrPath = $state('');
  let qrSize = $state(29);
  let copied = $state(false);
  let absoluteUrl = $state(APK_URL);

  const builtAt = $derived(
    manifest?.builtAt ? new Date(manifest.builtAt).toISOString().slice(0, 16).replace('T', ' ') : null
  );
  const shortSha = $derived(
    manifest?.sha256 ? `${manifest.sha256.slice(0, 12)}…${manifest.sha256.slice(-8)}` : null
  );

  /** Manifest wins; APK_URL is only the pre-manifest default. */
  const apkUrl = $derived(manifest?.apk || APK_URL);

  const target = $derived(
    typeof location !== 'undefined' ? new URL(apkUrl, location.origin).toString() : apkUrl
  );

  const wifiHint = $derived.by(() => {
    if (typeof location === 'undefined') return 'localhost';
    const host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'localhost — scan from a phone will not reach this host. Use the LAN IP or the deployed Vercel URL.';
    }
    return `${host} — reachable from a phone on the same network.`;
  });

  /** Build an SVG path for a QR matrix without any canvas dependency. */
  function buildQr(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    qrSize = count;
    return d;
  }

  onMount(async () => {
    absoluteUrl = target;
    qrPath = buildQr(target);

    // 1. manifest (optional, non-fatal)
    try {
      const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (res.ok) manifest = { ...DEFAULT_MANIFEST, ...(await res.json()) };
    } catch {
      /* offline: defaults below still render */
    }

    // 2. binary probe
    try {
      const res = await fetch(APK_URL, { method: 'HEAD', cache: 'no-store' });
      httpStatus = res.status;
      contentType = res.headers.get('content-type') ?? '';
      const len = Number(res.headers.get('content-length') ?? 0);
      bytes = Number.isFinite(len) && len > 0 ? len : null;

      // Readiness is "the manifest parsed AND the file is really there".
      // It deliberately does NOT depend on the Content-Type or a size floor:
      // Vercel serves `.apk` with an empty/`octet-stream` type unless vercel.json
      // overrides it, and the first successful build came in under 1 MiB while
      // still being a complete signed package. Those heuristics reported
      // "BUILD IN PROGRESS" for a perfectly downloadable APK.
      if (res.ok && bytes != null) {
        status = 'ready';
      } else if (res.ok) {
        status = 'building';
      } else {
        status = 'missing';
      }
    } catch {
      status = 'missing';
    }
  });

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(target);
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch {
      app.toast('Clipboard blocked by the browser', 'warn');
    }
  }

  const statusMeta = $derived(
    {
      probing: { tone: 'accent', label: 'PROBING', copy: 'Checking the release channel and probing the binary…' },
      ready: { tone: 'ok', label: 'AVAILABLE', copy: 'Signed release APK is live.' },
      building: { tone: 'warn', label: 'BUILD IN PROGRESS', copy: 'The channel answered, but the binary is not final yet.' },
      missing: { tone: 'danger', label: 'NOT BUILT YET', copy: 'No APK in the release channel. Use the stream recipe below.' }
    }[status]
  );

  const rows = $derived([
    { label: 'Package', value: manifest?.appId ?? 'com.dermashield.bio', unit: '' },
    { label: 'Version', value: manifest?.version ?? '1.0.0', unit: `+${manifest?.versionCode ?? 1}` },
    { label: 'Min Android', value: manifest?.minSdk ?? 24, unit: 'SDK' },
    { label: 'Target', value: manifest?.targetSdk ?? 35, unit: 'SDK' },
    {
      label: 'Binary',
      value: bytes ? fmtBytes(bytes) : '—',
      unit: '',
      tone: status === 'ready' ? 'ok' : 'warn'
    },
    {
      label: 'Build',
      value: manifest?.versionCode ? `#${manifest.versionCode}` : '—',
      unit: builtAt ?? '',
      tone: status === 'ready' ? 'ok' : 'warn'
    },
    {
      label: 'HTTP',
      value: httpStatus ?? '—',
      unit: contentType.includes('android') ? 'apk' : contentType ? contentType.split('/').pop() : '',
      tone: status === 'ready' ? 'ok' : 'danger'
    }
  ]);

  const RECIPE = [
    'npm run build',
    'npx cap sync android',
    'cd android && ./gradlew assembleRelease',
    'cp app/build/outputs/apk/release/app-release.apk ../static/releases/dermashield-release.apk'
  ];
</script>

<div class="apk">
  <div class="stage">
    <div class="status-strip" data-tone={statusMeta.tone}>
      <span class="dot"></span>
      <span class="label">{statusMeta.label}</span>
      <span class="copy">{statusMeta.copy}</span>
    </div>

    <div class="hero">
      <div class="qr-shell" class:ready={status === 'ready'}>
        {#if qrPath}
          <svg viewBox="0 0 {qrSize} {qrSize}" role="img" aria-label="APK download QR code" shape-rendering="crispEdges">
            <rect width={qrSize} height={qrSize} fill="#ffffff" />
            <path d={qrPath} fill="#06070e" />
          </svg>
        {:else}
          <div class="qr-skeleton"><Icon name="qr" size={64} /></div>
        {/if}
      </div>

      <div class="hero-copy">
        <h4>Scan to install on Android</h4>
        <p>
          The APK is the same Svelte bundle wrapped by Capacitor, with the native
          lux / barometer / rotation-vector bridge and the camera2 dermatoscope
          plugin compiled in. Fully offline once installed.
        </p>
        <p class="hint"><Icon name="info" size={13} /> {wifiHint}</p>

        <div class="cta">
          <a
            class="btn primary"
            class:disabled={status === 'missing'}
            href={status === 'missing' ? undefined : apkUrl}
            download={apkUrl.split('/').pop()}
            aria-disabled={status === 'missing'}
          >
            <Icon name="download" size={15} />
            {status === 'ready' ? 'Download .APK' : status === 'building' ? 'Download (pending)' : 'APK unavailable'}
          </a>
          <button class="btn" onclick={copyUrl}>
            <Icon name={copied ? 'check' : 'copy'} size={14} />
            {copied ? 'Copied' : 'Copy link'}
          </button>
          {#if manifest?.buildPipeline}
            <a class="btn ghost" href={manifest.buildPipeline} target="_blank" rel="noreferrer">
              <Icon name="code" size={14} /> CI runs
            </a>
          {/if}
        </div>

        <code class="url mono">{absoluteUrl}</code>
      </div>
    </div>
  </div>

  <div class="side">
    <Ledger rows={rows} dense />

    {#if status === 'missing' || status === 'building'}
      <div class="fallback">
        <h5><Icon name="terminal" size={14} /> Stream fallback</h5>
        <p>
          No binary has been published to this deployment yet. Build it locally or
          let GitHub Actions do it — the workflow commits the artifact back to
          <code>static/releases/</code>.
        </p>
        <ol class="recipe mono">
          {#each RECIPE as step, i}
            <li><span class="n">{i + 1}</span><code>{step}</code></li>
          {/each}
        </ol>
        <p class="note">
          Requires JDK 21 + Android SDK 35. The authoring sandbox has neither, which
          is exactly why the build runs in CI.
        </p>
      </div>
    {/if}

    <div class="notes">
      <h5><Icon name="layers" size={14} /> {manifest?.channel ?? 'stable'} channel</h5>
      <ul>
        {#each manifest?.notes ?? ['Offline photobiology kernel bundled', 'Native sensor bridge compiled in', 'PIN-locked encrypted lesion vault'] as note}
          <li><Icon name="check" size={11} /> {note}</li>
        {/each}
      </ul>
      {#if shortSha}
        <p class="sha mono" title={manifest.sha256}>
          SHA-256 <span>{shortSha}</span>
        </p>
      {/if}
      <p class="sha mono">
        Checksum file: <span>{manifest?.checksum ?? '/releases/dermashield-release.apk.sha256'}</span>
      </p>
    </div>
  </div>
</div>

<style>
  .apk {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
    gap: 1.1rem;
  }

  .stage {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .status-strip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface-3);
    font-size: 0.72rem;
  }

  .status-strip .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 10px currentColor;
  }

  .status-strip[data-tone='ok'] { color: var(--ok); }
  .status-strip[data-tone='warn'] { color: var(--warn); }
  .status-strip[data-tone='danger'] { color: var(--danger); }
  .status-strip[data-tone='accent'] { color: var(--accent); }

  .status-strip .label {
    font-family: var(--font-mono);
    letter-spacing: 0.14em;
    font-size: 0.62rem;
  }

  .status-strip .copy {
    color: var(--ink-muted);
    margin-left: 0.2rem;
  }

  .hero {
    display: grid;
    grid-template-columns: 168px minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }

  .qr-shell {
    aspect-ratio: 1;
    border-radius: 16px;
    padding: 10px;
    background: #fff;
    border: 1px solid var(--line);
    box-shadow: 0 14px 40px -22px rgba(0, 0, 0, 0.9);
    display: grid;
    place-items: center;
    opacity: 0.92;
    transition: 240ms ease;
  }

  .qr-shell.ready {
    opacity: 1;
    box-shadow:
      0 14px 40px -22px rgba(0, 0, 0, 0.9),
      0 0 0 1px color-mix(in srgb, var(--ok) 55%, transparent),
      0 0 40px -18px var(--ok);
  }

  .qr-shell svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .qr-skeleton {
    color: #8fa0b8;
  }

  .hero-copy h4 {
    margin: 0 0 0.35rem;
    font-size: 1rem;
  }

  .hero-copy p {
    margin: 0 0 0.5rem;
    font-size: 0.78rem;
    line-height: 1.55;
    color: var(--ink-muted);
  }

  .hint {
    display: flex;
    gap: 0.35rem;
    align-items: flex-start;
    font-size: 0.7rem !important;
    color: var(--warn) !important;
  }

  .cta {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin: 0.7rem 0 0.55rem;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.48rem 0.8rem;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink);
    font-size: 0.74rem;
    text-decoration: none;
    cursor: pointer;
    transition: 150ms ease;
  }

  .btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .btn.primary {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
    color: var(--accent);
  }

  .btn.ghost {
    background: transparent;
  }

  .btn.disabled {
    opacity: 0.45;
    pointer-events: none;
  }

  .url {
    display: block;
    font-size: 0.64rem;
    color: var(--ink-faint);
    overflow-wrap: anywhere;
    padding: 0.4rem 0.5rem;
    border-radius: 8px;
    background: var(--surface-3);
    border: 1px solid var(--line);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .fallback,
  .notes {
    padding: 0.8rem;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--surface-3);
  }

  .fallback {
    border-color: color-mix(in srgb, var(--warn) 34%, var(--line));
  }

  .fallback h5,
  .notes h5 {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0 0 0.4rem;
    font-size: 0.78rem;
  }

  .fallback p,
  .notes p {
    margin: 0 0 0.5rem;
    font-size: 0.72rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }

  .recipe {
    list-style: none;
    margin: 0 0 0.6rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .recipe li {
    display: flex;
    gap: 0.45rem;
    align-items: baseline;
    font-size: 0.66rem;
  }

  .recipe .n {
    font-size: 0.6rem;
    color: var(--accent);
    min-width: 1em;
  }

  .recipe code {
    overflow-wrap: anywhere;
    color: var(--ink-muted);
  }

  .note {
    color: var(--ink-faint) !important;
    font-size: 0.68rem !important;
  }

  .notes ul {
    list-style: none;
    margin: 0 0 0.5rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .notes li {
    display: flex;
    gap: 0.35rem;
    align-items: flex-start;
    font-size: 0.72rem;
    color: var(--ink-muted);
    line-height: 1.45;
  }

  .notes li :global(svg) {
    color: var(--ok);
    flex: none;
    margin-top: 2px;
  }

  .sha {
    font-size: 0.62rem;
    color: var(--ink-faint);
    overflow-wrap: anywhere;
  }

  @media (max-width: 780px) {
    .apk { grid-template-columns: minmax(0, 1fr); }
    .hero { grid-template-columns: 132px minmax(0, 1fr); }
  }

  @media (max-width: 480px) {
    .hero { grid-template-columns: minmax(0, 1fr); }
    .qr-shell { max-width: 178px; }
  }
</style>
