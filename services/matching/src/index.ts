import { z } from 'zod';
import { createService, probe } from '@deepcs/shared/service';
import { createPool, pingDb } from '@deepcs/shared/db';
import { createRedis, pingRedis } from '@deepcs/shared/redis';
import { getUserId } from '@deepcs/shared/headers';
import { SERVICES } from '@deepcs/shared/services';
import { checkUserExists, findQuestion } from './clients.js';
import { createQueue } from './queue.js';
import {
  createSession,
  findActiveSessionForUser,
  findSessionById,
  type Session,
} from './repository.js';

const pool = createPool();
const redis = createRedis();
const queue = createQueue(redis);

// Both, and neither is optional here: the queue *is* Redis, and the session
// rows are Postgres. Losing either one makes every route on this service fail.
const deps = async () => {
  const [postgres, redisState] = await Promise.all([probe(pingDb(pool)), probe(pingRedis(redis))]);
  return { postgres, redis: redisState };
};

const { app, start } = createService({
  name: 'matching',
  port: SERVICES.matching.port,
  ready: deps,
});

const usersUrl = process.env.USERS_URL;
if (!usersUrl) throw new Error('USERS_URL is not set');
const questionsUrl = process.env.QUESTIONS_URL;
if (!questionsUrl) throw new Error('QUESTIONS_URL is not set');

app.get('/', async () => ({ service: 'matching', phase: 3 }));

app.get('/health/deps', deps);

/** Shapes a session for the response, from `callerUid`'s point of view —
 * `partnerUid` is whichever side of the pair isn't the caller. */
function toResponse(session: Session, callerUid: string) {
  const partnerUid = session.userAUid === callerUid ? session.userBUid : session.userAUid;
  return {
    status: 'matched' as const,
    session: {
      id: session.id,
      questionId: session.questionId,
      partnerUid,
      createdAt: session.createdAt,
    },
  };
}

const joinBody = z.object({
  // A Questions tag, e.g. "os" — matched exactly against the queue for that
  // tag and difficulty. See repository.ts / queue.ts for how the pairing works.
  topic: z.string().min(1).max(64),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

/**
 * Join the matching queue, or get matched immediately if someone compatible
 * is already waiting — e.g.
 *   POST /match/join { "topic": "os", "difficulty": "hard" }
 * returns `{ status: "matched", session: {...} }` if a partner was found, or
 * `{ status: "waiting" }` if the caller is now the one waiting.
 *
 * Calling this again while already matched or already queued is safe — it
 * returns the existing session or leaves the caller in the queue, rather
 * than creating a duplicate.
 */
app.post('/match/join', async (req, reply) => {
  const uid = getUserId(req);
  if (!uid) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const parsed = joinBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid body' });
  }
  const { topic, difficulty } = parsed.data;

  // Already matched from an earlier call — hand back the same session
  // instead of touching the queue again.
  const existing = await findActiveSessionForUser(pool, uid);
  if (existing) {
    return reply.send(toResponse(existing, uid));
  }

  // Both external checks run before anything in Redis or Postgres changes,
  // so a Users or Questions outage fails this request cleanly — no queue
  // entry or session gets left half-created.
  let exists: boolean;
  try {
    exists = await checkUserExists(usersUrl, uid);
  } catch (err) {
    req.log.error({ err }, 'users service unavailable');
    return reply.code(503).send({ error: 'users service unavailable' });
  }
  if (!exists) {
    return reply.code(400).send({ error: 'user not found' });
  }

  let questionId: string | null;
  try {
    questionId = await findQuestion(questionsUrl, topic, difficulty);
  } catch (err) {
    req.log.error({ err }, 'questions service unavailable');
    return reply.code(503).send({ error: 'questions service unavailable' });
  }
  if (!questionId) {
    return reply.code(404).send({ error: 'no question available for this topic and difficulty' });
  }

  const partnerUid = await queue.join(uid, topic, difficulty);

  if (!partnerUid) {
    req.log.info({ user_id: uid, topic, difficulty }, 'queue.joined');
    return reply.send({ status: 'waiting' });
  }

  const session = await createSession(pool, uid, partnerUid, questionId);
  req.log.info({ session_id: session.id, users: [uid, partnerUid] }, 'match.created');

  // Nothing subscribes to this yet — it's here so Collab (phase 4) or a
  // future live status channel has something to listen for without this
  // route needing to change.
  await redis
    .publish(
      `match:session:${session.id}`,
      JSON.stringify({ sessionId: session.id, questionId, users: [uid, partnerUid] }),
    )
    .catch((err: unknown) => req.log.warn({ err }, 'match event publish failed'));

  return reply.code(201).send(toResponse(session, uid));
});

const statusQuery = z.object({
  topic: z.string().min(1).max(64),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

/**
 * Check whether the caller has been matched yet — e.g.
 *   GET /match/status?topic=os&difficulty=hard
 * returns `{ status: "matched", session }`, `{ status: "waiting" }`, or
 * `{ status: "none" }`.
 *
 * This is the crash-recovery path: the claim (Redis) and the session row
 * (Postgres) aren't one transaction, so if Matching crashes in between, a
 * claimed partner could be left with no session. A client that hasn't heard
 * back within ~10s of joining should call this — `"none"` means "call
 * /match/join again," not "you're stuck."
 */
app.get('/match/status', async (req, reply) => {
  const uid = getUserId(req);
  if (!uid) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const parsed = statusQuery.safeParse(req.query);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid query' });
  }
  const { topic, difficulty } = parsed.data;

  const session = await findActiveSessionForUser(pool, uid);
  if (session) {
    return reply.send(toResponse(session, uid));
  }

  if (await queue.isWaiting(uid, topic, difficulty)) {
    return reply.send({ status: 'waiting' });
  }

  return reply.send({ status: 'none' });
});

const participantParams = z.object({ id: z.string().uuid() });

/**
 * Am *I* in this session? e.g.
 *   GET /match/sessions/3f2e1c9a-.../participant     (X-User-Id: bob)
 * returns `{ participant: true, questionId, partnerUid }` if bob is in that
 * session, `{ participant: false }` if the session exists and he isn't, and
 * 404 if the id doesn't exist at all. Collab calls it to authorize a
 * WebSocket, passing the uid the Gateway verified for that socket.
 *
 * The subject is the caller's own `X-User-Id` rather than a uid in the query
 * string, and that is the whole access-control story. This route lives under
 * the `/match` prefix, which the Gateway proxies, so it is reachable from a
 * browser — and a version that answered about *any* uid would hand anyone
 * holding a session id the other participant's identity. Asking only about
 * yourself makes that impossible to express, which is a stronger guarantee
 * than remembering to check.
 */
app.get('/match/sessions/:id/participant', async (req, reply) => {
  const params = participantParams.safeParse(req.params);
  if (!params.success) {
    return reply.code(400).send({ error: 'invalid id' });
  }

  const uid = getUserId(req);
  if (!uid) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const session = await findSessionById(pool, params.data.id);
  if (!session) {
    return reply.code(404).send({ error: 'not found' });
  }

  if (uid !== session.userAUid && uid !== session.userBUid) {
    return reply.send({ participant: false });
  }

  return reply.send({ ...toResponse(session, uid).session, participant: true });
});

app.addHook('onClose', async () => {
  await pool.end();
  redis.disconnect();
});

await start();
