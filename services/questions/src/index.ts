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

/** Read-through cache TTL for the list/search endpoint. Short on purpose: the
 * bank is nearly static, so even a minute of staleness is invisible, but a
 * short TTL means a future write path (there is none yet) can't go stale for
 * long by accident. */
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
 * List / filter / search / paginate the bank. Every query param is optional
 * and they combine (AND) — e.g.
 *   GET /questions?tags=os,networking&difficulty=hard&q=memory&limit=5
 *   → hard questions tagged "os" OR "networking", with "memory" in the title,
 *     at most 5 at a time.
 *
 * Paginate by taking `nextCursor` from one response and passing it as
 * `cursor` on the next call — repeat until `nextCursor` comes back `null`.
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

  // DESIGN.md's phase 2 demoable claim is "cache hits visible" — this is the
  // only place that's true, so it's a header rather than a log line.
  reply.header('x-cache', hit ? 'HIT' : 'MISS');
  return reply.send(result);
});

const idParams = z.object({ id: z.string().uuid() });

/**
 * Get one question by id — e.g. GET /questions/3f2e1c9a-...-b1a4
 * → { id, title, difficulty, parts, tags, createdAt } (no reference_md, see
 * repository.ts). An id that doesn't exist is a 404, not an empty body.
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
