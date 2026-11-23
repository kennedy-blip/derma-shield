<script>
  /**
   * DERMA-SHIELD inline icon set — 1.6 stroke geometric glyphs, no icon font,
   * no network. Every path is authored for a 24×24 viewBox.
   */
  let { name = 'sun', size = 20, stroke = 1.6, class: cls = '', filled = false } = $props();

  const PATHS = {
    sun: 'M12 4v1.5M12 18.5V20M4 12h1.5M18.5 12H20M6.34 6.34l1.06 1.06M16.6 16.6l1.06 1.06M17.66 6.34l-1.06 1.06M7.4 16.6l-1.06 1.06M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    microscope: 'M6 20h12M9 20v-3M12 17V9M12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 14h8l-1.5-3h-5L8 14ZM15 12l3-4',
    mole: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM12 8.5v7M8.5 12h7',
    drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z',
    shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z',
    vault: 'M5 4h14v16H5zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM12 8.5V7M12 15.5V17M8.5 12H7M15.5 12H17',
    terminal: 'M4 5h16v14H4zM7.5 9.5l2.5 2.5-2.5 2.5M12.5 15h4',
    download: 'M12 4v10M8 10.5l4 4 4-4M5 19h14',
    android: 'M6 10h12v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7ZM8.5 10V8a3.5 3.5 0 1 1 7 0v2M9.5 7l-.8-1.3M14.5 7l.8-1.3M9.5 14v1.5M14.5 14v1.5',
    sliders: 'M5 8h9M17 8h2M5 16h3M11 16h8M14 5.5v5M8 13.5v5',
    close: 'M6 6l12 12M18 6L6 18',
    chevronRight: 'M9 5l7 7-7 7',
    chevronDown: 'M5 9l7 7 7-7',
    check: 'M4.5 12.5l5 5 10-11',
    alert: 'M12 4l9 16H3l9-16ZM12 10v4M12 17v.5',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v5M12 8v.5',
    pin: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11ZM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
    camera: 'M4 8h3l1.5-2.5h7L17 8h3v11H4V8ZM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
    wave: 'M3 12c1.5-4 3-4 4.5 0S10.5 16 12 12s3-4 4.5 0 3 4 4.5 0',
    layers: 'M12 3l9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7.5V12l3 2',
    thermometer: 'M10 4a2 2 0 1 1 4 0v9.2a4 4 0 1 1-4 0V4ZM12 8v6',
    bolt: 'M13 3L5 13h5l-1 8 8-10h-5l1-8Z',
    flask: 'M9 3h6M10 3v6L5 19a2 2 0 0 0 1.8 2h10.4A2 2 0 0 0 19 19l-5-10V3M7.5 15h9',
    qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5z',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    play: 'M7 4l13 8-13 8V4Z',
    pause: 'M7 4h4v16H7zM14 4h4v16h-4z',
    reset: 'M4 10a8 8 0 1 1 2.5 8.5M4 4v6h6',
    export: 'M12 16V4M8 7.5L12 3.5l4 4M5 14v5h14v-5',
    lock: 'M6 10h12v10H6zM8.5 10V7.5a3.5 3.5 0 1 1 7 0V10M12 14v2.5',
    unlock: 'M6 10h12v10H6zM8.5 10V7.5a3.5 3.5 0 0 1 6.8-1.2M12 14v2.5',
    trash: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10.5 11v5M13.5 11v5',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    mountain: 'M3 19l6-11 4 7 2.5-4L21 19H3Z',
    water: 'M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 11c2-2 4-2 6 0s4 2 6 0 4-2 6 0',
    snow: 'M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9M12 7l2.5-2M12 7L9.5 5M12 17l2.5 2M12 17l-2.5 2',
    grass: 'M4 20c0-5 2-8 4-10M8 20c1-4 3-6 5-7M12 20c0-4 1-7 3-9M16 20c0-3 1-5 3-6M6 20h14',
    graph: 'M4 19V5M4 19h16M7 15l4-5 3 3 5-7',
    eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
    copy: 'M9 9h10v12H9zM5 15V3h10',
    star: 'M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.9l6-.8L12 3.5Z',
    target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z',
    sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z',
    compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM15.5 8.5l-2 5-5 2 2-5 5-2Z',
    code: 'M8.5 7.5L3.5 12l5 4.5M15.5 7.5l5 4.5-5 4.5',
    cpu: 'M7 7h10v10H7zM9.5 3.5V7M14.5 3.5V7M9.5 17v3.5M14.5 17v3.5M3.5 9.5H7M3.5 14.5H7M17 9.5h3.5M17 14.5h3.5',
    palette: 'M12 3a9 9 0 0 0 0 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 0 0 3-3c0-6-4-11-8-11ZM7.5 10a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM11 7a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 11 7ZM15 8a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 15 8Z',
    calendar: 'M4 6h16v14H4zM8 3.5V6M16 3.5V6M4 10h16',
    ruler: 'M3 15L15 3l6 6L9 21l-6-6ZM7 11l2 2M10 8l2 2M13 5l2 2',
    finger: 'M9 12V6a2 2 0 1 1 4 0v6M13 11V8.5a2 2 0 1 1 4 0V14a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-2-3a2 2 0 0 1 3-2.4L9 13'
  };

  const d = $derived(PATHS[name] ?? PATHS.sun);
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? 'currentColor' : 'none'}
  stroke={filled ? 'none' : 'currentColor'}
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={cls}
  aria-hidden="true"
  focusable="false"
>
  <path d={d} />
</svg>
