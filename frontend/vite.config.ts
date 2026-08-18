import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The Content-Security-Policy the Gateway deliberately does not set.
 *
 * `services/gateway/src/index.ts` turns Helmet's CSP off with the note that it
 * serves JSON rather than HTML, so a policy there protects nothing and belongs
 * on whatever serves the frontend — which is this.
 *
 * Injected on build only. The dev server needs inline scripts for hot reload,
 * and a policy loose enough to allow those is not a policy worth shipping; the
 * built bundle has no inline scripts, so the built one gets the strict version.
 * A response header from whatever serves the files is where a CSP really
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
