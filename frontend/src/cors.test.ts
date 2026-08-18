import { describe, expect, it } from 'vitest';

/**
 * The preflight, which is the one part of the browser's contract with the
 * Gateway that no other test can see.
 *
 * A method missing from `access-control-allow-methods` is refused by the
 * *browser*, before the request is sent. Nothing reaches the Gateway, nothing
 * reaches a log, and the server looks innocent — while curl, which sends no
 * preflight at all, succeeds against the very same route. `PUT
 * /users/me/progress/:questionId` shipped broken exactly that way: the tick lit
 * up and vanished, and the server had returned 200 to every terminal test of
 * it.
 *
 * So this asserts the list rather than any one route: every method the client
 * in `api.ts` uses has to survive a preflight.
 *
 * Needs the stack up (`make up`).
 */
const GATEWAY = process.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

/** Whatever the app is configured to allow. The preflight echoes the request's
 * origin, so asking from anywhere else is answered for that origin instead. */
const ORIGIN = 'http://localhost:5173';

async function reachable(): Promise<boolean> {
  try {
    return (await fetch(`${GATEWAY}/health/live`)).ok;
  } catch {
    return false;
  }
}

/** What a browser sends before a request that is not a simple one. */
function preflight(method: string) {
  return fetch(`${GATEWAY}/users/me/progress/e2b0fcfe-a066-48eb-90f9-bbaa12e68b35`, {
    method: 'OPTIONS',
    headers: {
      origin: ORIGIN,
      'access-control-request-method': method,
      'access-control-request-headers': 'authorization,content-type',
    },
  });
}

describe.skipIf(!process.env.CI && process.env.VITE_GATEWAY_URL === undefined)(
  'the Gateway preflight',
  () => {
    // Every method `api.ts` sends. Adding one to the client means adding it
    // here, which is the point: this list is the reminder.
    it('allows every method the client sends', async (ctx) => {
      if (!(await reachable())) return ctx.skip();

      for (const method of ['GET', 'POST', 'PUT']) {
        const res = await preflight(method);
        const allowed = (res.headers.get('access-control-allow-methods') ?? '')
          .split(',')
          .map((m) => m.trim().toUpperCase());

        expect(res.status).toBeLessThan(400);
        expect(allowed, `${method} must survive a preflight`).toContain(method);
      }
    });

    it('answers the app origin, which is what makes the response usable', async (ctx) => {
      if (!(await reachable())) return ctx.skip();

      const res = await preflight('PUT');

      // Not `*`: the app sends an Authorization header, and a wildcard origin
      // cannot be combined with a credentialed request at all.
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
        'authorization',
      );
    });
  },
);
