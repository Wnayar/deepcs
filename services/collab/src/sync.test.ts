import { randomUUID } from 'node:crypto';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { afterAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { createPool } from '@deepcs/shared/db';
import { createRedis } from '@deepcs/shared/redis';
import { createRoomManager, MESSAGE_SYNC, SESSION_ENDED_CODE, toUint8Array } from './rooms.js';

/**
 * The regression tests for the hard part of this service (the overview's
 * "distributed-systems moment"): two people matched into one session can land
 * on *different* Collab instances, and an edit made on one has to reach the
 * other through Redis rather than through anything in-process.
 *
 * These stand up two independent room managers — the same shape two real
 * Collab processes have — over one real Redis and Postgres.
 *
 * Deliberately hermetic: the session id is just a uuid and the only sibling
 * service involved is Questions, for a real question to seed from. Nothing
 * here goes through the match queue. An earlier version did, which made these
 * tests share global queue state with clients.test.ts — vitest runs test files
 * in parallel, so the two could claim each other's partner, and a failed run
 * stranded a user in the queue that broke the *next* run.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const QUESTIONS_URL = process.env.QUESTIONS_URL ?? 'http://127.0.0.1:8082';

let pool: ReturnType<typeof createPool> | undefined;
let redisA: ReturnType<typeof createRedis> | undefined;
let redisB: ReturnType<typeof createRedis> | undefined;

afterAll(async () => {
  await Promise.allSettled([pool?.end(), redisA?.quit(), redisB?.quit()]);
});

async function seedQuestionId(): Promise<string | null> {
  try {
    const res = await fetch(`${QUESTIONS_URL}/questions?limit=1`);
    if (!res.ok) return null;
    const body = (await res.json()) as { items: { id: string }[] };
    return body.items[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Polls until `predicate` holds, so these tests wait on the condition they
 * care about rather than on a fixed sleep that is either slow or flaky. */
async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condition not met within timeout');
}

/**
 * Starts one Collab instance. The route body is a single `attachSocket` call —
 * the same function services/collab/src/index.ts runs — so what these tests
 * cover is the code that ships, not a copy of it. Only authorization is
 * skipped; clients.test.ts covers that separately.
 */
async function startInstance(port: number, redis: ReturnType<typeof createRedis>) {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  const rooms = createRoomManager({
    pool: pool!,
    redis,
    questionsUrl: QUESTIONS_URL,
    log: { error: () => {} },
  });

  app.get('/connect', { websocket: true }, async (socket, req) => {
    const { sessionId, questionId } = req.query as { sessionId: string; questionId: string };
    await rooms.attachSocket(socket, sessionId, questionId);
  });

  await app.listen({ port, host: '127.0.0.1' });
  return { app, rooms };
}

/**
 * A minimal stand-in for a real y-monaco client: it keeps its own `Y.Doc`,
 * opens with a sync step 1, applies whatever the server sends back, and
 * publishes its own edits as incremental updates.
 *
 * The "incremental" part is the whole point. An edit made *after* syncing is
 * parented to the structs the server sent, so it only applies on a doc that
 * already has them — which is exactly the property that broke when each
 * instance seeded its own document independently.
 */
function connectClient(port: number, sessionId: string, questionId: string) {
  const doc = new Y.Doc();
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/connect?sessionId=${sessionId}&questionId=${questionId}`,
  );

  ws.on('open', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    ws.send(encoding.toUint8Array(encoder));
  });

  ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
    if (!isBinary) return;
    const decoder = decoding.createDecoder(toUint8Array(data));
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, reply, doc, 'server');
    if (encoding.length(reply) > 1) ws.send(encoding.toUint8Array(reply));
  });

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'server' || ws.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    ws.send(encoding.toUint8Array(encoder));
  });

  const text = () => doc.getText('content').toString();
  return {
    doc,
    ws,
    text,
    /** Resolves once the scaffold has arrived from the server. */
    ready: () => until(() => text().length > 0),
    close: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.once('close', () => resolve());
        ws.close();
      }),
  };
}

describe.skipIf(!process.env.CI && process.env.QUESTIONS_URL === undefined)('collab rooms', () => {
  it('propagates an incremental edit from one instance to another via Redis', async (ctx) => {
    const questionId = await seedQuestionId();
    if (!questionId) return ctx.skip();

    pool ??= createPool({ connectionString: DATABASE_URL, max: 4 });
    // Two clients, not one shared object — a real Collab process only ever
    // has its own connection.
    redisA ??= createRedis(REDIS_URL);
    redisB ??= createRedis(REDIS_URL);

    const sessionId = randomUUID();
    const a = await startInstance(18184, redisA);
    const b = await startInstance(18185, redisB);
    const clientA = connectClient(18184, sessionId, questionId);
    const clientB = connectClient(18185, sessionId, questionId);

    try {
      await clientA.ready();
      await clientB.ready();

      // Both instances seeded the same question, so both clients must be
      // looking at the same scaffold before anyone edits.
      expect(clientA.text()).toBe(clientB.text());

      // An edit made after syncing — a delta parented to the server's
      // structs, which is what a real editor sends.
      clientA.doc.getText('content').insert(0, 'typed on A. ');

      await until(() => clientB.text().includes('typed on A. '));
      expect(clientB.text()).toBe(clientA.text());
    } finally {
      await Promise.allSettled([clientA.close(), clientB.close()]);
      await Promise.allSettled([a.app.close(), b.app.close()]);
    }
  }, 20_000);

  it('catches a late joiner up on edits it was not connected for', async (ctx) => {
    const questionId = await seedQuestionId();
    if (!questionId) return ctx.skip();

    pool ??= createPool({ connectionString: DATABASE_URL, max: 4 });
    redisA ??= createRedis(REDIS_URL);
    redisB ??= createRedis(REDIS_URL);

    const sessionId = randomUUID();
    const a = await startInstance(18188, redisA);
    const b = await startInstance(18189, redisB);

    try {
      // Only A is connected, and it edits. B's instance has no room for this
      // session yet, so it is not even subscribed — the delta goes past it.
      const clientA = connectClient(18188, sessionId, questionId);
      await clientA.ready();
      clientA.doc.getText('content').insert(0, 'said before B arrived. ');
      await until(() => clientA.text().includes('said before B arrived. '));

      // B opens the session well inside the 30s snapshot window, so there is
      // nothing in Postgres to catch up from — the only source of the
      // missing text is the instance still holding it.
      const clientB = connectClient(18189, sessionId, questionId);
      await clientB.ready();
      await until(() => clientB.text().includes('said before B arrived. '));

      // And the two stay converged for edits made after the catch-up.
      clientA.doc.getText('content').insert(0, 'and after. ');
      await until(() => clientB.text().includes('and after. '));
      expect(clientB.text()).toBe(clientA.text());

      await Promise.allSettled([clientA.close(), clientB.close()]);
    } finally {
      await Promise.allSettled([a.app.close(), b.app.close()]);
    }
  }, 20_000);

  it('restores the document from its snapshot after everyone leaves', async (ctx) => {
    const questionId = await seedQuestionId();
    if (!questionId) return ctx.skip();

    pool ??= createPool({ connectionString: DATABASE_URL, max: 4 });
    redisA ??= createRedis(REDIS_URL);

    const sessionId = randomUUID();
    const instance = await startInstance(18186, redisA);

    try {
      const first = connectClient(18186, sessionId, questionId);
      await first.ready();
      first.doc.getText('content').insert(0, 'survives the disconnect. ');
      await until(() => first.text().includes('survives the disconnect. '));

      // Last socket out snapshots and tears the room down, so the reconnect
      // below has to come back from Postgres rather than from memory.
      await first.close();

      const second = connectClient(18186, sessionId, questionId);
      await second.ready();
      expect(second.text()).toContain('survives the disconnect. ');
      await second.close();
    } finally {
      await instance.app.close();
    }
  }, 20_000);

  /**
   * The bug this exists for: ending a session only ever stopped *new* sockets,
   * because Collab authorizes against Matching's participant check and never
   * heard about ending at all. A socket already open kept accepting edits, and
   * the 30s snapshot kept saving them — so the document carried on changing
   * after the session was over, and the session summary would read whatever it
   * had drifted to.
   */
  it('closes an open socket and stops persisting edits once the session ends', async (ctx) => {
    const questionId = await seedQuestionId();
    if (!questionId) return ctx.skip();

    pool ??= createPool({ connectionString: DATABASE_URL, max: 4 });
    redisA ??= createRedis(REDIS_URL);

    const sessionId = randomUUID();
    const instance = await startInstance(18190, redisA);

    try {
      const client = connectClient(18190, sessionId, questionId);
      await client.ready();
      client.doc.getText('content').insert(0, 'BEFORE. ');
      await until(() => client.text().includes('BEFORE. '));

      // Exactly what Matching publishes from POST /match/sessions/:id/end.
      const closed = new Promise<number>((resolve) => client.ws.once('close', resolve));
      await redisA.publish(
        `match:session:${sessionId}`,
        JSON.stringify({ type: 'session.ended', sessionId }),
      );

      // A distinct close code, so the browser can tell this from a dropped
      // connection and not reconnect forever against a session that will
      // never accept it again.
      expect(await closed).toBe(SESSION_ENDED_CODE);

      // Anything typed now has nowhere to go. The proof is the snapshot: a
      // fresh room built from Postgres must contain the edit made before the
      // end and not the one made after.
      client.doc.getText('content').insert(0, 'AFTER. ');
      await new Promise((resolve) => setTimeout(resolve, 300));

      const survivor = connectClient(18190, sessionId, questionId);
      await survivor.ready();
      expect(survivor.text()).toContain('BEFORE. ');
      expect(survivor.text()).not.toContain('AFTER. ');
      await survivor.close();
    } finally {
      await instance.app.close();
    }
  }, 20_000);

  /**
   * What `/metrics` reports, and the reason the load run can claim no leaked
   * sockets: the counts come from the manager's own bookkeeping, so a socket
   * that closed while its room forgot to release it is exactly what would
   * leave this above zero.
   */
  it('counts a socket and its room while connected, and neither afterwards', async (ctx) => {
    const questionId = await seedQuestionId();
    if (!questionId) return ctx.skip();

    pool ??= createPool({ connectionString: DATABASE_URL, max: 4 });
    redisA ??= createRedis(REDIS_URL);

    const sessionId = randomUUID();
    const instance = await startInstance(18191, redisA);

    try {
      expect(instance.rooms.stats()).toEqual({ sockets: 0, rooms: 0 });

      const client = connectClient(18191, sessionId, questionId);
      await client.ready();
      expect(instance.rooms.stats()).toEqual({ sockets: 1, rooms: 1 });

      // Leaving runs off the close event and snapshots on the way out, so this
      // waits for the count rather than assuming it has already dropped.
      await client.close();
      await until(() => instance.rooms.stats().rooms === 0);
      expect(instance.rooms.stats()).toEqual({ sockets: 0, rooms: 0 });
    } finally {
      await instance.app.close();
    }
  }, 20_000);

  it('survives a malformed frame instead of taking the process down', async (ctx) => {
    const questionId = await seedQuestionId();
    if (!questionId) return ctx.skip();

    pool ??= createPool({ connectionString: DATABASE_URL, max: 4 });
    redisA ??= createRedis(REDIS_URL);

    const sessionId = randomUUID();
    const instance = await startInstance(18187, redisA);

    try {
      const victim = connectClient(18187, sessionId, questionId);
      await victim.ready();

      // MESSAGE_SYNC followed by a sync sub-type that does not exist:
      // y-protocols throws on it, and an uncaught throw inside a `ws`
      // listener would kill the whole process.
      const closed = new Promise<number>((resolve) => victim.ws.once('close', resolve));
      victim.ws.send(Buffer.from([MESSAGE_SYNC, 99]));
      expect(await closed).toBe(1002);

      // The instance is still serving: a new client still gets its scaffold.
      const survivor = connectClient(18187, sessionId, questionId);
      await survivor.ready();
      expect(survivor.text().length).toBeGreaterThan(0);
      await survivor.close();
    } finally {
      await instance.app.close();
    }
  }, 20_000);
});
