import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@deepcs/shared/db';
import { loadSnapshot, saveSnapshot } from './repository.js';

/**
 * Real Postgres, not a mock. Mirrors
 * services/matching/src/repository.test.ts. Assumes migrations have been
 * applied: `pnpm --filter @deepcs/db migrate`.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs';
const COLLAB_URL =
  process.env.COLLAB_DATABASE_URL ?? 'postgresql://collab_svc:collab_svc@127.0.0.1:5432/deepcs';

let pool: ReturnType<typeof createPool>;
let reachable = false;

beforeAll(async () => {
  pool = createPool({ connectionString: ADMIN_URL, max: 2 });
  try {
    await pool.query('SELECT 1 FROM collab.snapshots LIMIT 1');
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  await pool?.end().catch(() => {});
});

describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)('snapshots', () => {
  it('returns null for a session with no snapshot yet', async () => {
    if (!reachable) return;
    expect(await loadSnapshot(pool, randomUUID())).toBeNull();
  });

  it('saves and loads a snapshot', async () => {
    if (!reachable) return;
    const sessionId = randomUUID();
    const state = Buffer.from([1, 2, 3, 4]);

    await saveSnapshot(pool, sessionId, state);
    expect(await loadSnapshot(pool, sessionId)).toEqual(state);
  });

  it('overwrites the previous snapshot on a second save', async () => {
    if (!reachable) return;
    const sessionId = randomUUID();

    await saveSnapshot(pool, sessionId, Buffer.from([1]));
    await saveSnapshot(pool, sessionId, Buffer.from([2, 2]));

    expect(await loadSnapshot(pool, sessionId)).toEqual(Buffer.from([2, 2]));
  });
});

/**
 * ADR-09's boundary, asserted rather than assumed — same shape as the
 * schema-isolation suite in services/matching/src/repository.test.ts.
 */
describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)(
  'schema isolation',
  () => {
    it('lets the collab role read its own schema', async () => {
      if (!reachable) return;
      const svc = createPool({ connectionString: COLLAB_URL, max: 1 });
      try {
        await expect(svc.query('SELECT 1 FROM collab.snapshots LIMIT 1')).resolves.toBeDefined();
      } finally {
        await svc.end();
      }
    });

    it('refuses the collab role access to another schema', async () => {
      if (!reachable) return;
      const svc = createPool({ connectionString: COLLAB_URL, max: 1 });
      try {
        await expect(svc.query('SELECT 1 FROM matching.sessions LIMIT 1')).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        await svc.end();
      }
    });
  },
);
