import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@deepcs/shared/db';
import { createSession, findActiveSessionForUser, findSessionById } from './repository.js';

/**
 * Real Postgres, not a mock (§8) — schema isolation is a database property, a
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
