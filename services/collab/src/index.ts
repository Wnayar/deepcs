import websocket from '@fastify/websocket';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type WebSocket from 'ws';
import { createService, probe } from '@deepcs/shared/service';
import { createPool, pingDb } from '@deepcs/shared/db';
import { createRedis, pingRedis } from '@deepcs/shared/redis';
import { getUserId } from '@deepcs/shared/headers';
import { SERVICES } from '@deepcs/shared/services';
import { checkSessionParticipant } from './clients.js';
import { createRoomManager } from './rooms.js';

const pool = createPool();
const redis = createRedis();

// Both are load-bearing: Postgres holds the snapshots a room is rebuilt from,
// and Redis is the only path between two instances holding the same session.
const deps = async () => {
  const [postgres, redisState] = await Promise.all([probe(pingDb(pool)), probe(pingRedis(redis))]);
  return { postgres, redis: redisState };
};

const { app, start } = createService({
  name: 'collab',
  port: SERVICES.collab.port,
  ready: deps,
});

await app.register(websocket);

const matchingUrl = process.env.MATCHING_URL;
if (!matchingUrl) throw new Error('MATCHING_URL is not set');
const questionsUrl = process.env.QUESTIONS_URL;
if (!questionsUrl) throw new Error('QUESTIONS_URL is not set');

const rooms = createRoomManager({ pool, redis, questionsUrl, log: app.log });

app.get('/', async () => ({ service: 'collab', phase: 4 }));

app.get('/health/deps', deps);

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the preHandler below once Matching has confirmed the caller
     * is a participant in this session. */
    collab?: { sessionId: string; uid: string; questionId: string };
  }
}

const connectQuery = z.object({ sessionId: z.string().uuid() });

/**
 * Authorizes a WebSocket handshake before it upgrades — e.g.
 *   wss://gateway/collab/connect?sessionId=<id>&token=<firebase-id-token>
 * (the Gateway verifies `token` and forwards `X-User-Id`; Collab never sees
 * the token itself, same trust model as every other service.) 401 if the
 * Gateway didn't authenticate the caller, 400 for a missing/malformed
 * sessionId, 403 if the caller isn't one of the two people in that session.
 * A rejection here sends a normal HTTP response and the socket never
 * upgrades — the underlying @fastify/websocket route only hijacks the
 * connection once every hook, this one included, has let the request
 * through.
 */
async function authorizeConnect(req: FastifyRequest, reply: FastifyReply) {
  const uid = getUserId(req);
  if (!uid) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const query = connectQuery.safeParse(req.query);
  if (!query.success) {
    return reply.code(400).send({ error: 'invalid query' });
  }

  let authorization;
  try {
    authorization = await checkSessionParticipant(matchingUrl!, query.data.sessionId, uid);
  } catch (err) {
    req.log.error({ err }, 'matching service unavailable');
    return reply.code(503).send({ error: 'matching service unavailable' });
  }
  if (!authorization) {
    return reply.code(403).send({ error: 'not a participant in this session' });
  }

  req.collab = { sessionId: query.data.sessionId, uid, questionId: authorization.questionId };
}

app.get(
  '/collab/connect',
  { websocket: true, preHandler: authorizeConnect },
  async (socket: WebSocket, req) => {
    const { sessionId, questionId } = req.collab!;

    let created: boolean;
    try {
      created = await rooms.attachSocket(socket, sessionId, questionId);
    } catch (err) {
      // Questions unreachable, Redis refusing a subscribe, Postgres down.
      req.log.error({ err, session_id: sessionId }, 'failed to open room');
      socket.close(1011, 'internal error');
      return;
    }

    if (created) {
      // The real emitEvent/event-log pipeline is phase 7 — this is the same
      // structured-log breadcrumb every other lifecycle moment already uses
      // (queue.joined, match.created). Note it marks a room being *opened* on
      // this instance, so a session whose participants all disconnect and come
      // back logs it again; phase 7 has to dedupe on session_id.
      req.log.info({ session_id: sessionId }, 'session.started');
    }
  },
);

app.addHook('onClose', async () => {
  // Every room this instance is still holding gets one last snapshot before
  // the process exits — the SIGTERM leg of "every 30s, on disconnect, and
  // before SIGTERM" (DESIGN.md). Best-effort: a failed snapshot here is a
  // window of lost edits, not a crash.
  await rooms.snapshotAllRooms();
  await pool.end();
  redis.disconnect();
});

await start();
