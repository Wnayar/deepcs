import { applyD1Migrations, env } from 'cloudflare:test';

// The real migration files, applied to the test database before each test
// file. Isolated storage then snapshots per test, so tests cannot see each
// other's rows.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
