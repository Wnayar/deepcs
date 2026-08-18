import { z } from 'zod';
import { createService, probe } from '@deepcs/shared/service';
import { createPool, pingDb } from '@deepcs/shared/db';
import { createRedis, pingRedis } from '@deepcs/shared/redis';
import { getUserId } from '@deepcs/shared/headers';
import { SERVICES } from '@deepcs/shared/services';
import { getQuestion, getReferenceMd, getRoadmap, getStep, listQuestions } from './repository.js';
import { cached } from './cache.js';

const pool = createPool();
const redis = createRedis();

const { app, start } = createService({
  name: 'questions',
  port: SERVICES.questions.port,
  // Postgres only. Redis here is a read-through cache in front of a bank that
  // barely changes — losing it makes this service slower, not wrong, so it is
  // reported by /health/deps but must not take the instance out of rotation.
  ready: async () => ({ postgres: await probe(pingDb(pool)) }),
});

/** How long a cached list/search result is reused before asking Postgres
 * again. Short, because the bank barely changes, but long enough that repeat
 * queries during a demo actually hit the cache. */
const LIST_CACHE_TTL_SECONDS = 60;

app.get('/', async () => ({ service: 'questions' }));

// Redis state as information rather than as a readiness answer, since readiness
// above deliberately leaves it out.
app.get('/health/deps', async () => {
  const [postgres, redisState] = await Promise.all([probe(pingDb(pool)), probe(pingRedis(redis))]);
  return { postgres, redis: redisState };
});

const listQuery = z.object({
  // Comma-separated; a question matches if it has ANY of the listed tags —
  // e.g. "os,networking" matches a question tagged just "os".
  tags: z.string().min(1).max(200).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  q: z.string().min(1).max(200).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * List, filter, search, and paginate the bank. Every query param below is
 * optional, and using more than one narrows the results (they combine with
 * AND). For example:
 *
 *   GET /questions?tags=os,networking&difficulty=hard&q=memory&limit=5
 *
 * returns up to 5 hard questions that are tagged "os" or "networking" and
 * have "memory" in the title.
 *
 * To page through results: take `nextCursor` from the response and send it
 * back as the `cursor` param on the next request. Keep going until
 * `nextCursor` is `null` — that means there's nothing left.
 */
app.get('/questions', async (req, reply) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid query' });
  }

  const { tags, ...rest } = parsed.data;
  const filters = {
    ...rest,
    tags: tags
      ?.split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  };

  const cacheKey = `questions:list:${JSON.stringify(filters)}`;
  const { value: result, hit } = await cached(redis, cacheKey, LIST_CACHE_TTL_SECONDS, () =>
    listQuestions(pool, filters),
  );

  // Lets a caller see whether this came from the cache or from Postgres.
  reply.header('x-cache', hit ? 'HIT' : 'MISS');
  return reply.send(result);
});

/**
 * The whole roadmap, e.g.
 *   GET /roadmap
 * returns `{ topics: [{ topic, title, summary, dependsOn, gridX, gridY,
 * steps: [...] }, ...] }` for all ten topics.
 *
 * Public, like the bank. It is teaching material and there is nothing here to
 * gate. It is also one request rather than nine: the screen draws arrows
 * between topics, so a half-loaded roadmap is a wrong roadmap rather than a
 * short one.
 */
app.get('/roadmap', async (_req, reply) => {
  const { value, hit } = await cached(redis, 'questions:roadmap', LIST_CACHE_TTL_SECONDS, () =>
    getRoadmap(pool),
  );
  reply.header('x-cache', hit ? 'HIT' : 'MISS');
  return reply.send({ topics: value });
});

const idParams = z.object({ id: z.string().uuid() });

/**
 * One step: its lesson, its questions, and its sibling steps, e.g.
 *   GET /steps/3f2e1c9a-...-b1a4
 * returns `{ id, topic, topicTitle, step, title, difficulty, parts, lessonMd,
 * siblings }`, or 404.
 *
 * Everything one screen needs in one call. Not cached: the lesson bodies are
 * about 400KB together and each is read once per visit, so caching them trades
 * a primary-key lookup for holding the whole corpus in Redis.
 *
 * No `reference_md`. The answer has its own route below, which checks who is
 * asking; this one is public.
 */
app.get('/steps/:id', async (req, reply) => {
  const parsed = idParams.safeParse(req.params);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid id' });
  }

  const step = await getStep(pool, parsed.data.id);
  if (!step) {
    return reply.code(404).send({ error: 'not found' });
  }

  return reply.send(step);
});

/**
 * Get a single question by id, e.g. GET /questions/3f2e1c9a-...-b1a4.
 * Returns { id, title, difficulty, parts, tags, createdAt } — no
 * `reference_md` (see the note on SUMMARY_COLUMNS in repository.ts). If the
 * id doesn't exist, the response is a 404, not an empty body.
 */
app.get('/questions/:id', async (req, reply) => {
  const parsed = idParams.safeParse(req.params);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid id' });
  }

  const question = await getQuestion(pool, parsed.data.id);
  if (!question) {
    return reply.code(404).send({ error: 'not found' });
  }

  return reply.send(question);
});

/**
 * The answer, for someone studying alone — e.g.
 *   GET /questions/3f2e1c9a-...-b1a4/reference    (signed in)
 * returns `{ referenceMd: "..." }`, or 401 when there is no caller.
 *
 * Being signed in is the whole check, and that is a deliberate narrowing of
 * what the reveal rule claims. It cannot be about secrecy: the lesson for this
 * question teaches the same material and is public. What mutual consent buys is
 * coordination *inside a session* — the answer does not appear on a shared
 * screen until both people say they are done attempting it. Anonymous callers
 * get nothing, so the bank stays browsable signed out without the answer key
 * coming with it.
 */
app.get('/questions/:id/reference', async (req, reply) => {
  const parsed = idParams.safeParse(req.params);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid id' });
  }
  if (!getUserId(req)) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const referenceMd = await getReferenceMd(pool, parsed.data.id);
  if (referenceMd === null) {
    return reply.code(404).send({ error: 'not found' });
  }

  return reply.send({ referenceMd });
});

/**
 * Release a question's answer text, e.g.
 *   GET /internal/questions/3f2e1c9a-...-b1a4/reference
 * returns `{ referenceMd: "## Process vs thread?\n\n..." }`, or 404.
 *
 * The same bytes as the route above, for a different caller. That one answers a
 * signed-in browser and identifies it by `X-User-Id`; this one answers Matching,
 * which acts for a *pair*, holds no user token of its own, and has already
 * checked that both participants consented — a question this service cannot ask.
 *
 * The `/internal` prefix is what keeps it internal. The Gateway proxies a fixed
 * list of prefixes with no filtering on what follows, so anything under
 * `/questions/` is reachable from a browser and has to carry its own check.
 * Nothing proxies `/internal`.
 *
 * Deliberately not cached: putting answer text into a shared Redis key would be
 * a second copy of the thing this service works hardest not to hand out.
 */
app.get('/internal/questions/:id/reference', async (req, reply) => {
  const parsed = idParams.safeParse(req.params);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid id' });
  }

  const referenceMd = await getReferenceMd(pool, parsed.data.id);
  if (referenceMd === null) {
    return reply.code(404).send({ error: 'not found' });
  }

  return reply.send({ referenceMd });
});

app.addHook('onClose', async () => {
  await pool.end();
  redis.disconnect();
});

await start();
