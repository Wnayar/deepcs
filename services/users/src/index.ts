import { z } from 'zod';
import { createService, probe } from '@deepcs/shared/service';
import { createPool, pingDb } from '@deepcs/shared/db';
import { createRedis } from '@deepcs/shared/redis';
import { createRedisEventLog, emitEvent } from '@deepcs/shared/events';
import { getUserId } from '@deepcs/shared/headers';
import { SERVICES } from '@deepcs/shared/services';
import { profileExists, upsertProfile } from './repository.js';

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
app.get('/users/me', async (req, reply) => {
  const uid = getUserId(req);
  if (!uid) {
    // Absent means anonymous, and this route is not public — but the decision
    // is made here, by the service that owns the resource, rather than by the
    // header reader.
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const { profile, created } = await upsertProfile(pool, uid);

  if (created) {
    // The only place this event can come from: there is no signup endpoint, so
    // "a user appeared" is observable exactly once, here, on the insert that
    // created the row.
    await emitEvent(events, req.log, 'user.signed_up', { userId: uid });
  }

  return reply.code(created ? 201 : 200).send(profile);
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
