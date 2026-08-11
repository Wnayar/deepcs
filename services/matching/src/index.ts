import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createService, probe } from '@deepcs/shared/service';
import { createPool, pingDb } from '@deepcs/shared/db';
import { createRedis, pingRedis } from '@deepcs/shared/redis';
import { getUserId } from '@deepcs/shared/headers';
import { SERVICES } from '@deepcs/shared/services';
import { createRedisEventLog, emitEvent } from '@deepcs/shared/events';
import { checkUserExists, fetchReferenceMd, findQuestion } from './clients.js';
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
// events are emitted here (the overview §5).
const events = createRedisEventLog(redis);

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

/**
 * Shapes a session for the response.
 *
 * The other participant's uid is deliberately not in here. A session is
 * anonymous by design — the editor shows an unnamed remote caret and awareness
 * carries no identity — so naming the other person in this payload would be the
 * one place the whole flow leaks who you were matched with. Nothing needs it:
 * Collab authorizes each socket against the caller's own uid, and the UI has
 * only ever printed it.
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

/** The channel both session lifecycle events go out on. Collab subscribes to
 * it per room; see services/collab/src/rooms.ts. */
function sessionChannel(sessionId: string): string {
  return `match:session:${sessionId}`;
}

/** Where a single user is told things that happened to them. Keyed by uid
 * rather than by session, because the whole point is to reach somebody who does
 * not know a session exists yet. */
function userChannel(uid: string): string {
  return `match:user:${uid}`;
}

/** How often to write a comment line into an idle stream.
 *
 * Nothing reads it. It exists because an HTTP response with no bytes flowing
 * looks abandoned to anything sitting in the middle, and proxies and load
 * balancers close idle connections on their own schedule. It is also what lets
 * the browser tell a working-but-quiet stream from a broken one. */
const SSE_HEARTBEAT_MS = 20_000;

/**
 * Announces something that happened to a session. Fire-and-forget on purpose:
 * a Redis hiccup must not fail the request that caused it, because the durable
 * record is the Postgres row either way. The consequence of a dropped
 * `session.ended` is a room that stays open until its last socket leaves,
 * which is the behaviour that existed before this channel was consumed at all.
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
    return reply.send(toResponse(existing));
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

  // Collab does not consume this one — a client learns its session id from
  // this very response. It stays for a future live-status channel, and it is
  // now tagged with a type so a subscriber can tell it apart from the
  // `session.ended` published below on the same channel.
  await publishSessionEvent(req, session.id, {
    type: 'match.created',
    sessionId: session.id,
    questionId,
    users: [uid, partnerUid],
  });

  // And to each participant by name. This is what replaced polling: the person
  // who queued first is matched by *this* request, so without a message aimed
  // at them they have no way to find out except by asking again and again.
  // Both sides get one, because the joiner's own response can still be lost.
  const announcement = JSON.stringify({ type: 'matched', ...toResponse(session).session });
  await Promise.all(
    [uid, partnerUid].map((who) =>
      redis
        .publish(userChannel(who), announcement)
        .catch((err: unknown) => req.log.warn({ err, user_id: who }, 'user event publish failed')),
    ),
  );

  return reply.code(201).send(toResponse(session));
});

/**
 * A stream of things that happen to the caller, e.g.
 *   GET /match/events        (X-User-Id: alice)
 * holds the response open and writes `data: {"type":"matched",...}` when a
 * partner arrives.
 *
 * Server-sent events, which is an ordinary HTTP response the server declines to
 * finish. That is the whole mechanism: no upgrade handshake, no second
 * protocol, so the Gateway proxies it, `X-User-Id` reaches here, and logging
 * works, all exactly as they do for every other route.
 *
 * It replaced polling. Being matched is caused by somebody else's request, and
 * HTTP gives a server no way to speak first, so a client that wants to know had
 * to keep asking. Asking every few seconds kept the database awake and every
 * service busy for people who were doing nothing, and slowing it down to fix
 * that meant learning about your partner up to twenty seconds late while they
 * sat alone in the editor. Neither problem exists here: nothing is spent while
 * nothing happens, and the message arrives when it arrives.
 */
app.get('/match/events', async (req, reply) => {
  const uid = getUserId(req);
  if (!uid) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  // Fastify must not try to send a reply of its own: this handler owns the
  // socket from here and writes to it directly until the client goes away.
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    // `no-transform` is the load-bearing half. Anything that buffers or
    // compresses this response turns a stream into one silent pause followed
    // by everything at once, which is the failure mode of every SSE endpoint
    // that has ever quietly not worked.
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  reply.raw.write(': open\n\n');

  // Its own connection, because a subscribed ioredis client cannot run ordinary
  // commands and this one is shared with the queue and every other route.
  //
  // The offline queue goes back on for it, exactly as Collab does for its room
  // subscriber. @deepcs/shared/redis turns it off so that a user-facing request
  // fails fast rather than hanging, which is right for a request; this is a
  // long-lived listener, and subscribing before the freshly duplicated socket
  // has finished connecting should wait rather than throw. Without it this
  // route opened, streamed its heartbeats, and silently delivered nothing.
  const subscriber = redis.duplicate({ enableOfflineQueue: true });
  const send = (payload: string) => reply.raw.write(`data: ${payload}\n\n`);

  try {
    await subscriber.subscribe(userChannel(uid));
  } catch (err) {
    req.log.error({ err, user_id: uid }, 'could not subscribe to user events');
    // duplicate() has already opened a socket, so it has to be closed or it
    // reconnects for the life of the process, once per failed stream.
    subscriber.disconnect();
    reply.raw.end();
    return;
  }
  subscriber.on('message', (_channel, payload) => send(payload));

  // The race this closes: a partner can arrive between the join response and
  // this stream being opened, and that message is published to nobody. Sending
  // the current state on connect means the answer is never missed, only ever
  // repeated, and a repeat is harmless because the client acts on a session id.
  try {
    const existing = await findActiveSessionForUser(pool, uid);
    if (existing) send(JSON.stringify({ type: 'matched', ...toResponse(existing).session }));
  } catch (err) {
    req.log.warn({ err, user_id: uid }, 'could not send current session on connect');
  }

  const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), SSE_HEARTBEAT_MS);

  req.raw.on('close', () => {
    clearInterval(heartbeat);
    subscriber.disconnect();
  });
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
 * an app that has just loaded has neither. Without this route the UI has no
 * way to know you are mid-session, so navigating away from the editor looks
 * like leaving and pressing "find a partner" silently drops you back into the
 * room you never actually left.
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
 * returns `{ participant: true, questionId }` if bob is in that
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

  // An ended session has no participants any more, and this is the only place
  // that needs to say so. Collab authorizes every socket against this route,
  // so refusing here is what actually stops a finished session being rejoined
  // — without Collab knowing that sessions can end at all.
  if (session.endedAt !== null || !isParticipant(session, uid)) {
    return reply.send({ participant: false });
  }

  return reply.send({ ...toResponse(session).session, participant: true });
});

/**
 * Loads a session and confirms the caller belongs to it, or produces the
 * reply explaining why not. Shared by the three routes below, which all begin
 * the same way: valid uuid, authenticated caller, existing session, caller is
 * one of its two people.
 */
async function loadForParticipant(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<Session | null> {
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
    // 403 rather than 404: the caller is authenticated and the session is
    // real, they simply are not in it.
    reply.code(403).send({ error: 'not a participant in this session' });
    return null;
  }

  return session;
}

/**
 * Shapes the reveal state for `callerUid`, fetching the answer from Questions
 * only once both participants have consented.
 *
 * Two booleans rather than the list of uids that consented. The list was the
 * obvious shape and the wrong one twice over: it names the other participant,
 * which nothing else in a session does, and it cannot actually answer the
 * question the UI is asking — "have *I* agreed, and have *they*?" — without the
 * browser knowing its own uid to look for. `you` and `partner` say it directly
 * and say nothing else.
 */
async function toRevealResponse(session: Session, callerUid: string) {
  const partnerUid = session.userAUid === callerUid ? session.userBUid : session.userAUid;
  const you = session.revealConsents.includes(callerUid);
  const partner = session.revealConsents.includes(partnerUid);

  // Both people, not "two consents" — counting entries would release the
  // answer to a pair where one person somehow consented twice.
  if (!(you && partner)) {
    return { you, partner, revealed: false };
  }

  const referenceMd = await fetchReferenceMd(questionsUrl!, session.questionId);
  return { you, partner, revealed: true, referenceMd };
}

/**
 * Agree to reveal the reference answer — e.g.
 *   POST /match/sessions/3f2e1c9a-.../reveal    (X-User-Id: bob)
 * returns `{ you: true, partner: false, revealed: false }` while bob is
 * waiting on his partner, and `{ you: true, partner: true, revealed: true,
 * referenceMd: "..." }` once both have agreed. Pressing it twice is the same
 * as pressing it once.
 *
 * This route is where ADR-06 is enforced: Questions holds the answer but has
 * no idea who is in a session, and this service knows exactly who consented
 * but never stores the answer. Neither can release it alone.
 */
app.post('/match/sessions/:id/reveal', async (req, reply) => {
  const existing = await loadForParticipant(req, reply);
  if (!existing) return reply;

  if (existing.endedAt !== null) {
    return reply.code(409).send({ error: 'session has ended' });
  }

  const session = await addRevealConsent(pool, existing.id, getUserId(req)!);
  if (!session) {
    return reply.code(404).send({ error: 'not found' });
  }
  await emitEvent(events, req.log, 'reveal.consented', { sessionId: session.id });

  try {
    return reply.send(await toRevealResponse(session, getUserId(req)!));
  } catch (err) {
    req.log.error({ err }, 'questions service unavailable');
    return reply.code(503).send({ error: 'questions service unavailable' });
  }
});

/**
 * Has my partner agreed yet? e.g.
 *   GET /match/sessions/3f2e1c9a-.../reveal      (X-User-Id: bob)
 * Same body as the POST above, without recording anything. This is what the
 * session page polls in the gap between one person agreeing and the other.
 */
app.get('/match/sessions/:id/reveal', async (req, reply) => {
  const session = await loadForParticipant(req, reply);
  if (!session) return reply;

  try {
    return reply.send(await toRevealResponse(session, getUserId(req)!));
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
 *
 * The consequence lands in the participant route above: once `endedAt` is set
 * it reports `participant: false`, so Collab stops accepting sockets for this
 * session and the document can no longer be edited.
 */
app.post('/match/sessions/:id/end', async (req, reply) => {
  const existing = await loadForParticipant(req, reply);
  if (!existing) return reply;

  const session = await endSession(pool, existing.id);
  if (!session?.endedAt) {
    return reply.code(404).send({ error: 'not found' });
  }
  await emitEvent(events, req.log, 'session.ended', {
    sessionId: session.id,
    endedAt: new Date().toISOString(),
  });

  // This is what actually closes the live document. Setting `ended_at` only
  // stops *new* sockets — the participant check refuses them — but a socket
  // already open keeps accepting edits, and the 30s snapshot keeps saving
  // them, so the "final" document would carry on changing after the session
  // was over. Collab listens for this and closes the room.
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
