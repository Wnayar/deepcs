import { applyD1Migrations, env } from 'cloudflare:test';

// Isolated storage snapshots per test, so tests never see each other's rows.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
