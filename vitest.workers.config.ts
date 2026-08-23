import { readFileSync } from 'node:fs';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

/**
 * The integration suite: tests execute inside workerd, the production
 * runtime, against the real Worker, a real local D1 with the real
 * migrations applied, and the real built assets (DESIGN.md §15.2 — run
 * `pnpm test:integration`, which builds first).
 *
 * Auth is never stubbed: the Worker gets the public half of a throwaway
 * committed key pair as its JWKS, tests mint RS256 tokens with the private
 * half, and signature/claims verification runs exactly as in production.
 * Webhooks likewise: payloads are HMAC-signed with the test secret.
 */
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('migrations');
  const jwks = JSON.parse(readFileSync('test/fixtures/test-jwks.json', 'utf8')) as {
    publicJwks: unknown;
  };

  return {
    test: {
      include: ['test/integration/**/*.test.ts'],
      setupFiles: ['test/integration/setup.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              AUTH_JWKS_JSON: JSON.stringify(jwks.publicJwks),
              FIREBASE_PROJECT_ID: 'test-project',
              STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
            },
          },
        },
      },
    },
  };
});
