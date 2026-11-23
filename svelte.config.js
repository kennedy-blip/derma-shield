import adapter from '@sveltejs/adapter-static';

/**
 * DERMA-SHIELD build configuration — 100% JavaScript (ES2024).
 * The SPA output lands in `dist/` so that:
 *   1. Vercel can serve it as a static deployment next to `api/*.py` functions.
 *   2. Capacitor can wrap the exact same bundle into the Android `.APK`
 *      (`webDir: "dist"`) for fully offline beach / trail / clinic use.
 * @type {import('@sveltejs/kit').Config}
 */
const config = {
  kit: {
    adapter: adapter({
      pages: 'dist',
      assets: 'dist',
      fallback: 'index.html',
      precompress: false,
      strict: true
    }),
    alias: {
      $shaders: 'src/shaders',
      $data: 'src/lib/data'
    },
    prerender: {
      entries: []
    }
  },
  compilerOptions: {
    runes: true
  }
};

export default config;
