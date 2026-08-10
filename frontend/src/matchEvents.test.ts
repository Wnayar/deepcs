import { describe, expect, it } from 'vitest';
import { watchForMatch } from './matchEvents';

/**
 * The real path: browser client, through the Gateway, to Matching, over Redis.
 *
 * This is the test the feature needs most, because its failure mode is silent.
 * Anything between the browser and Matching that buffers the response turns a
 * stream into one long pause followed by everything at once, and nothing errors:
 * the request succeeds, the headers are right, and events simply never arrive.
 * Reading the code cannot tell you whether that is happening, so the assertion
 * that matters is a wall-clock one, made through the Gateway rather than
 * against Matching directly.
 *
 * Needs the stack up (`make up`) plus the Auth emulator.
 */
const GATEWAY = process.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';
const EMULATOR = process.env.VITE_FIREBASE_AUTH_EMULATOR ?? 'http://localhost:9099';

/** Comfortably longer than a round trip, far shorter than the poll it replaced,
 * which was up to twenty seconds late by design. */
const MUST_ARRIVE_WITHIN_MS = 3_000;

async function reachable(): Promise<boolean> {
  try {
    const [gateway, emulator] = await Promise.all([
      fetch(`${GATEWAY}/health/live`).then((r) => r.ok),
      fetch(`${EMULATOR}/`).then((r) => r.ok),
    ]);
    return gateway && emulator;
  } catch {
    return false;
  }
}

async function signUp(): Promise<string> {
  const res = await fetch(
    `${EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `sse-${Math.random().toString(36).slice(2)}@example.com`,
        password: 'password123',
        returnSecureToken: true,
      }),
    },
  );
  return ((await res.json()) as { idToken: string }).idToken;
}

describe.skipIf(!process.env.CI && process.env.VITE_GATEWAY_URL === undefined)(
  'watching for a match',
  () => {
    it('is told within milliseconds, through the Gateway', async (ctx) => {
      if (!(await reachable())) return ctx.skip();

      const [alice, bob] = [await signUp(), await signUp()];
      const authed = (token: string) => ({ authorization: `Bearer ${token}` });
      for (const token of [alice, bob]) {
        await fetch(`${GATEWAY}/users/me`, { headers: authed(token) });
      }

      // Alice's token is what the client reads, so it is what `idToken()` has
      // to return. The module reads it from Firebase, which is not signed in
      // here, so the fetch is exercised with an explicit override instead.
      const seen: { id: string }[] = [];
      const stop = watchForMatch(
        (session) => seen.push(session),
        () => alice,
      );

      // Give the stream a moment to be established before anything happens on
      // it, so this measures delivery rather than connection setup.
      await new Promise((resolve) => setTimeout(resolve, 400));

      const body = JSON.stringify({ topic: 'system-design', difficulty: 'hard' });
      const headers = { 'content-type': 'application/json' };
      await fetch(`${GATEWAY}/match/join`, {
        method: 'POST',
        headers: { ...headers, ...authed(alice) },
        body,
      });

      const sentAt = Date.now();
      await fetch(`${GATEWAY}/match/join`, {
        method: 'POST',
        headers: { ...headers, ...authed(bob) },
        body,
      });

      try {
        const deadline = sentAt + MUST_ARRIVE_WITHIN_MS;
        while (seen.length === 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        // Not merely "eventually". A buffering proxy still delivers eventually,
        // when the response is finally closed, and that is exactly the bug this
        // has to catch.
        expect(seen).toHaveLength(1);
        expect(Date.now() - sentAt).toBeLessThan(MUST_ARRIVE_WITHIN_MS);
        expect(seen[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
      } finally {
        stop();
      }
    }, 30_000);
  },
);
