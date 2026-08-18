import { describe, expect, it } from 'vitest';
import { connectCollab, type CollabStatus } from './collab';

/**
 * The frontend's half of the Collab protocol, run against the real stack.
 *
 * This is the seam most likely to break and least likely to be noticed: the
 * server's framing is covered by services/collab/src/sync.test.ts, but that
 * suite ships its own reference client. `collab.ts` is a *second*
 * implementation of the same wire format, and nothing until now proved the two
 * agree. Everything here is the code the browser actually runs — only the
 * editor binding on top of it is absent.
 *
 * Node 24 has a global WebSocket, so no polyfill is involved.
 *
 * Needs the stack up (`docker compose up`) plus the Auth emulator, since a
 * real token is what the Gateway checks before the socket is allowed through.
 */
const GATEWAY = process.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';
const EMULATOR = process.env.VITE_FIREBASE_AUTH_EMULATOR ?? 'http://localhost:9099';

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

/** A real Firebase ID token from the emulator, the same one the web SDK would
 * hand back after a sign-up. */
async function signUp(): Promise<string> {
  const res = await fetch(
    `${EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `web-${Math.random().toString(36).slice(2)}@example.com`,
        password: 'password123',
        returnSecureToken: true,
      }),
    },
  );
  return ((await res.json()) as { idToken: string }).idToken;
}

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

/** Two signed-in users matched into one session, exactly as the app does it. */
async function matchedSession(): Promise<{ sessionId: string; tokens: [string, string] }> {
  const tokens = [await signUp(), await signUp()] as [string, string];
  // The lazy upsert: /match/join refuses a uid Users has never seen.
  for (const token of tokens) {
    await fetch(`${GATEWAY}/users/me`, { headers: authed(token) });
  }

  const body = JSON.stringify({ topic: 'ai-tooling', difficulty: 'hard' });
  const headers = { 'content-type': 'application/json' };
  await fetch(`${GATEWAY}/match/join`, {
    method: 'POST',
    headers: { ...headers, ...authed(tokens[0]) },
    body,
  });
  const res = await fetch(`${GATEWAY}/match/join`, {
    method: 'POST',
    headers: { ...headers, ...authed(tokens[1]) },
    body,
  });
  const matched = (await res.json()) as { session?: { id: string } };
  return { sessionId: matched.session?.id ?? '', tokens };
}

async function until(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition not met within timeout');
}

describe.skipIf(!process.env.CI && process.env.VITE_GATEWAY_URL === undefined)(
  'the browser collab client',
  () => {
    it('receives the scaffold and syncs edits with a second client', async (ctx) => {
      if (!(await reachable())) return ctx.skip();
      const { sessionId, tokens } = await matchedSession();
      expect(sessionId).not.toBe('');

      const statuses: CollabStatus[] = [];
      const a = connectCollab({
        sessionId,
        token: tokens[0],
        onStatus: (s) => statuses.push(s),
      });
      const b = connectCollab({
        sessionId,
        token: tokens[1],
        onStatus: () => {},
      });

      try {
        const textOf = (handle: typeof a) => handle.doc.getText('content').toString();

        // The scaffold arrives as the server's reply to our sync step 1 —
        // proving the outbound framing was understood, not just accepted.
        await until(() => textOf(a).length > 0 && textOf(b).length > 0);
        expect(statuses).toContain('connected');
        expect(textOf(a)).toBe(textOf(b));
        // The scaffold is a numbered list of the question's parts.
        expect(textOf(a)).toMatch(/^1\. /);

        // An edit made after syncing is an incremental update parented to the
        // server's structs — the shape that only applies on a document that
        // already agrees about identity.
        a.doc.getText('content').insert(0, 'typed in the browser client. ');
        await until(() => textOf(b).includes('typed in the browser client. '));
        expect(textOf(b)).toBe(textOf(a));

        // Presence: this is what the editor binding draws the remote caret from. It is
        // also asserted to be *anonymous* — awareness is broadcast to everyone
        // in the room, so anything identifying in here would be handed to
        // whoever you were matched with.
        await until(() => a.awareness.getStates().size >= 2);
        const published = [...a.awareness.getStates().values()];
        expect(published.length).toBeGreaterThanOrEqual(2);
        expect(JSON.stringify(published)).not.toContain('@');
      } finally {
        a.destroy();
        b.destroy();
      }
    }, 30_000);

    it('reports unauthorized rather than hanging when the token is rejected', async (ctx) => {
      if (!(await reachable())) return ctx.skip();
      const { sessionId } = await matchedSession();

      const statuses: CollabStatus[] = [];
      const handle = connectCollab({
        sessionId,
        token: 'not-a-real-token',
        onStatus: (s) => statuses.push(s),
      });

      try {
        // The Gateway refuses before the upgrade, so the socket never opens —
        // which the client has to report as a terminal state rather than
        // retrying forever against a token that will never work.
        await until(() => statuses.includes('unauthorized'));
        expect(statuses).not.toContain('connected');
      } finally {
        handle.destroy();
      }
    }, 30_000);
  },
);
