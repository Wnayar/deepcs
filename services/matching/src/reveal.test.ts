import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

/**
 * The reveal rule, exercised over real HTTP against real services.
 *
 * These drive the routes rather than the repository because the property
 * being protected is a route-level one: ADR-06 says Questions holds the answer
 * and has no idea who is in a session, while Matching knows exactly who
 * consented and never stores the answer — so neither can release it alone.
 * A repository test cannot observe that; it only sees one half.
 *
 * Needs Users, Questions and Matching running (`docker compose up`).
 */
const USERS_URL = process.env.USERS_URL ?? 'http://127.0.0.1:8081';
const MATCHING_URL = process.env.MATCHING_URL ?? 'http://127.0.0.1:8083';
const QUESTIONS_URL = process.env.QUESTIONS_URL ?? 'http://127.0.0.1:8082';
const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8080';

const JSON_HEADERS = { 'content-type': 'application/json' };

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/health/live`)).ok;
  } catch {
    return false;
  }
}

async function allReachable(): Promise<boolean> {
  const up = await Promise.all([
    reachable(USERS_URL),
    reachable(MATCHING_URL),
    reachable(QUESTIONS_URL),
  ]);
  return up.every(Boolean);
}

/** Matches two fresh users the way two browsers would, and returns the pair
 * plus their session id. */
async function matchedPair() {
  const alice = `reveal-a-${Math.random().toString(36).slice(2)}`;
  const bob = `reveal-b-${Math.random().toString(36).slice(2)}`;
  for (const uid of [alice, bob]) {
    await fetch(`${USERS_URL}/users/me`, { headers: { 'x-user-id': uid } });
  }

  // A different topic from the other suites that drive the queue: vitest runs
  // packages in parallel, and two suites sharing one topic+difficulty steal
  // each other's partner.
  const body = JSON.stringify({ topic: 'security', difficulty: 'medium' });
  await fetch(`${MATCHING_URL}/match/join`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'x-user-id': alice },
    body,
  });
  const res = await fetch(`${MATCHING_URL}/match/join`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'x-user-id': bob },
    body,
  });
  const matched = (await res.json()) as { status: string; session?: { id: string } };
  return { alice, bob, sessionId: matched.session?.id ?? '' };
}

/** Any real question id, for the answer-release tests. */
async function firstQuestionId(): Promise<string> {
  const res = await fetch(`${QUESTIONS_URL}/questions?limit=1`);
  return ((await res.json()) as { items: { id: string }[] }).items[0]!.id;
}

const reveal = (sessionId: string, uid: string, method: 'GET' | 'POST' = 'POST') =>
  fetch(`${MATCHING_URL}/match/sessions/${sessionId}/reveal`, {
    method,
    headers: { 'x-user-id': uid },
  });

describe.skipIf(!process.env.CI && process.env.MATCHING_URL === undefined)(
  'the reveal rule',
  () => {
    it('withholds the answer while only one participant has consented', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, sessionId } = await matchedPair();

      const body = (await (await reveal(sessionId, alice)).json()) as Record<string, unknown>;

      expect(body.revealed).toBe(false);
      expect(body).toMatchObject({ you: true, partner: false });
      // The assertion that matters: not merely that a flag says false, but that
      // the answer text is genuinely absent from the payload.
      expect(body).not.toHaveProperty('referenceMd');
    });

    it('releases the answer once both have consented', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, bob, sessionId } = await matchedPair();

      await reveal(sessionId, alice);
      const body = (await (await reveal(sessionId, bob)).json()) as {
        revealed: boolean;
        referenceMd?: string;
      };

      expect(body.revealed).toBe(true);
      expect(body.referenceMd?.length ?? 0).toBeGreaterThan(0);
    });

    it('treats a repeated consent as one, so one person cannot unlock it alone', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, sessionId } = await matchedPair();

      await reveal(sessionId, alice);
      const body = (await (await reveal(sessionId, alice)).json()) as Record<string, unknown>;

      expect(body).toMatchObject({ you: true, partner: false, revealed: false });
    });

    it('refuses a caller who is not in the session', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { sessionId } = await matchedPair();

      const res = await reveal(sessionId, 'a-complete-stranger');

      expect(res.status).toBe(403);
    });

    it('refuses an unauthenticated caller', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { sessionId } = await matchedPair();

      const res = await fetch(`${MATCHING_URL}/match/sessions/${sessionId}/reveal`, {
        method: 'POST',
      });

      expect(res.status).toBe(401);
    });

    it('404s for a session that does not exist', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const res = await reveal(randomUUID(), 'whoever');
      expect(res.status).toBe(404);
    });

    it('lets a participant read consent state without granting it', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, bob, sessionId } = await matchedPair();

      // Bob polling while he waits for Alice must not count as Bob consenting.
      await reveal(sessionId, alice);
      await reveal(sessionId, bob, 'GET');
      const body = (await (await reveal(sessionId, bob, 'GET')).json()) as Record<string, unknown>;

      // Read from Bob's side, so this also pins that the two flags are relative
      // to the caller rather than fixed to userA/userB: the same session state
      // reads `{you: true, partner: false}` for Alice.
      expect(body).toMatchObject({ you: false, partner: true, revealed: false });
    });
  },
);

describe.skipIf(!process.env.CI && process.env.MATCHING_URL === undefined)(
  'ending a session',
  () => {
    it('reports the same ended_at however many times it is ended', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, bob, sessionId } = await matchedPair();

      const end = (uid: string) =>
        fetch(`${MATCHING_URL}/match/sessions/${sessionId}/end`, {
          method: 'POST',
          headers: { 'x-user-id': uid },
        }).then((r) => r.json() as Promise<{ endedAt: string }>);

      const first = await end(alice);
      const second = await end(bob);

      expect(second.endedAt).toBe(first.endedAt);
    });

    /**
     * This is what actually stops an ended session being edited. Collab
     * authorizes every socket against the participant route and knows nothing
     * about ending, so if this kept saying `true` the document would stay
     * writable forever.
     */
    it('stops reporting participants once ended, which is what locks Collab out', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, sessionId } = await matchedPair();

      const participant = () =>
        fetch(`${MATCHING_URL}/match/sessions/${sessionId}/participant`, {
          headers: { 'x-user-id': alice },
        }).then((r) => r.json() as Promise<{ participant: boolean }>);

      expect((await participant()).participant).toBe(true);

      await fetch(`${MATCHING_URL}/match/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: { 'x-user-id': alice },
      });

      expect((await participant()).participant).toBe(false);
    });

    it('refuses a new consent on an ended session', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, sessionId } = await matchedPair();

      await fetch(`${MATCHING_URL}/match/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: { 'x-user-id': alice },
      });

      expect((await reveal(sessionId, alice)).status).toBe(409);
    });

    it('lets a user match again after their session ends', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, sessionId } = await matchedPair();

      await fetch(`${MATCHING_URL}/match/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: { 'x-user-id': alice },
      });

      // Before ended sessions were excluded from the active lookup, this
      // returned the finished session forever and alice could never be
      // matched with anyone again.
      const res = await fetch(`${MATCHING_URL}/match/join`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'x-user-id': alice },
        body: JSON.stringify({ topic: 'debugging', difficulty: 'easy' }),
      });
      const body = (await res.json()) as { status: string; session?: { id: string } };

      // Either outcome proves the point — she is queued, or she matched
      // someone already waiting. What must not happen is being handed the
      // finished session back. Asserting `waiting` specifically would make
      // this test fail whenever a previous run left somebody in this queue.
      expect(['waiting', 'matched']).toContain(body.status);
      expect(body.session?.id ?? null).not.toBe(sessionId);
    });
  },
);

describe.skipIf(!process.env.CI && process.env.MATCHING_URL === undefined)('studying alone', () => {
  /**
   * Deliberately not gated on consent. The lesson for a question teaches the
   * same material and is public, so withholding the crisp version from
   * someone revising by themselves protects nothing and just makes solo
   * practice useless. What mutual consent still buys is coordination inside
   * a session, which is a different thing from secrecy.
   */
  it('gives a signed-in caller the answer with no session involved', async (ctx) => {
    if (!(await allReachable())) return ctx.skip();
    const id = await firstQuestionId();

    const res = await fetch(`${QUESTIONS_URL}/questions/${id}/reference`, {
      headers: { 'x-user-id': 'someone-studying-alone' },
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { referenceMd: string }).referenceMd.length).toBeGreaterThan(0);
  });

  it('gives an anonymous caller nothing', async (ctx) => {
    if (!(await allReachable())) return ctx.skip();
    const id = await firstQuestionId();

    // The bank stays browsable signed out; the answer key does not come
    // with it.
    expect((await fetch(`${QUESTIONS_URL}/questions/${id}/reference`)).status).toBe(401);
  });

  it('is not reachable through the Gateway without a token', async (ctx) => {
    if (!(await allReachable())) return ctx.skip();
    const id = await firstQuestionId();

    // The Gateway strips any inbound X-User-Id, so forging one gets nowhere.
    const res = await fetch(`${GATEWAY_URL}/questions/${id}/reference`, {
      headers: { 'x-user-id': 'forged' },
    });

    expect(res.status).toBe(401);
  });
});

describe.skipIf(!process.env.CI && process.env.MATCHING_URL === undefined)(
  'the session I am in',
  () => {
    it('is null before anything has been joined', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const res = await fetch(`${MATCHING_URL}/match/session`, {
        headers: { 'x-user-id': `nobody-${Math.random().toString(36).slice(2)}` },
      });
      expect(await res.json()).toEqual({ session: null });
    });

    /** What the app asks on load. `/match/status` cannot answer it — that route
     * demands a topic and difficulty the app does not have yet. */
    it('reports the live session without being told the topic', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, sessionId } = await matchedPair();

      const res = await fetch(`${MATCHING_URL}/match/session`, {
        headers: { 'x-user-id': alice },
      });
      const body = (await res.json()) as { session?: { id: string } };

      expect(body.session?.id).toBe(sessionId);
    });

    it('goes back to null once the session ends', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, sessionId } = await matchedPair();
      await fetch(`${MATCHING_URL}/match/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: { 'x-user-id': alice },
      });

      const res = await fetch(`${MATCHING_URL}/match/session`, {
        headers: { 'x-user-id': alice },
      });

      expect(await res.json()).toEqual({ session: null });
    });
  },
);

describe.skipIf(!process.env.CI && process.env.MATCHING_URL === undefined)(
  'a session never names the other participant',
  () => {
    /**
     * Every browser-reachable route that returns a session, checked against the
     * one thing none of them may contain.
     *
     * A session is anonymous everywhere else by construction: awareness carries
     * no identity, and the remote caret is drawn in a single colour precisely so
     * that no name is needed to key it. That only holds if the payload the room
     * is opened from is anonymous too — otherwise all of it is undone by one
     * field, and the leak is silent because the UI need not display it to have
     * already handed it to the browser.
     *
     * Asserting on the serialised body, rather than on named fields, is what
     * makes this survive a refactor: a uid added back under any name at any
     * depth fails here.
     */
    it('is absent from join, status, session and participant', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, bob, sessionId } = await matchedPair();
      expect(sessionId).not.toBe('');

      // Both consent, so the reveal route is exercised in its fullest state —
      // the one that returns the answer, and the one where a list of who
      // consented would name Bob.
      await reveal(sessionId, alice);
      await reveal(sessionId, bob);

      const asAlice = { 'x-user-id': alice };
      const bodies = await Promise.all(
        [
          fetch(`${MATCHING_URL}/match/session`, { headers: asAlice }),
          fetch(`${MATCHING_URL}/match/status?topic=security&difficulty=medium`, {
            headers: asAlice,
          }),
          fetch(`${MATCHING_URL}/match/sessions/${sessionId}/participant`, { headers: asAlice }),
          fetch(`${MATCHING_URL}/match/sessions/${sessionId}/reveal`, { headers: asAlice }),
          fetch(`${MATCHING_URL}/match/join`, {
            method: 'POST',
            headers: { ...JSON_HEADERS, ...asAlice },
            body: JSON.stringify({ topic: 'security', difficulty: 'medium' }),
          }),
        ].map((p) => p.then((r) => r.text())),
      );

      for (const body of bodies) {
        // Each call really returned its payload rather than an error that
        // would trivially contain no uid.
        expect(body).not.toContain('"error"');
        expect(body).not.toContain(bob);
      }
      // And the richest of them was genuinely exercised: consent released the
      // answer, which is the state where a list of who consented named Bob.
      expect(bodies.some((b) => b.includes('referenceMd'))).toBe(true);
    });
  },
);

describe.skipIf(!process.env.CI && process.env.MATCHING_URL === undefined)(
  'being matched while looking at something else',
  () => {
    /**
     * The person who queues first is matched by somebody else's request.
     *
     * Nothing tells them. They joined, got `{status: "waiting"}`, wandered off
     * to read a lesson, and their partner's join is what created the session.
     * If they are not asking, they never find out, and their partner is alone
     * in the editor waiting for someone who does not know they are expected.
     *
     * The fix is in the browser, where the shell polls from any page rather
     * than only from the match screen. This is the contract that fix leans on:
     * the session is discoverable by asking, with no memory of having queued
     * and no parameters describing what was queued for.
     */
    it('leaves the session findable by the person who never polled', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();

      const alice = `away-a-${Math.random().toString(36).slice(2)}`;
      const bob = `away-b-${Math.random().toString(36).slice(2)}`;
      for (const uid of [alice, bob]) {
        await fetch(`${USERS_URL}/users/me`, { headers: { 'x-user-id': uid } });
      }

      const body = JSON.stringify({ topic: 'behavioural', difficulty: 'hard' });
      const first = (await (
        await fetch(`${MATCHING_URL}/match/join`, {
          method: 'POST',
          headers: { ...JSON_HEADERS, 'x-user-id': alice },
          body,
        })
      ).json()) as { status: string };
      expect(first.status).toBe('waiting');

      // Alice asks nothing from here on. Bob turning up is the whole event.
      await fetch(`${MATCHING_URL}/match/join`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'x-user-id': bob },
        body,
      });

      // `/match/session` takes no topic or difficulty: a client that has
      // forgotten what it queued for, or was reloaded since, can still find
      // its way back. That is what makes one poll in the shell enough.
      const found = (await (
        await fetch(`${MATCHING_URL}/match/session`, { headers: { 'x-user-id': alice } })
      ).json()) as { session: { id: string } | null };

      expect(found.session).not.toBeNull();

      // And it is the same room, not a second one.
      const bobs = (await (
        await fetch(`${MATCHING_URL}/match/session`, { headers: { 'x-user-id': bob } })
      ).json()) as { session: { id: string } | null };
      expect(found.session!.id).toBe(bobs.session!.id);
    });

    /**
     * The shell's actual loop, which nothing else here drives: the waiter asks
     * `/match/status` on a timer and the answer flips under them when their
     * partner arrives. Being matched is caused by somebody else's request, so
     * this transition is the only way the waiting side ever finds out.
     *
     * Asserted through the same route and in the same order the browser uses,
     * because "the row exists" and "the person waiting is told about it" are
     * different claims, and only the second one is the feature.
     */
    it('flips a waiter from waiting to matched on the next status ask', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();

      const alice = `poll-a-${Math.random().toString(36).slice(2)}`;
      const bob = `poll-b-${Math.random().toString(36).slice(2)}`;
      for (const uid of [alice, bob]) {
        await fetch(`${USERS_URL}/users/me`, { headers: { 'x-user-id': uid } });
      }

      // A topic and difficulty no other suite joins: these all share one Redis,
      // and two suites on one queue steal each other's partners.
      const topic = 'deadlock';
      const difficulty = 'medium';
      const body = JSON.stringify({ topic, difficulty });
      const status = async (uid: string) =>
        (await (
          await fetch(`${MATCHING_URL}/match/status?topic=${topic}&difficulty=${difficulty}`, {
            headers: { 'x-user-id': uid },
          })
        ).json()) as { status: string; session?: { id: string } };

      await fetch(`${MATCHING_URL}/match/join`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'x-user-id': alice },
        body,
      });

      // The first tick of the loop, before anything has happened.
      expect((await status(alice)).status).toBe('waiting');

      const claim = (await (
        await fetch(`${MATCHING_URL}/match/join`, {
          method: 'POST',
          headers: { ...JSON_HEADERS, 'x-user-id': bob },
          body,
        })
      ).json()) as { status: string; session: { id: string } };
      expect(claim.status).toBe('matched');

      // The next tick, and the whole point: Alice sent no request between the
      // two asks, and nobody sent her anything.
      const told = await status(alice);
      expect(told.status).toBe('matched');
      expect(told.session?.id).toBe(claim.session.id);
    });
  },
);

describe.skipIf(!process.env.CI && process.env.MATCHING_URL === undefined)(
  'the partner name in a session',
  () => {
    /** Two named users, matched. Names are set at sign-up, which is the only
     * moment `/users/me` records one. */
    async function namedPair() {
      const alice = `name-a-${Math.random().toString(36).slice(2)}`;
      const bob = `name-b-${Math.random().toString(36).slice(2)}`;
      await fetch(`${USERS_URL}/users/me?displayName=Alice%20A`, {
        headers: { 'x-user-id': alice },
      });
      await fetch(`${USERS_URL}/users/me?displayName=Bob%20B`, { headers: { 'x-user-id': bob } });

      const body = JSON.stringify({ topic: 'locks', difficulty: 'medium' });
      await fetch(`${MATCHING_URL}/match/join`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'x-user-id': alice },
        body,
      });
      const res = await fetch(`${MATCHING_URL}/match/join`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'x-user-id': bob },
        body,
      });
      const matched = (await res.json()) as { session: { id: string } };
      return { alice, bob, sessionId: matched.session.id };
    }

    it("tells each participant the other one's name", async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, bob, sessionId } = await namedPair();

      const forAlice = await fetch(`${MATCHING_URL}/match/sessions/${sessionId}/partner`, {
        headers: { 'x-user-id': alice },
      });
      const forBob = await fetch(`${MATCHING_URL}/match/sessions/${sessionId}/partner`, {
        headers: { 'x-user-id': bob },
      });

      expect(await forAlice.json()).toEqual({ displayName: 'Bob B' });
      expect(await forBob.json()).toEqual({ displayName: 'Alice A' });
    });

    /**
     * The line this feature had to walk. Showing a name changes how a session
     * feels; leaking a uid would change what a client can *do*, because a uid is
     * what every other service keys on. The name is answered, the uid is not,
     * and asserting on the whole serialised body is what keeps a future field
     * from quietly reintroducing it.
     */
    it('answers with a name and never with the uid behind it', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, bob, sessionId } = await namedPair();

      const body = await (
        await fetch(`${MATCHING_URL}/match/sessions/${sessionId}/partner`, {
          headers: { 'x-user-id': alice },
        })
      ).text();

      expect(body).toContain('Bob B');
      expect(body).not.toContain(bob);
    });

    it('refuses somebody who is not in the session', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { sessionId } = await namedPair();

      const res = await fetch(`${MATCHING_URL}/match/sessions/${sessionId}/partner`, {
        headers: { 'x-user-id': `stranger-${Math.random().toString(36).slice(2)}` },
      });

      // 403 rather than 404: the session is real, they are simply not in it.
      expect(res.status).toBe(403);
    });

    it('answers null rather than failing for an account with no name', async (ctx) => {
      if (!(await allReachable())) return ctx.skip();
      const { alice, sessionId } = await matchedPair();

      const res = await fetch(`${MATCHING_URL}/match/sessions/${sessionId}/partner`, {
        headers: { 'x-user-id': alice },
      });

      // `matchedPair` signs its users up without a name, which is what every
      // account made before this feature looks like.
      expect(await res.json()).toEqual({ displayName: null });
    });
  },
);
