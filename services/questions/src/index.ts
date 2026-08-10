import { z } from 'zod';
import { createService } from '@deepcs/shared/service';
import { createPool, pingDb } from '@deepcs/shared/db';
import { createRedis, pingRedis } from '@deepcs/shared/redis';
import { SERVICES } from '@deepcs/shared/services';
import { getQuestion, listQuestions } from './repository.js';
import { cached } from './cache.js';

const { app, start } = createService({ name: 'questions', port: SERVICES.questions.port });

const pool = createPool();
const redis = createRedis();

/** How long a cached list/search result is reused before asking Postgres
 * again. Short, because the bank barely changes, but long enough that repeat
 * queries during a demo actually hit the cache. */
const LIST_CACHE_TTL_SECONDS = 60;

app.get('/', async () => ({ service: 'questions', phase: 2 }));

app.get('/health/deps', async () => {
  const [db, rd] = await Promise.allSettled([pingDb(pool), pingRedis(redis)]);
  return {
    postgres: db.status === 'fulfilled' ? 'ok' : 'unreachable',
    redis: rd.status === 'fulfilled' ? 'ok' : 'unreachable',
  };
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

const idParams = z.object({ id: z.string().uuid() });

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

app.addHook('onClose', async () => {
  await pool.end();
  redis.disconnect();
});

await start();
