import { z } from 'zod';
import { createService, probe } from '@deepcs/shared/service';
import { createPool, pingDb } from '@deepcs/shared/db';
import { createRedis } from '@deepcs/shared/redis';
import { createRedisEventLog, emitEvent } from '@deepcs/shared/events';
import { getUserId } from '@deepcs/shared/headers';
import { SERVICES } from '@deepcs/shared/services';
import {
  profileExists,
  readDisplayName,
  readProgress,
  setProgress,
  upsertProfile,
} from './repository.js';

const pool = createPool();
// Redis is here only to append to the event log. Users has no cache, no queue
// and no pub/sub, so losing Redis must not take this service out of rotation:
// `emitEvent` swallows the failure and the sign-in still succeeds.
const events = createRedisEventLog(createRedis());

const { app, start } = createService({
  name: 'users',
  port: SERVICES.users.port,
  // Every route reads or writes Postgres, so an unreachable database means this
  // instance can only produce 500s.
  ready: async () => ({ postgres: await probe(pingDb(pool)) }),
});

app.get('/', async () => ({ service: 'users' }));

/**
 * The post-sign-in call, e.g.
 *   GET /users/me            (X-User-Id: alice)
 * returns the profile: 201 the first time this uid is seen, 200 after.
 *
 * **Ordering matters and is enforced by where this upsert is.** Matching
 * validates a uid against this service, so a user who went straight from
 * sign-in to the queue would be rejected for having no row yet. The client
 * calls this immediately after signing in, which is what guarantees the row
 * exists before anything else asks about it.
 */
const meQuery = z.object({
  /**
   * Sent by the sign-up form and used only if this call is the one that creates
   * the row. Bounded because it is shown to a partner: long enough for a real
   * name, short enough that it cannot be used to write a paragraph into
   * somebody else's editor header.
   */
  displayName: z.string().trim().min(1).max(40).optional(),
});

app.get('/users/me', async (req, reply) => {
  const uid = getUserId(req);
  if (!uid) {
    // Absent means anonymous, and this route is not public — but the decision
    // is made here, by the service that owns the resource, rather than by the
    // header reader.
    return reply.code(401).send({ error: 'unauthorized' });
  }

  // An unparseable name is ignored rather than refused. This route's job is
  // making sure the row exists, and failing sign-in over a name would be a
  // worse outcome than a row with no name in it.
  const query = meQuery.safeParse(req.query);
  const { profile, created } = await upsertProfile(
    pool,
    uid,
    query.success ? (query.data.displayName ?? null) : null,
  );

  if (created) {
    // The only place this event can come from: there is no signup endpoint, so
    // "a user appeared" is observable exactly once, here, on the insert that
    // created the row.
    await emitEvent(events, req.log, 'user.signed_up', { userId: uid });
  }

  return reply.code(created ? 201 : 200).send(profile);
});

/**
 * Everything this reader has ticked or starred, e.g.
 *   GET /users/me/progress          (X-User-Id: alice)
 * returns `{ "progress": [{ "questionId": "...", "done": true, "starred": false }] }`.
 *
 * The roadmap screen calls this alongside `GET /roadmap` and merges the two in
 * the browser. It has to: the roadmap lives in the `questions` schema and this
 * lives in `users`, and a query spanning them is refused by the database rather
 * than merely discouraged (ADR-09).
 */
app.get('/users/me/progress', async (req, reply) => {
  const uid = getUserId(req);
  if (!uid) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  return reply.send({ progress: await readProgress(pool, uid) });
});

const progressParams = z.object({ questionId: z.string().uuid() });

/** Both flags, always both, because this route replaces state rather than
 * changing part of it. Sending only the one that moved would make the other's
 * absence mean "leave it alone", and then two clicks racing could resurrect a
 * stale value. */
const progressBody = z.object({ done: z.boolean(), starred: z.boolean() });

/**
 * Mark a step done or starred, e.g.
 *   PUT /users/me/progress/e2b0fcfe-a066-48eb-90f9-bbaa12e68b35
 *   { "done": true, "starred": false }              (X-User-Id: alice)
 * returns the stored row.
 *
 * **A replacement, not a toggle**, and the browser fires it on every click
 * without waiting for the answer. Both of those depend on this being
 * idempotent: the same request arriving twice, or arriving out of order after a
 * retry, lands on the same row. A toggle would flip twice and leave the box
 * showing the opposite of the truth with nothing able to detect it.
 *
 * The question id is not checked against the bank. Users cannot see that table,
 * and a row for a question that does not exist is never read back, because the
 * roadmap is what decides which steps are drawn.
 */
app.put('/users/me/progress/:questionId', async (req, reply) => {
  const uid = getUserId(req);
  if (!uid) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const params = progressParams.safeParse(req.params);
  if (!params.success) {
    return reply.code(400).send({ error: 'invalid question id' });
  }

  const body = progressBody.safeParse(req.body);
  if (!body.success) {
    return reply.code(400).send({ error: 'invalid body' });
  }

  const saved = await setProgress(
    pool,
    uid,
    params.data.questionId,
    body.data.done,
    body.data.starred,
  );
  return reply.send(saved);
});

const uidParams = z.object({
  /**
   * A sanity check rather than a format assertion. Firebase uids are 28
   * characters today, and pinning the exact length would break this service the
   * day Google changes it, for no security benefit — the uid was already proven
   * by the Gateway's signature check before it reached this header.
   */
  uid: z.string().min(1).max(128),
});

/**
 * The partner's name for the session room, e.g.
 *   GET /internal/users/abc123/profile
 * returns `{ "displayName": "Alex" }`, or `null` for somebody who signed up
 * before names existed.
 *
 * **Under `/internal`, which the Gateway proxies nothing to**, so only another
 * service can ask. That is the whole access-control story here: a browser must
 * not be able to turn a uid into a person, and the way to guarantee that is for
 * the route not to be reachable rather than for it to check who is calling.
 *
 * Matching is the only caller. It knows both uids in a session already, and it
 * answers the browser with a name and never with the uid it looked up
 * ([`../../../docs/system/04-matching.md`] §9).
 */
app.get('/internal/users/:uid/profile', async (req, reply) => {
  const parsed = uidParams.safeParse(req.params);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid uid' });
  }

  return reply.send({ displayName: await readDisplayName(pool, parsed.data.uid) });
});

/**
 * Matching's validation call, e.g.
 *   GET /users/abc123/exists
 * returns `{ "exists": true }`. Deliberately thin: it answers one question and
 * reveals nothing else, because Matching has no business knowing anything else.
 */
app.get('/users/:uid/exists', async (req, reply) => {
  const parsed = uidParams.safeParse(req.params);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid uid' });
  }

  const exists = await profileExists(pool, parsed.data.uid);
  return reply.send({ exists });
});

// Closing the pool lets in-flight queries finish and Postgres reclaim the
// connections immediately. The signal handling itself is in createService.
app.addHook('onClose', async () => {
  await pool.end();
});

await start();
