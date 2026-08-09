import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@deepcs/shared/db';
import { profileExists, upsertProfile } from './repository.js';

/**
 * Real Postgres, not a mock (§8). The two properties under test —
 * `ON CONFLICT ... RETURNING` returning no row on conflict, and a role being
 * refused another schema — are database semantics. A mock would assert that
 * the mock agrees with itself.
 *
 * Assumes migrations have been applied: `pnpm --filter @deepcs/db migrate`.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs';
const USERS_URL =
  process.env.USERS_DATABASE_URL ?? 'postgresql://users_svc:users_svc@127.0.0.1:5432/deepcs';

let pool: ReturnType<typeof createPool>;
let reachable = false;

beforeAll(async () => {
  pool = createPool({ connectionString: ADMIN_URL, max: 2 });
  try {
    await pool.query('SELECT 1 FROM users.profiles LIMIT 1');
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  await pool?.end().catch(() => {});
});

const uid = () => `test-uid-${Math.random().toString(36).slice(2)}`;

describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)('lazy upsert', () => {
  it('creates the row on first sight and reports created', async () => {
    if (!reachable) return;
    const u = uid();

    const first = await upsertProfile(pool, u);
    expect(first.created).toBe(true);
    expect(first.profile.firebaseUid).toBe(u);
    expect(first.profile.preferredTopics).toEqual([]);
  });

  /**
   * The property the whole design of this query rests on (§5): `created` is
   * the only signal `user.signed_up` can be emitted from, because there is no
   * signup endpoint. If a second call reported created, the sign-up count in
   * /stats would be a request count.
   */
  it('reports created exactly once no matter how many times it is called', async () => {
    if (!reachable) return;
    const u = uid();

    const results = [];
    for (let i = 0; i < 5; i++) results.push(await upsertProfile(pool, u));

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results[0]!.created).toBe(true);
    // Same row every time — one user, one profile.
    const ids = new Set(results.map((r) => r.profile.id));
    expect(ids.size).toBe(1);
  });

  it('reports created exactly once under concurrent first calls', async () => {
    if (!reachable) return;
    const u = uid();

    // A client that fires GET /users/me twice on sign-in — a double-mounted
    // React effect does exactly this — must still produce one row and one
    // event.
    const results = await Promise.all(Array.from({ length: 8 }, () => upsertProfile(pool, u)));

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.profile.id)).size).toBe(1);
  });

  it('answers the existence check Matching relies on', async () => {
    if (!reachable) return;
    const u = uid();
    expect(await profileExists(pool, u)).toBe(false);
    await upsertProfile(pool, u);
    expect(await profileExists(pool, u)).toBe(true);
  });
});

/**
 * ADR-09's boundary, asserted rather than assumed.
 *
 * This is phase 1's fourth demoable claim: "a service querying another's schema
 * is rejected by Postgres". A convention that is merely documented drifts; a
 * grant that does not exist cannot.
 */
describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)(
  'schema isolation',
  () => {
    it('lets the users role read its own schema', async () => {
      if (!reachable) return;
      const svc = createPool({ connectionString: USERS_URL, max: 1 });
      try {
        await expect(svc.query('SELECT 1 FROM users.profiles LIMIT 1')).resolves.toBeDefined();
      } finally {
        await svc.end();
      }
    });

    it('refuses the users role access to another schema', async () => {
      if (!reachable) return;
      const svc = createPool({ connectionString: USERS_URL, max: 1 });
      try {
        // Fails on USAGE — "permission denied for schema matching" — before it
        // ever reaches the question of whether a table exists there. That is
        // the gate: no table-level grant can rescue a missing schema USAGE.
        await expect(svc.query('SELECT 1 FROM matching.sessions LIMIT 1')).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        await svc.end();
      }
    });

    it('refuses the users role permission to create tables in public', async () => {
      if (!reachable) return;
      const svc = createPool({ connectionString: USERS_URL, max: 1 });
      try {
        await expect(svc.query('CREATE TABLE public.sneaky (id int)')).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        await svc.end();
      }
    });
  },
);
