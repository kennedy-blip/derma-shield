// Fully client-side SPA: the whole instrument (camera, WebGL2, IndexedDB, Web
// Audio) is browser-local and must also work inside the Capacitor WebView.
export const ssr = false;
export const prerender = false;
export const csr = true;
