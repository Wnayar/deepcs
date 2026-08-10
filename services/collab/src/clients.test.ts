import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkSessionParticipant, getQuestion } from './clients.js';

/**
 * Contract tests (§8) — these call the *real* Users, Matching and Questions
 * HTTP APIs, not mocks, mirroring services/matching/src/clients.test.ts.
 * Needs all three actually running (`docker compose up`), or the URLs below
 * pointed at wherever they're reachable. Skipped, not failed, if they aren't.
 */
const USERS_URL = process.env.USERS_URL ?? 'http://127.0.0.1:8081';
const MATCHING_URL = process.env.MATCHING_URL ?? 'http://127.0.0.1:8083';
const QUESTIONS_URL = process.env.QUESTIONS_URL ?? 'http://127.0.0.1:8082';

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health/live`);
    return res.ok;
  } catch {
    return false;
  }
}

async function allReachable(): Promise<boolean> {
  const [u, m, q] = await Promise.all([
    reachable(USERS_URL),
    reachable(MATCHING_URL),
    reachable(QUESTIONS_URL),
  ]);
  return u && m && q;
}

/**
 * Creates a real matched session the same way two browsers would: each user
 * has to exist in Users first (Matching's /match/join checks this), then
 * both join the same topic+difficulty. From
 * packages/db/migrations/005_questions_seed.sql, "os"/"hard" has a seeded
 * question.
 */
async function createRealSession(): Promise<{
  sessionId: string;
  alice: string;
  bob: string;
  questionId: string;
}> {
  const alice = `contract-test-${Math.random().toString(36).slice(2)}`;
  const bob = `contract-test-${Math.random().toString(36).slice(2)}`;

  await fetch(`${USERS_URL}/users/me`, { headers: { 'x-user-id': alice } });
  await fetch(`${USERS_URL}/users/me`, { headers: { 'x-user-id': bob } });

  const body = JSON.stringify({ topic: 'os', difficulty: 'hard' });
  const headers = { 'content-type': 'application/json' };
  await fetch(`${MATCHING_URL}/match/join`, {
    method: 'POST',
    headers: { ...headers, 'x-user-id': alice },
    body,
  });
  const res = await fetch(`${MATCHING_URL}/match/join`, {
    method: 'POST',
    headers: { ...headers, 'x-user-id': bob },
    body,
  });
  const matched = (await res.json()) as { session: { id: string; questionId: string } };
  return { sessionId: matched.session.id, alice, bob, questionId: matched.session.questionId };
}

describe.skipIf(!process.env.CI && process.env.MATCHING_URL === undefined)(
  'checkSessionParticipant (Collab -> Matching contract)',
  () => {
    it('finds the question for a real participant, and names nobody', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { sessionId, alice, bob } = await createRealSession();

      const result = await checkSessionParticipant(MATCHING_URL, sessionId, alice);
      // Exactly the question id. Asserting the whole object, not just that
      // `questionId` is right, is what keeps the other participant's uid from
      // reappearing here: a session is anonymous, and Alice asking about her
      // own membership must not be a way to learn who Bob is.
      expect(result).toEqual({ questionId: expect.any(String) });
      expect(JSON.stringify(result)).not.toContain(bob);
    });

    it('is null for a uid that is not in the session', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { sessionId } = await createRealSession();

      const result = await checkSessionParticipant(
        MATCHING_URL,
        sessionId,
        'someone-else-entirely',
      );
      expect(result).toBeNull();
    });

    it('is null for a session id that does not exist', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const result = await checkSessionParticipant(MATCHING_URL, randomUUID(), 'whoever');
      expect(result).toBeNull();
    });

    /**
     * The route answers only about its caller. These two pin that, because it
     * is reachable from a browser through the Gateway's `/match` prefix — a
     * version that took a uid from the query string would hand anyone holding
     * a session id the other participant's identity.
     */
    it('refuses to answer when the caller has no identity', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { sessionId } = await createRealSession();

      const res = await fetch(`${MATCHING_URL}/match/sessions/${sessionId}/participant`);
      expect(res.status).toBe(401);
    });

    it('never returns a partner uid to a third party', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { sessionId } = await createRealSession();

      const res = await fetch(`${MATCHING_URL}/match/sessions/${sessionId}/participant`, {
        headers: { 'x-user-id': 'a-complete-stranger' },
      });

      expect(await res.json()).toEqual({ participant: false });
    });
  },
);

describe.skipIf(!process.env.CI && process.env.QUESTIONS_URL === undefined)(
  'getQuestion (Collab -> Questions contract)',
  () => {
    it('fetches a real question with non-empty parts', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { questionId } = await createRealSession();

      const question = await getQuestion(QUESTIONS_URL, questionId);
      expect(question?.parts.length).toBeGreaterThan(0);
    });

    it('is null for a question id that does not exist', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      expect(await getQuestion(QUESTIONS_URL, randomUUID())).toBeNull();
    });
  },
);
