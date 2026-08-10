import { describe, expect, it } from 'vitest';
import { checkUserExists, findQuestion } from './clients.js';

/**
 * Contract tests (§8) — these call the *real* Users and Questions HTTP APIs,
 * not mocks, so a response-shape change in either service breaks this test
 * instead of breaking Matching in production. That's the whole point of
 * `clients.ts` parsing every response with zod: a shape drift throws here,
 * loudly, rather than silently returning something wrong.
 *
 * Needs both services actually running — `docker compose up` locally, or the
 * URLs below pointed at wherever they're reachable. Skipped, not failed, if
 * they aren't (same pattern as the real-Postgres/Redis tests).
 */
const USERS_URL = process.env.USERS_URL ?? 'http://127.0.0.1:8081';
const QUESTIONS_URL = process.env.QUESTIONS_URL ?? 'http://127.0.0.1:8082';

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health/live`);
    return res.ok;
  } catch {
    return false;
  }
}

describe.skipIf(!process.env.CI && process.env.USERS_URL === undefined)(
  'checkUserExists (Matching -> Users contract)',
  () => {
    it('is false for a uid nobody has signed in as', async () => {
      if (!(await reachable(USERS_URL))) return;
      const uid = `contract-test-${Math.random().toString(36).slice(2)}`;
      expect(await checkUserExists(USERS_URL, uid)).toBe(false);
    });

    it('is true once that uid has signed in', async () => {
      if (!(await reachable(USERS_URL))) return;
      const uid = `contract-test-${Math.random().toString(36).slice(2)}`;

      // Calling Users' own /users/me directly, the same way the Gateway
      // would after verifying a token — this is what actually creates the
      // row checkUserExists then finds.
      await fetch(`${USERS_URL}/users/me`, { headers: { 'x-user-id': uid } });

      expect(await checkUserExists(USERS_URL, uid)).toBe(true);
    });
  },
);

describe.skipIf(!process.env.CI && process.env.QUESTIONS_URL === undefined)(
  'findQuestion (Matching -> Questions contract)',
  () => {
    it('finds a seeded question by topic and difficulty', async () => {
      if (!(await reachable(QUESTIONS_URL))) return;
      // From packages/db/migrations/005_questions_seed.sql: each of the five
      // topics has exactly one question per difficulty, so any combination a
      // caller can express resolves to something.
      const id = await findQuestion(QUESTIONS_URL, 'os', 'hard');
      expect(typeof id).toBe('string');
    });

    /**
     * The property Matching actually depends on: it refuses a match when no
     * question fits, so a topic+difficulty with nothing behind it is a pair of
     * users who can never be matched. Five of these fifteen were empty until
     * the seed's difficulties were made the day index within each topic.
     */
    it('has a question for every topic and difficulty a caller can ask for', async () => {
      if (!(await reachable(QUESTIONS_URL))) return;
      const topics = ['os', 'networking', 'databases', 'oop', 'system-design'];
      const difficulties = ['easy', 'medium', 'hard'] as const;

      for (const topic of topics) {
        for (const difficulty of difficulties) {
          const id = await findQuestion(QUESTIONS_URL, topic, difficulty);
          expect(id, `no question for ${topic}/${difficulty}`).toBeTruthy();
        }
      }
    });

    it('is null when nothing matches', async () => {
      if (!(await reachable(QUESTIONS_URL))) return;
      const id = await findQuestion(QUESTIONS_URL, 'no-such-topic-xyz', 'easy');
      expect(id).toBeNull();
    });
  },
);
