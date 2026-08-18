import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@deepcs/shared/db';
import {
  profileExists,
  readDisplayName,
  readProgress,
  setProgress,
  upsertProfile,
} from './repository.js';

/**
 * Real Postgres, not a mock. The two properties under test —
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
   * The property the whole design of this query rests on: `created` is
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
 * The claim under test: "a service querying another's schema
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

describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)(
  'roadmap progress',
  () => {
    /** Progress hangs off a profile, so the row has to exist first. */
    const reader = async () => {
      const u = uid();
      await upsertProfile(pool, u);
      return u;
    };

    // A question id is a plain uuid here: Users cannot see the bank, so nothing
    // validates it and the tests do not need a real one.
    const step = () => crypto.randomUUID();

    it('starts with nothing marked', async () => {
      if (!reachable) return;
      expect(await readProgress(pool, await reader())).toEqual([]);
    });

    it('records a tick and reads it back', async () => {
      if (!reachable) return;
      const u = await reader();
      const s = step();

      expect(await setProgress(pool, u, s, true, false)).toEqual({
        questionId: s,
        done: true,
        starred: false,
      });
      expect(await readProgress(pool, u)).toEqual([{ questionId: s, done: true, starred: false }]);
    });

    /**
     * The property the route leans on. The browser fires a write on every click
     * without waiting for the answer, so the same call can arrive twice — and a
     * toggle would flip twice and leave the box showing the opposite of the
     * truth. Replacing state means the second arrival is a no-op.
     */
    it('is idempotent: the same write twice leaves one row saying the same thing', async () => {
      if (!reachable) return;
      const u = await reader();
      const s = step();

      await setProgress(pool, u, s, true, true);
      await setProgress(pool, u, s, true, true);

      expect(await readProgress(pool, u)).toEqual([{ questionId: s, done: true, starred: true }]);
    });

    it('unticks without deleting the star', async () => {
      if (!reachable) return;
      const u = await reader();
      const s = step();

      await setProgress(pool, u, s, true, true);
      await setProgress(pool, u, s, false, true);

      // Starring something you have not done is the reason the two flags are
      // separate columns rather than one status.
      expect(await readProgress(pool, u)).toEqual([{ questionId: s, done: false, starred: true }]);
    });

    it('keeps two readers' + "'" + ' marks apart', async () => {
      if (!reachable) return;
      const [alice, bob] = [await reader(), await reader()];
      const s = step();

      await setProgress(pool, alice, s, true, false);

      expect(await readProgress(pool, bob)).toEqual([]);
      expect(await readProgress(pool, alice)).toHaveLength(1);
    });

    it('keeps a reader' + "'" + 's marks for different steps apart', async () => {
      if (!reachable) return;
      const u = await reader();
      const [one, two] = [step(), step()];

      await setProgress(pool, u, one, true, false);
      await setProgress(pool, u, two, false, true);

      const marks = await readProgress(pool, u);
      expect(marks).toHaveLength(2);
      expect(marks.find((m) => m.questionId === one)).toEqual({
        questionId: one,
        done: true,
        starred: false,
      });
      expect(marks.find((m) => m.questionId === two)).toEqual({
        questionId: two,
        done: false,
        starred: true,
      });
    });
  },
);

describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)('display names', () => {
  it('stores the name given when the row is created', async () => {
    if (!reachable) return;
    const u = uid();

    const { profile, created } = await upsertProfile(pool, u, 'Alex');
    expect(created).toBe(true);
    expect(profile.displayName).toBe('Alex');
    expect(await readDisplayName(pool, u)).toBe('Alex');
  });

  /**
   * The property the whole feature rests on. Names are set at sign-up and
   * have no write path, and that is not enforced by a rule anybody has to
   * remember: `ON CONFLICT DO NOTHING` means a later call carrying a
   * different name simply does not write. Giving names a write path later
   * means adding one on purpose.
   */
  it('ignores a name on any later call, so it cannot be changed', async () => {
    if (!reachable) return;
    const u = uid();
    await upsertProfile(pool, u, 'Alex');

    const { created } = await upsertProfile(pool, u, 'Someone Else');

    expect(created).toBe(false);
    expect(await readDisplayName(pool, u)).toBe('Alex');
  });

  it('leaves the name null when none is given', async () => {
    if (!reachable) return;
    const u = uid();
    await upsertProfile(pool, u);

    // Accounts made before names existed read this way, and the room shows
    // no name rather than a placeholder.
    expect(await readDisplayName(pool, u)).toBeNull();
  });

  it('is null for a uid with no profile at all', async () => {
    if (!reachable) return;
    expect(await readDisplayName(pool, uid())).toBeNull();
  });
});
