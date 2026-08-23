import { readFileSync } from 'node:fs';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

/**
 * The integration suite: tests run inside workerd against the real Worker,
 * a real local D1, and the built assets (`pnpm test:integration` builds
 * first). Verification is never stubbed — the Worker gets the public half
 * of a committed throwaway key pair as its JWKS, and tests sign tokens and
 * webhook payloads for real.
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
