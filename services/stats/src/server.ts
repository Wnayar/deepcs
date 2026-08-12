import { z } from 'zod';
import { createService, probe } from '@deepcs/shared/service';
import { createPool, pingDb } from '@deepcs/shared/db';
import { getUserId } from '@deepcs/shared/headers';
import { SERVICES } from '@deepcs/shared/services';
import { readSummary, readStats } from './repository.js';

/**
 * The read side of Stats, and the second entrypoint of this image.
 *
 * Draining the log has to be a job, because its trigger is time. Serving a
 * summary does not: that is request-driven like any other read, and it can only
 * be served from here, because the rows live in the `stats` schema and no other
 * role may read it (ADR-09).
 *
 * So the image runs two ways: `index.ts` drains and exits, this serves reads.
 * Under compose that is a one-shot `stats` container and a long-running
 * `stats-api`; on the cluster, a CronJob and a Deployment.
 */
const pool = createPool();

const { app, start } = createService({
  name: 'stats',
  port: SERVICES.stats.port,
  ready: async () => ({ postgres: await probe(pingDb(pool)) }),
});

app.get('/', async () => ({ service: 'stats' }));

/**
 * Public aggregates, e.g.
 *   GET /stats
 * returns sessions per day, the most-solved topics, and how long people wait
 * to be matched.
 *
 * No authentication, deliberately: these are counts of activity with nobody
 * named in them, and an empty stats page is what a first-time visitor would
 * otherwise be shown.
 *
 * Every number is computed by grouping over the summary rows rather than read
 * from a running total. That is not a performance choice, it is what keeps the
 * consumer's writes idempotent: a counter cannot survive the redelivery that
 * at-least-once guarantees. See `consumer.ts`.
 */
app.get('/stats', async (_req, reply) => reply.send(await readStats(pool)));

const summaryParams = z.object({ id: z.string().uuid() });

/**
 * One session's summary, e.g.
 *   GET /sessions/3f2e1c9a-.../summary        (signed in, and a participant)
 * returns what the session was and how it went, or 404.
 *
 * Participants only, and the check is a membership test against the uids the
 * `match.created` event carried. Stats cannot ask Matching who was in a
 * session, because it may not read that schema; the event is how the fact
 * arrived here, which is one of the quieter arguments for a log.
 *
 * A non-participant gets 404 rather than 403. 403 would confirm the session
 * exists, and there is nothing here worth telling a stranger about somebody
 * else's session, not even that it happened.
 */
app.get('/sessions/:id/summary', async (req, reply) => {
  const params = summaryParams.safeParse(req.params);
  if (!params.success) {
    return reply.code(400).send({ error: 'invalid id' });
  }

  const uid = getUserId(req);
  if (!uid) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const summary = await readSummary(pool, params.data.id, uid);
  if (!summary) {
    return reply.code(404).send({ error: 'not found' });
  }

  return reply.send(summary);
});

app.addHook('onClose', async () => {
  await pool.end();
});

await start();
