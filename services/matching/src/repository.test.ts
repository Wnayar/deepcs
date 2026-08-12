import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@deepcs/shared/db';
import {
  addRevealConsent,
  createSession,
  endSession,
  findActiveSessionForUser,
  findSessionById,
} from './repository.js';

/**
 * Real Postgres, not a mock: schema isolation is a database property, a
 * mock would only prove itself self-consistent. Mirrors
 * services/users/src/repository.test.ts and services/questions/src/repository.test.ts.
 *
 * Assumes migrations have been applied: `pnpm --filter @deepcs/db migrate`.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs';
const MATCHING_URL =
  process.env.MATCHING_DATABASE_URL ??
  'postgresql://matching_svc:matching_svc@127.0.0.1:5432/deepcs';

let pool: ReturnType<typeof createPool>;
let reachable = false;

beforeAll(async () => {
  pool = createPool({ connectionString: ADMIN_URL, max: 2 });
  try {
    await pool.query('SELECT 1 FROM matching.sessions LIMIT 1');
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  await pool?.end().catch(() => {});
});

const uid = () => `test-uid-${Math.random().toString(36).slice(2)}`;

describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)('sessions', () => {
  it('creates a session and finds it from either side', async () => {
    if (!reachable) return;
    const alice = uid();
    const bob = uid();
    const questionId = randomUUID();

    const created = await createSession(pool, alice, bob, questionId);
    expect(created.userAUid).toBe(alice);
    expect(created.userBUid).toBe(bob);
    expect(created.questionId).toBe(questionId);

    const foundByAlice = await findActiveSessionForUser(pool, alice);
    const foundByBob = await findActiveSessionForUser(pool, bob);
    expect(foundByAlice?.id).toBe(created.id);
    expect(foundByBob?.id).toBe(created.id);
  });

  it('returns null for a uid with no session', async () => {
    if (!reachable) return;
    expect(await findActiveSessionForUser(pool, uid())).toBeNull();
  });

  it('finds a session by id', async () => {
    if (!reachable) return;
    const created = await createSession(pool, uid(), uid(), randomUUID());
    expect((await findSessionById(pool, created.id))?.id).toBe(created.id);
  });

  it('returns null for an id with no session', async () => {
    if (!reachable) return;
    expect(await findSessionById(pool, randomUUID())).toBeNull();
  });
});

describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)(
  'consent and ending',
  () => {
    it('records a consent once, however many times it is given', async () => {
      if (!reachable) return;
      const alice = uid();
      const created = await createSession(pool, alice, uid(), randomUUID());

      await addRevealConsent(pool, created.id, alice);
      const twice = await addRevealConsent(pool, created.id, alice);

      // Not a length check on purpose: the bug this guards is the same uid
      // landing twice, which would make a two-entry array that looks like
      // mutual consent.
      expect(twice?.revealConsents).toEqual([alice]);
    });

    it('keeps both consents when each participant gives one', async () => {
      if (!reachable) return;
      const alice = uid();
      const bob = uid();
      const created = await createSession(pool, alice, bob, randomUUID());

      await addRevealConsent(pool, created.id, alice);
      const both = await addRevealConsent(pool, created.id, bob);

      expect(both?.revealConsents.sort()).toEqual([alice, bob].sort());
    });

    it('starts a session unconsented and unended', async () => {
      if (!reachable) return;
      const created = await createSession(pool, uid(), uid(), randomUUID());
      expect(created.revealConsents).toEqual([]);
      expect(created.endedAt).toBeNull();
    });

    it('does not move ended_at when a session is ended twice', async () => {
      if (!reachable) return;
      const created = await createSession(pool, uid(), uid(), randomUUID());

      const first = await endSession(pool, created.id);
      const second = await endSession(pool, created.id);

      // Both participants press End; the second press must not rewrite the
      // timestamp the first person's summary is already showing.
      expect(first?.endedAt).not.toBeNull();
      expect(second?.endedAt?.toISOString()).toBe(first?.endedAt?.toISOString());
    });

    /**
     * The regression test for a bug that arrives with `ended_at` rather than
     * being fixed by it. `POST /match/join` uses this function as its
     * idempotence guard, so if it kept returning a finished session, the user
     * would be handed that same dead session on every future join and could
     * never be matched with anyone again.
     */
    it('stops reporting a session as active once it has ended', async () => {
      if (!reachable) return;
      const alice = uid();
      const created = await createSession(pool, alice, uid(), randomUUID());
      expect((await findActiveSessionForUser(pool, alice))?.id).toBe(created.id);

      await endSession(pool, created.id);

      expect(await findActiveSessionForUser(pool, alice)).toBeNull();
      // Still findable by id — ending hides it from matching, it does not
      // delete it, because the summary still has to render.
      expect((await findSessionById(pool, created.id))?.id).toBe(created.id);
    });
  },
);

/**
 * ADR-09's boundary, asserted rather than assumed — same shape as the
 * schema-isolation suites in users and questions.
 */
describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)(
  'schema isolation',
  () => {
    it('lets the matching role read its own schema', async () => {
      if (!reachable) return;
      const svc = createPool({ connectionString: MATCHING_URL, max: 1 });
      try {
        await expect(svc.query('SELECT 1 FROM matching.sessions LIMIT 1')).resolves.toBeDefined();
      } finally {
        await svc.end();
      }
    });

    it('refuses the matching role access to another schema', async () => {
      if (!reachable) return;
      const svc = createPool({ connectionString: MATCHING_URL, max: 1 });
      try {
        await expect(svc.query('SELECT 1 FROM users.profiles LIMIT 1')).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        await svc.end();
      }
    });
  },
);
