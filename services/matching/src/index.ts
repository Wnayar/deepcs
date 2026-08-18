import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createService, probe } from '@deepcs/shared/service';
import { createPool, pingDb } from '@deepcs/shared/db';
import { createRedis, pingRedis } from '@deepcs/shared/redis';
import { getUserId } from '@deepcs/shared/headers';
import { SERVICES } from '@deepcs/shared/services';
import { createRedisEventLog, emitEvent } from '@deepcs/shared/events';
import { checkUserExists, fetchDisplayName, fetchReferenceMd, findQuestion } from './clients.js';
import { createQueue } from './queue.js';
import {
  addRevealConsent,
  createSession,
  endSession,
  findActiveSessionForUser,
  findSessionById,
  isParticipant,
  type Session,
} from './repository.js';

const pool = createPool();
const redis = createRedis();
const queue = createQueue(redis);
// Matching owns the queue and the session lifecycle, so four of the six domain
// events are emitted here.
const events = createRedisEventLog(redis);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Reached by compose's (and Kubernetes') service-name DNS, not through the
// Gateway: these are server-to-server calls, not client-facing ones.
const usersUrl = requiredEnv('USERS_URL');
const questionsUrl = requiredEnv('QUESTIONS_URL');

const { app, start } = createService({
  name: 'matching',
  port: SERVICES.matching.port,
  // Both, and neither is optional: the queue *is* Redis and the session rows
  // are Postgres, so losing either makes every route here fail.
  ready: async () => {
    const [postgres, redisState] = await Promise.all([
      probe(pingDb(pool)),
      probe(pingRedis(redis)),
    ]);
    return { postgres, redis: redisState };
  },
});

app.get('/', async () => ({ service: 'matching' }));

/**
 * Shapes a session for a response.
 *
 * The other participant's uid is deliberately not in here. A session is
 * anonymous by design — the editor shows an unnamed remote caret and awareness
 * carries no identity — so naming the other person would be the one place the
 * flow leaks who you were matched with. Nothing needs it: Collab authorizes
 * each socket against the caller's own uid.
 */
function toResponse(session: Session) {
  return {
    status: 'matched' as const,
    session: {
      id: session.id,
      questionId: session.questionId,
      createdAt: session.createdAt,
    },
  };
}

/** A session's lifecycle channel. Collab subscribes to it per room; see
 * services/collab/src/rooms.ts. */
function sessionChannel(sessionId: string): string {
  return `match:session:${sessionId}`;
}

/**
 * Announces something that happened to a session. Fire-and-forget on purpose: a
 * Redis hiccup must not fail the request that caused it, because the durable
 * record is the Postgres row either way.
 */
async function publishSessionEvent(
  req: FastifyRequest,
  sessionId: string,
  event: Record<string, unknown>,
): Promise<void> {
  await redis
    .publish(sessionChannel(sessionId), JSON.stringify(event))
    .catch((err: unknown) =>
      req.log.warn({ err, session_id: sessionId }, 'session event publish failed'),
    );
}

const joinBody = z.object({
  // A Questions tag, e.g. "os", matched exactly against the queue for that tag
  // and difficulty.
  topic: z.string().min(1).max(64),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

/**
 * Join the matching queue, or get matched immediately if someone compatible is
 * already waiting — e.g.
 *   POST /match/join { "topic": "os", "difficulty": "hard" }
 * returns `{ status: "matched", session: {...} }` if a partner was found, or
 * `{ status: "waiting" }` if the caller is now the one waiting.
 *
 * Calling this again while already matched or already queued is safe: it
 * returns the existing session or leaves the caller in the queue rather than
 * creating a duplicate. That is what makes the crash recovery below work — a
 * client that has not heard back just calls this again.
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

  // Already matched from an earlier call: hand back the same session instead of
  // touching the queue again.
  const existing = await findActiveSessionForUser(pool, uid);
  if (existing) {
    return reply.send(toResponse(existing));
  }

  // Both external checks run before anything in Redis or Postgres changes, so a
  // Users or Questions outage fails this request cleanly — no queue entry or
  // session left half-created, and so nothing to roll back.
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

  const claim = await queue.join(uid, topic, difficulty);

  if (!claim) {
    await emitEvent(events, req.log, 'queue.joined', { userId: uid, topic, difficulty });
    return reply.send({ status: 'waiting' });
  }

  const { partnerUid, waitedSeconds } = claim;
  const session = await createSession(pool, uid, partnerUid, questionId);
  await emitEvent(events, req.log, 'match.created', {
    sessionId: session.id,
    questionId,
    topic,
    difficulty,
    participants: [uid, partnerUid].join(','),
    // The wait belongs to the person who was already queued, not to the caller,
    // whose wait was zero by definition.
    waitedSeconds: String(waitedSeconds),
    startedAt: session.createdAt.toISOString(),
  });

  // Collab does not consume this one — a client learns its session id from this
  // very response. It is tagged with a type so a subscriber can tell it apart
  // from the `session.ended` published below on the same channel.
  await publishSessionEvent(req, session.id, {
    type: 'match.created',
    sessionId: session.id,
    questionId,
    users: [uid, partnerUid],
  });

  return reply.code(201).send(toResponse(session));
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
 * This is how a match is noticed. Being matched is caused by somebody else's
 * request and HTTP gives a server no way to speak first, so a waiting client
 * asks this every few seconds until it is matched or gives up. Postgres is
 * where the answer comes from, so it is correct no matter which instance
 * handles the call or which one made the match.
 *
 * `"none"` is the crash-recovery case as well as the expiry one, and both mean
 * the same thing to a caller: the claim (Redis) and the session row (Postgres)
 * are not one transaction, so a crash between them leaves a claimed partner
 * with no session, and a queue entry older than WAIT_TTL_SECONDS is dropped on
 * the next call that touches the queue. Either way it means "call /match/join
 * again", not "you are stuck".
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
    return reply.send(toResponse(session));
  }

  if (await queue.isWaiting(uid, topic, difficulty)) {
    return reply.send({ status: 'waiting' });
  }

  return reply.send({ status: 'none' });
});

/**
 * The session I am in right now, if any — e.g.
 *   GET /match/session          (X-User-Id: bob)
 * returns `{ session: {...} }` or `{ session: null }`.
 *
 * `/match/status` cannot answer this: it requires a topic and difficulty, and
 * an app that has just loaded has neither. Without this route the UI has no way
 * to know you are mid-session, so navigating away from the editor looks like
 * leaving and pressing "find a partner" silently drops you back into the room
 * you never actually left.
 */
app.get('/match/session', async (req, reply) => {
  const uid = getUserId(req);
  if (!uid) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const session = await findActiveSessionForUser(pool, uid);
  return reply.send(session ? toResponse(session) : { session: null });
});

const participantParams = z.object({ id: z.string().uuid() });

/**
 * Am *I* in this session? e.g.
 *   GET /match/sessions/3f2e1c9a-.../participant     (X-User-Id: bob)
 * returns `{ participant: true, questionId }` if bob is in that session,
 * `{ participant: false }` if the session exists and he is not, and 404 if the
 * id does not exist at all. Collab calls it to authorize a WebSocket, passing
 * the uid the Gateway verified for that socket.
 *
 * **The subject is the caller's own `X-User-Id`, never a uid in the query
 * string**, and that is the whole access-control story. This route sits under
 * the `/match` prefix, which the Gateway proxies, so a browser can reach it — and
 * a version answering about *any* uid would hand anyone holding a session id the
 * other participant's identity. Only ever answering about yourself makes that
 * impossible to express, which is stronger than remembering to check.
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

  // An ended session has no participants any more, and this is the only place
  // that needs to say so. Collab authorizes every socket against this route, so
  // refusing here is what stops a finished session being rejoined — without
  // Collab knowing that sessions can end at all.
  if (session.endedAt !== null || !isParticipant(session, uid)) {
    return reply.send({ participant: false });
  }

  return reply.send({ ...toResponse(session).session, participant: true });
});

/**
 * Loads a session and confirms the caller belongs to it, or produces the reply
 * explaining why not. Shared by the three routes below, which all begin the
 * same way: valid uuid, authenticated caller, existing session, caller is one
 * of its two people.
 */
async function loadForParticipant(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ session: Session; uid: string } | null> {
  const params = participantParams.safeParse(req.params);
  if (!params.success) {
    reply.code(400).send({ error: 'invalid id' });
    return null;
  }

  const uid = getUserId(req);
  if (!uid) {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }

  const session = await findSessionById(pool, params.data.id);
  if (!session) {
    reply.code(404).send({ error: 'not found' });
    return null;
  }
  if (!isParticipant(session, uid)) {
    // 403 rather than 404: the caller is authenticated and the session is real,
    // they simply are not in it.
    reply.code(403).send({ error: 'not a participant in this session' });
    return null;
  }

  return { session, uid };
}

/**
 * Who you are working with, e.g.
 *   GET /match/sessions/3f2e1c9a-.../partner        (X-User-Id: alice)
 * returns `{ "displayName": "Bob" }`, or `null` for an account made before
 * names existed.
 *
 * **A name, never a uid**, and that distinction is the whole design. The uid is
 * what every other service keys on, so handing it to a browser would let a
 * client address, look up or impersonate somebody. A display name identifies a
 * person to their partner and is useless for anything else, which is why
 * showing one does not reopen what §9 closed.
 *
 * A separate route rather than a field on the session, because `/match/status`
 * is polled every few seconds while somebody waits, and putting a name there
 * would turn one call to Users into twenty a minute for a field nobody can see
 * until they are in the room.
 */
app.get('/match/sessions/:id/partner', async (req, reply) => {
  const loaded = await loadForParticipant(req, reply);
  if (!loaded) return;

  const { session, uid } = loaded;
  const partnerUid = session.userAUid === uid ? session.userBUid : session.userAUid;

  try {
    return reply.send({ displayName: await fetchDisplayName(usersUrl, partnerUid) });
  } catch (err) {
    // A room with an unnamed partner still works, so a Users outage degrades
    // this rather than failing it. The alternative is an editor nobody can open
    // because a label could not be fetched.
    req.log.warn({ err, session_id: session.id }, 'partner name lookup failed');
    return reply.send({ displayName: null });
  }
});

/**
 * Shapes the reveal state for `callerUid`, fetching the answer from Questions
 * only once both participants have consented.
 *
 * Two booleans rather than the list of uids that consented. The list names the
 * other participant, which nothing else in a session does, and it cannot answer
 * what the UI is asking — "have *I* agreed, and have *they*?" — without the
 * browser knowing its own uid to look for.
 */
async function toRevealResponse(session: Session, callerUid: string) {
  const partnerUid = session.userAUid === callerUid ? session.userBUid : session.userAUid;
  const you = session.revealConsents.includes(callerUid);
  const partner = session.revealConsents.includes(partnerUid);

  // Both people, not "two consents" — counting entries would release the answer
  // to a pair where one person somehow consented twice.
  if (!(you && partner)) {
    return { you, partner, revealed: false };
  }

  const referenceMd = await fetchReferenceMd(questionsUrl, session.questionId);
  return { you, partner, revealed: true, referenceMd };
}

/**
 * Agree to reveal the reference answer — e.g.
 *   POST /match/sessions/3f2e1c9a-.../reveal    (X-User-Id: bob)
 * returns `{ you: true, partner: false, revealed: false }` while bob is waiting
 * on his partner, and `{ you: true, partner: true, revealed: true, referenceMd:
 * "..." }` once both have agreed. Pressing it twice is the same as once.
 *
 * This route is where ADR-06 is enforced: Questions holds the answer but has no
 * idea who is in a session, and this service knows exactly who consented but
 * never stores the answer. Neither can release it alone.
 */
app.post('/match/sessions/:id/reveal', async (req, reply) => {
  const loaded = await loadForParticipant(req, reply);
  if (!loaded) return reply;

  if (loaded.session.endedAt !== null) {
    return reply.code(409).send({ error: 'session has ended' });
  }

  const session = await addRevealConsent(pool, loaded.session.id, loaded.uid);
  if (!session) {
    return reply.code(404).send({ error: 'not found' });
  }
  await emitEvent(events, req.log, 'reveal.consented', { sessionId: session.id });

  try {
    return reply.send(await toRevealResponse(session, loaded.uid));
  } catch (err) {
    req.log.error({ err }, 'questions service unavailable');
    return reply.code(503).send({ error: 'questions service unavailable' });
  }
});

/**
 * Has my partner agreed yet? e.g.
 *   GET /match/sessions/3f2e1c9a-.../reveal      (X-User-Id: bob)
 * Same body as the POST above, without recording anything. This is what the
 * session page checks in the gap between one person agreeing and the other.
 */
app.get('/match/sessions/:id/reveal', async (req, reply) => {
  const loaded = await loadForParticipant(req, reply);
  if (!loaded) return reply;

  try {
    return reply.send(await toRevealResponse(loaded.session, loaded.uid));
  } catch (err) {
    req.log.error({ err }, 'questions service unavailable');
    return reply.code(503).send({ error: 'questions service unavailable' });
  }
});

/**
 * Finish a session — e.g.
 *   POST /match/sessions/3f2e1c9a-.../end        (X-User-Id: bob)
 * returns `{ endedAt: "2026-08-11T..." }`. Either participant can end it, and
 * ending an already-ended session returns the original timestamp rather than
 * moving it, so both people's summaries agree.
 */
app.post('/match/sessions/:id/end', async (req, reply) => {
  const loaded = await loadForParticipant(req, reply);
  if (!loaded) return reply;

  const session = await endSession(pool, loaded.session.id);
  if (!session?.endedAt) {
    return reply.code(404).send({ error: 'not found' });
  }
  await emitEvent(events, req.log, 'session.ended', {
    sessionId: session.id,
    endedAt: new Date().toISOString(),
  });

  // This is what actually closes the live document. Setting `ended_at` only
  // stops *new* sockets — the participant route refuses them — but a socket
  // already open keeps accepting edits, and the 30s snapshot keeps saving them,
  // so the "final" document would carry on changing after the session was over.
  // Collab listens for this and closes the room.
  await publishSessionEvent(req, session.id, {
    type: 'session.ended',
    sessionId: session.id,
    endedAt: session.endedAt.toISOString(),
  });

  return reply.send({ endedAt: session.endedAt.toISOString() });
});

app.addHook('onClose', async () => {
  await pool.end();
  redis.disconnect();
});

await start();
