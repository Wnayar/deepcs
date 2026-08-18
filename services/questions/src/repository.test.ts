import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@deepcs/shared/db';
import { getQuestion, getRoadmap, getStep, listQuestions } from './repository.js';

/**
 * Real Postgres, not a mock. The properties under test — cursor
 * pagination not skipping/duplicating rows, `reference_md` never leaving the
 * repository, and a role being refused another schema — are database
 * semantics or a deliberate omission from a SELECT list; a mock would only
 * assert that the mock agrees with itself.
 *
 * Assumes migrations have been applied: `pnpm --filter @deepcs/db migrate`.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs';
const QUESTIONS_URL =
  process.env.QUESTIONS_DATABASE_URL ??
  'postgresql://questions_svc:questions_svc@127.0.0.1:5432/deepcs';

let pool: ReturnType<typeof createPool>;
let reachable = false;
let seededCount = 0;

beforeAll(async () => {
  pool = createPool({ connectionString: ADMIN_URL, max: 2 });
  try {
    const { rows } = await pool.query('SELECT count(*) FROM questions.bank');
    reachable = true;
    seededCount = Number(rows[0].count);
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  await pool?.end().catch(() => {});
});

describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)(
  'list / filter / search',
  () => {
    it('lists the seeded bank and never exposes reference_md', async () => {
      if (!reachable) return;
      const { items } = await listQuestions(pool, { limit: 50 });

      expect(items.length).toBe(seededCount);
      for (const item of items) {
        expect(item).not.toHaveProperty('referenceMd');
        expect(item).not.toHaveProperty('reference_md');
      }
    });

    it('filters by tag', async () => {
      if (!reachable) return;
      const { items } = await listQuestions(pool, { tags: ['os'], limit: 50 });

      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.tags).toContain('os');
      }
    });

    it('filters by difficulty', async () => {
      if (!reachable) return;
      const { items } = await listQuestions(pool, { difficulty: 'hard', limit: 50 });

      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.difficulty).toBe('hard');
      }
    });

    it('searches by title', async () => {
      if (!reachable) return;
      const { items } = await listQuestions(pool, { q: 'memory', limit: 50 });

      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.title.toLowerCase()).toContain('memory');
      }
    });

    it('returns no rows for a filter that matches nothing', async () => {
      if (!reachable) return;
      const { items, nextCursor } = await listQuestions(pool, {
        q: 'no-such-topic-xyz',
        limit: 20,
      });

      expect(items).toEqual([]);
      expect(nextCursor).toBeNull();
    });
  },
);

describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)(
  'cursor pagination',
  () => {
    it('pages through the whole bank with no duplicates and no gaps', async () => {
      if (!reachable) return;

      const seen = new Set<string>();
      let cursor: string | undefined;

      // Small page size so a 15-row seed actually exercises multiple pages.
      for (let page = 0; page < 20; page++) {
        const result = await listQuestions(pool, { limit: 4, cursor });
        for (const item of result.items) {
          expect(seen.has(item.id)).toBe(false);
          seen.add(item.id);
        }
        if (result.nextCursor === null) break;
        cursor = result.nextCursor;
      }

      expect(seen.size).toBe(seededCount);
    });
  },
);

describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)('get by id', () => {
  it('returns a question without reference_md', async () => {
    if (!reachable) return;
    const { items } = await listQuestions(pool, { limit: 1 });
    const question = await getQuestion(pool, items[0]!.id);

    expect(question).not.toBeNull();
    expect(question).not.toHaveProperty('referenceMd');
  });

  it('returns null for an id that does not exist', async () => {
    if (!reachable) return;
    const question = await getQuestion(pool, '00000000-0000-0000-0000-000000000000');
    expect(question).toBeNull();
  });
});

/**
 * ADR-09's boundary, asserted rather than assumed — same shape as
 * services/users/src/repository.test.ts's schema-isolation suite.
 */
describe.skipIf(!process.env.CI && process.env.DATABASE_URL === undefined)(
  'schema isolation',
  () => {
    it('lets the questions role read its own schema', async () => {
      if (!reachable) return;
      const svc = createPool({ connectionString: QUESTIONS_URL, max: 1 });
      try {
        await expect(svc.query('SELECT 1 FROM questions.bank LIMIT 1')).resolves.toBeDefined();
      } finally {
        await svc.end();
      }
    });

    it('refuses the questions role access to another schema', async () => {
      if (!reachable) return;
      const svc = createPool({ connectionString: QUESTIONS_URL, max: 1 });
      try {
        await expect(svc.query('SELECT 1 FROM users.profiles LIMIT 1')).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        await svc.end();
      }
    });
  },
);

describe('the roadmap and its lessons', () => {
  it('gives every topic three steps, each with a lesson', async (ctx) => {
    if (!reachable) return ctx.skip();

    const topics = await getRoadmap(pool);

    expect(topics).toHaveLength(10);
    for (const topic of topics) {
      // Matching pairs on topic and difficulty and refuses when no question
      // fits, so a topic with a missing step is a pair of users who can never
      // be matched on it.
      expect(topic.steps.map((s) => s.step)).toEqual([1, 2, 3]);
      expect(topic.summary.length).toBeGreaterThan(40);
    }

    // Every prerequisite names a topic that exists, or the roadmap draws an
    // arrow from nowhere.
    const names = new Set(topics.map((t) => t.topic));
    for (const topic of topics) {
      for (const dependency of topic.dependsOn) expect(names.has(dependency)).toBe(true);
    }
  });

  it('points every arrow downward', async (ctx) => {
    if (!reachable) return ctx.skip();

    const topics = await getRoadmap(pool);
    const byName = new Map(topics.map((t) => [t.topic, t]));

    // The whole point of the layout: a topic always sits below everything it
    // assumes you have read. Seeded coordinates make this something a typo can
    // break, and a graph with an arrow pointing up reads as a cycle.
    for (const topic of topics) {
      for (const name of topic.dependsOn) {
        expect(byName.get(name)!.gridY).toBeLessThan(topic.gridY);
      }
    }
  });

  it('loads a step with its lesson and its siblings', async (ctx) => {
    if (!reachable) return ctx.skip();

    const [topic] = await getRoadmap(pool);
    const step = await getStep(pool, topic!.steps[0]!.id);

    expect(step?.lessonMd.length ?? 0).toBeGreaterThan(500);
    expect(step?.parts.length ?? 0).toBeGreaterThan(0);
    expect(step?.siblings.map((s) => s.step)).toEqual([1, 2, 3]);
    expect(await getStep(pool, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('keeps the answers out of the lessons', async (ctx) => {
    if (!reachable) return ctx.skip();

    // The reason this test exists. Lessons are cut out of the same notes the
    // question bank came from, and those notes end with the answers, so an
    // extraction that cuts in the wrong place publishes on a route with no
    // sign-in the exact text the reveal rule exists to withhold. It has already
    // happened once: the day files head their answers "Part 6 - The Interview
    // Questions, Answered", which a cut anchored to the start of a heading does
    // not match.
    //
    // Now that a lesson and its answers are the same row, the comparison is
    // tighter than it was: slices of an answer are looked for in the lesson
    // that teaches it. Code examples are excluded, because the notes
    // legitimately teach the snippet they later reference.
    const { rows } = await pool.query<{ title: string }>(`
      SELECT b.title
      FROM questions.bank b
      JOIN LATERAL (
        SELECT substring(b.reference_md from (length(b.reference_md) * g / 8)::int for 70) AS slice
        FROM generate_series(1, 6) g
      ) s ON true
      WHERE length(s.slice) = 70
        AND s.slice !~ '[;{}()=]'
        AND position(s.slice in b.lesson_md) > 0
      GROUP BY 1
    `);

    expect(rows).toEqual([]);
  });

  it('holds no em dashes in anything a reader sees', async (ctx) => {
    if (!reachable) return ctx.skip();

    // Fixed in the seed rather than stripped in the browser. A rendering-time
    // replacement has to be remembered at every place text is displayed, and
    // the one that gets forgotten is the one nobody looks at.
    const { rows } = await pool.query<{ field: string; n: string }>(`
      SELECT 'bank' AS field,
             sum(length(reference_md || lesson_md || title || parts::text)
               - length(replace(reference_md || lesson_md || title || parts::text, '—', ''))) AS n
      FROM questions.bank
      UNION ALL
      SELECT 'topics', sum(length(title || summary) - length(replace(title || summary, '—', '')))
      FROM questions.topics
    `);

    for (const row of rows) expect(Number(row.n)).toBe(0);
  });
});
