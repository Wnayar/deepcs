import { z } from 'zod';
import { createService, probe } from '@deepcs/shared/service';
import { createPool, pingDb } from '@deepcs/shared/db';
import { getUserId } from '@deepcs/shared/headers';
import { SERVICES } from '@deepcs/shared/services';
import { profileExists, upsertProfile } from './repository.js';

const pool = createPool();

// Every route here reads or writes Postgres, so an unreachable database means
// this instance can only produce 500s — readiness says no rather than
// accepting traffic it cannot serve.
const deps = async () => ({ postgres: await probe(pingDb(pool)) });

const { app, start } = createService({
  name: 'users',
  port: SERVICES.users.port,
  ready: deps,
});

app.get('/', async () => ({ service: 'users', phase: 1 }));

app.get('/health/deps', deps);

/**
 * The post-sign-in call (DESIGN.md §5). Creates the profile row on first sight
 * of a UID and returns it thereafter.
 *
 * **Ordering matters and is enforced here.** Matching validates a UID against
 * this service, so a user who went straight from sign-in to the queue would be
 * rejected for having no row yet. Pinning the upsert to this call is what
 * guarantees the row exists before anything else asks about it.
 */
app.get('/users/me', async (req, reply) => {
  const uid = getUserId(req);
  if (!uid) {
    /**
     * Absent means anonymous, not "trust whatever arrived" (§6). This route is
     * not public, so anonymous is 401 — but the *decision* is made here, by the
     * service that owns the resource, not by the header reader.
     */
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const { profile, created } = await upsertProfile(pool, uid);

  if (created) {
    /**
     * Phase 6 replaces this with emitEvent('user.signed_up', ...) behind the
     * EventLog interface. It is a log line now rather than nothing, so that the
     * "exactly once per user" property is observable before there is a
     * consumer to prove it.
     */
    req.log.info({ user_id: uid, profile_id: profile.id }, 'user.signed_up');
  }

  return reply.code(created ? 201 : 200).send(profile);
});

/**
 * Matching's validation call (§5). Kept deliberately thin — it answers one
 * question and reveals nothing else about the user, because Matching has no
 * business knowing anything else.
 */
const uidParams = z.object({
  /**
   * zod on every endpoint (§6). Firebase UIDs are 28 characters today, but the
   * bound here is a sanity check rather than a format assertion: pinning the
   * exact length would make this service fail the day Google changes it, for no
   * security benefit — the UID is already proven by the Gateway's signature
   * check before it ever reaches this header.
   */
  uid: z.string().min(1).max(128),
});

app.get('/users/:uid/exists', async (req, reply) => {
  const parsed = uidParams.safeParse(req.params);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid uid' });
  }

  const exists = await profileExists(pool, parsed.data.uid);
  return reply.send({ exists });
});

/**
 * Close the pool on shutdown so in-flight queries finish and Postgres reclaims
 * the connections immediately rather than waiting for them to time out. The
 * signal handling itself lives in createService (§6).
 */
app.addHook('onClose', async () => {
  await pool.end();
});

await start();
