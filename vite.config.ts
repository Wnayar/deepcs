import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The Content-Security-Policy for the built page.
 *
 * Injected on build only. The dev server needs inline scripts for hot
 * reload, and a policy loose enough to allow those is not a policy worth
 * shipping; the built bundle has no inline scripts, so the built one gets
 * the strict version.
 *
 * `connect-src` is one origin plus Firebase Auth: the SPA, the API and the
 * content are all served by the same Worker, which is what makes this list
 * short (DESIGN.md §12). The emulator entry only matters in a local build
 * pointed at it, and is harmless in production, where nothing tries it.
 * `style-src 'unsafe-inline'` covers React's inline style attributes.
 */
const CSP = [
  "default-src 'self'",
  "connect-src 'self' http://localhost:9099 https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/**
 * Serve the content files during `vite dev`, where no Worker is running.
 * Production never sees this: there, content is deployed static assets and
 * the paid half sits behind the Worker. Dev serves whatever CONTENT_DIR
 * points at (the fixtures by default) with no gate, which is fine because
 * the fixtures are samples and real-content previews are a local, signed-in
 * developer convenience.
 */
function contentInDev(): Plugin {
  const dir = process.env.CONTENT_DIR ?? 'content';
  const types: Record<string, string> = { json: 'application/json', md: 'text/markdown' };
  return {
    name: 'deepcs-content-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (!url.startsWith('/content/')) return next();
        // Dev has no entitlement check, so paid paths map straight back to
        // the flat content dir.
        const rel = url.replace('/content/paid/', '/').replace('/content/', '/');
        try {
          const body = readFileSync(join(dir, rel));
          res.setHeader('content-type', types[url.split('.').pop() ?? ''] ?? 'text/plain');
          res.end(body);
        } catch {
          res.statusCode = 404;
          res.end('not found');
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    contentInDev(),
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
  build: {
    // The Worker's static-assets directory. scripts/build-content.mjs adds
    // the content files here after the bundle is built.
    outDir: 'dist/client',
  },
  server: {
    port: 5173,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
