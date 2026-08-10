import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The Content-Security-Policy the Gateway deliberately does not set.
 *
 * `services/gateway/src/index.ts` turns Helmet's CSP off with the note that it
 * serves JSON rather than HTML, so a policy there protects nothing and belongs
 * "on whatever serves the frontend (phase 5)" — this is that.
 *
 * Injected on build only. The dev server needs inline scripts for hot reload,
 * and a policy loose enough to allow those is not a policy worth shipping; the
 * built bundle has no inline scripts, so production gets the strict version.
 * Phase 10 moves this to a CDN response header, which is where a CSP really
 * belongs — a meta tag cannot express `frame-ancestors` or report endpoints.
 */
const CSP = [
  "default-src 'self'",
  // The Gateway (HTTP and the collab WebSocket), plus Firebase Auth: the
  // emulator on localhost in dev, Google's identity endpoints in production.
  "connect-src 'self' http://localhost:8080 ws://localhost:8080 http://localhost:9099 https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
  "script-src 'self'",
  // Monaco injects its theme rules as inline <style> elements at runtime.
  "style-src 'self' 'unsafe-inline'",
  // Monaco's tokenizer and language services run in web workers, which Vite
  // emits as blob URLs.
  "worker-src 'self' blob:",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export default defineConfig({
  resolve: {
    alias: {
      /**
       * `y-monaco` imports `monaco-editor/esm/vs/editor/editor.api.js`, which
       * every Monaco before 0.55 resolved as a plain file path. Monaco 0.56
       * added an `exports` map that rewrites `./*` to `./esm/vs/*`, so that
       * specifier now resolves to `esm/vs/esm/vs/...` and the build fails on a
       * path that does not exist.
       *
       * Aliasing it to the specifier the map does accept is a two-line fix
       * that keeps both packages current. The alternative was pinning Monaco
       * back below 0.56 to suit one dependency's import style.
       */
      'monaco-editor/esm/vs/editor/editor.api.js': 'monaco-editor/editor/editor.api.js',
    },
  },
  plugins: [
    react(),
    {
      name: 'deepcs-csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace(
          '</title>',
          `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
        ),
    },
  ],
  server: {
    // Pinned rather than left to Vite's default-and-increment behaviour: this
    // exact origin is what the Gateway's CORS allows (CORS_ORIGIN), so a
    // silent fallback to 5174 when 5173 is busy would look like a CORS bug.
    port: 5173,
    strictPort: true,
  },
});
