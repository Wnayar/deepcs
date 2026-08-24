import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { PROJECT, WEBHOOK_SECRET } from './test/integration/helpers';

/**
 * The e2e suite: a real browser against `wrangler dev`, which serves the
 * built SPA and free content as assets and runs the real Worker over a real
 * local D1 (DESIGN.md §11). Verification is never stubbed — the Worker gets
 * the public half of the committed throwaway key pair as its JWKS, and the
 * tests sign tokens and webhook payloads with the private half, exactly as
 * the integration suite does.
 */

/** 8787 and 8788 are where a person runs the stack by hand; the suite must
 * not collide with a dev server someone is still reading. */
const PORT = 8790;

const { publicJwks } = JSON.parse(readFileSync('test/fixtures/test-jwks.json', 'utf8')) as {
  publicJwks: unknown;
};

export default defineConfig({
  testDir: 'test/e2e',
  // A rerun must give the same verdict, so a flake stays a failure.
  retries: 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  // Chromium alone: these flows pin whole-stack behaviour, not rendering
  // differences between engines.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The JSON is single-quoted because it carries the colons `--var`
    // splits on. The inspector port is pinned away from wrangler's default
    // for the same reason as PORT.
    command: [
      'wrangler dev',
      `--port ${PORT}`,
      '--inspector-port 9330',
      `--var FIREBASE_PROJECT_ID:${PROJECT}`,
      `--var STRIPE_WEBHOOK_SECRET:${WEBHOOK_SECRET}`,
      `--var 'AUTH_JWKS_JSON:${JSON.stringify(publicJwks)}'`,
    ].join(' '),
    // Content, not the SPA shell: the fallback answers 200 for anything, so
    // only a real asset proves the build reached the server.
    url: `http://localhost:${PORT}/content/roadmap.json`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
