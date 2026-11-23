import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Pure JavaScript Vite pipeline — GLSL is imported as raw text via `?raw`,
// so no extra WebGL plugin and no TypeScript anywhere in the toolchain.
export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      // In local development the Python photobiology API runs on :8787.
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1400
  },
  assetsInclude: ['**/*.glsl']
});
