import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The CSP for the built page, injected on build only: the dev server needs
 * inline scripts for hot reload. connect-src is one origin plus Firebase
 * Auth (the localhost entry is the emulator, inert in production);
 * 'unsafe-inline' on styles covers React's inline style attributes.
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

/** Serves content files during `vite dev`, where no Worker runs. Dev-only
 * and ungated; production content is deployed assets behind the Worker. */
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
        // No gate in dev: paid paths map back to the flat content dir.
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
    // The Worker's assets directory; build-content.mjs adds content here.
    outDir: 'dist/client',
  },
  server: {
    port: 5173,
  },
  test: {
    // Unit tests only. The integration suite runs inside workerd via
    // vitest.workers.config.ts (`pnpm test:integration`).
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
