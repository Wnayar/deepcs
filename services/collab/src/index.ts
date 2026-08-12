import websocket from '@fastify/websocket';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type WebSocket from 'ws';
import { createService, probe } from '@deepcs/shared/service';
import { createPool, pingDb } from '@deepcs/shared/db';
import { createRedis, pingRedis } from '@deepcs/shared/redis';
import { createRedisEventLog, emitEvent } from '@deepcs/shared/events';
import { getUserId } from '@deepcs/shared/headers';
import { SERVICES } from '@deepcs/shared/services';
import { checkSessionParticipant } from './clients.js';
import { createRoomManager } from './rooms.js';

const pool = createPool();
const redis = createRedis();
const events = createRedisEventLog(redis);

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

app.get('/', async () => ({ service: 'collab' }));

app.get('/health/deps', deps);

/**
 * Prometheus-format counters for the load run (§8) — e.g.
 *   curl http://localhost:8084/metrics
 * The two that matter are the socket count and the resident memory, because
 * they are the pair the k6 run is checked against: the client's own view can
 * say "I have 250 connections open", and only this can say whether the server
 * agrees. A hold that ends with connections back at zero and memory where it
 * started is what "no leaked sockets, flat memory" means.
 *
 * Deliberately not routed through the Gateway, so it is reachable from the
 * compose network and from nowhere else. §6 wants request-rate, error-rate and
 * latency histograms here too, on every service; none of those is built, and
 * none of them is what the load run measures.
 */
app.get('/metrics', async (_req, reply) => {
  const { sockets, rooms: openRooms } = rooms.stats();
  const memory = process.memoryUsage();

  return reply
    .type('text/plain; version=0.0.4')
    .send(
      [
        '# HELP collab_websocket_connections Collaboration sockets attached to this instance.',
        '# TYPE collab_websocket_connections gauge',
        `collab_websocket_connections ${sockets}`,
        '# HELP collab_rooms Sessions this instance is holding a document for.',
        '# TYPE collab_rooms gauge',
        `collab_rooms ${openRooms}`,
        '# HELP process_resident_memory_bytes Resident set size of this process.',
        '# TYPE process_resident_memory_bytes gauge',
        `process_resident_memory_bytes ${memory.rss}`,
        '# HELP nodejs_heap_size_used_bytes Used V8 heap.',
        '# TYPE nodejs_heap_size_used_bytes gauge',
        `nodejs_heap_size_used_bytes ${memory.heapUsed}`,
        '',
      ].join('\n'),
    );
});

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
      // This marks a room being opened *on this instance*, not a session
      // beginning: participants who all disconnect and return open it again,
      // and two instances open it separately. So it arrives more than once per
      // session by design, and Stats keeps only the first via COALESCE rather
      // than this side trying to suppress the repeats, which it cannot see.
      await emitEvent(events, req.log, 'session.started', {
        sessionId,
        connectedAt: new Date().toISOString(),
      });
    }
  },
);

app.addHook('onClose', async () => {
  // Every room this instance is still holding gets one last snapshot before
  // the process exits — the SIGTERM leg of "every 30s, on disconnect, and
  // before SIGTERM" (the overview). Best-effort: a failed snapshot here is a
  // window of lost edits, not a crash.
  await rooms.snapshotAllRooms();
  await pool.end();
  redis.disconnect();
});

await start();
