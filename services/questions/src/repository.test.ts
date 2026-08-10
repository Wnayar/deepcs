import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@deepcs/shared/db';
import { getLesson, getQuestion, listLessons, listQuestions } from './repository.js';

/**
 * Real Postgres, not a mock (§8). The properties under test — cursor
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

describe('lessons', () => {
  it('has one lesson per topic in the bank, each with a body', async (ctx) => {
    if (!reachable) return ctx.skip();

    const lessons = await listLessons(pool);
    const { rows } = await pool.query<{ topic: string }>(
      'SELECT DISTINCT tags[1] AS topic FROM questions.bank',
    );

    // A lesson with no drills, or drills with no lesson, is the failure this
    // guards: the two are joined by `topic` alone, so a typo in either seed
    // produces a page that loads and lists nothing.
    expect(lessons.map((l) => l.topic).sort()).toEqual(rows.map((r) => r.topic).sort());
    expect(lessons.every((l) => l.title.length > 0)).toBe(true);
  });

  it('returns a body for a real topic and null for an unknown one', async (ctx) => {
    if (!reachable) return ctx.skip();

    const lesson = await getLesson(pool, 'os');
    expect(lesson?.bodyMd.length ?? 0).toBeGreaterThan(1_000);
    expect(await getLesson(pool, 'not-a-topic')).toBeNull();
  });

  it('contains no reference answer text', async (ctx) => {
    if (!reachable) return ctx.skip();

    // The reason this test exists. Lessons are extracted from the same notes
    // the question bank came from, and those notes end with the answers — so
    // an extraction that cuts in the wrong place publishes, on a route with no
    // auth at all, the exact text the reveal rule exists to withhold. It has
    // already happened once: the day files head their drills "Part 6 — The
    // Interview Questions, Answered", which a cut anchored to the start of a
    // heading does not match.
    //
    // Slices of each answer are searched for in that topic's lesson. Code
    // examples are excluded because the notes legitimately teach the same
    // snippet they later reference.
    const { rows } = await pool.query<{ topic: string; title: string; hits: string }>(`
      SELECT b.tags[1] AS topic, b.title, count(*) AS hits
      FROM questions.bank b
      JOIN LATERAL (
        SELECT substring(b.reference_md from (length(b.reference_md) * g / 8)::int for 70) AS slice
        FROM generate_series(1, 6) g
      ) s ON true
      JOIN questions.lessons l ON l.topic = b.tags[1]
      WHERE length(s.slice) = 70
        AND s.slice !~ '[;{}()=]'
        AND position(s.slice in l.body_md) > 0
      GROUP BY 1, 2
    `);

    expect(rows).toEqual([]);
  });
});
