import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@deepcs/shared/db';
import type { DomainEvent } from '@deepcs/shared/events';
import { applyBatch } from './consumer.js';
import { readSummary } from './repository.js';

/**
 * Real Postgres, because what is under test is what the database does with a
 * repeated write, and a mock would only assert that the mock agrees with itself.
 *
 * The property: delivery from the log is at-least-once, so the consumer must
 * turn a repeated event into a repeated *write* and not a repeated *row*.
 * Every test here applies the same batch twice and expects the second pass to
 * change nothing.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs';

let pool: ReturnType<typeof createPool>;
let reachable = false;
// Hex, because these become uuids. Base36 runs past `f` and produces ids
// Postgres rejects outright, which fails the test for the wrong reason.
const suffix = Math.random().toString(16).slice(2, 8).padEnd(6, '0');

/** A uuid that is stable per test but unique per run, so tests do not collide
 * with each other or with rows left by the running app. */
const sessionId = (n: number) => `00000000-0000-4000-8000-${suffix}${String(n).padStart(6, '0')}`;

const event = (
  type: DomainEvent['type'],
  data: Record<string, string>,
  id = '1-1',
): DomainEvent => ({
  id,
  type,
  data,
});

const matchCreated = (session: string, over: Record<string, string> = {}) =>
  event('match.created', {
    sessionId: session,
    questionId: '11111111-1111-4111-8111-111111111111',
    topic: 'os',
    difficulty: 'easy',
    participants: 'alice,bob',
    waitedSeconds: '4.5',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });

beforeAll(async () => {
  pool = createPool({ connectionString: ADMIN_URL, max: 2 });
  try {
    await pool.query('SELECT 1 FROM stats.session_summaries LIMIT 1');
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await pool.query('DELETE FROM stats.session_summaries WHERE session_id::text LIKE $1', [
      `%${suffix}%`,
    ]);
    await pool.query('DELETE FROM stats.signups WHERE user_id LIKE $1', [`%${suffix}%`]);
    await pool.query('DELETE FROM stats.queue_joins WHERE user_id LIKE $1', [`%${suffix}%`]);
  }
  await pool?.end();
});

const count = async (sql: string, param: string): Promise<number> =>
  Number((await pool.query<{ n: string }>(sql, [param])).rows[0]!.n);

describe('applying a batch twice', () => {
  it('leaves one summary, not two', async (ctx) => {
    if (!reachable) return ctx.skip();
    const session = sessionId(1);
    const batch = [matchCreated(session)];

    await applyBatch(pool, batch);
    await applyBatch(pool, batch);

    expect(
      await count(
        'SELECT count(*) AS n FROM stats.session_summaries WHERE session_id = $1',
        session,
      ),
    ).toBe(1);
  });

  it('leaves one signup per user, however many times the event arrives', async (ctx) => {
    if (!reachable) return ctx.skip();
    const user = `alice-${suffix}`;
    const batch = [event('user.signed_up', { userId: user })];

    await applyBatch(pool, batch);
    await applyBatch(pool, batch);
    await applyBatch(pool, batch);

    expect(await count('SELECT count(*) AS n FROM stats.signups WHERE user_id = $1', user)).toBe(1);
  });

  it('keeps queue joins apart by log id, since the payload repeats legitimately', async (ctx) => {
    if (!reachable) return ctx.skip();
    const user = `queuer-${suffix}`;
    const payload = { userId: user, topic: 'os', difficulty: 'easy' };

    // Same user, same topic, twice: joined, gave up, joined again. Both are
    // real, so this must NOT be deduplicated. Only a repeat of the same log
    // entry may be.
    await applyBatch(pool, [event('queue.joined', payload, `${suffix}-1`)]);
    await applyBatch(pool, [event('queue.joined', payload, `${suffix}-2`)]);
    await applyBatch(pool, [event('queue.joined', payload, `${suffix}-2`)]);

    expect(
      await count('SELECT count(*) AS n FROM stats.queue_joins WHERE user_id = $1', user),
    ).toBe(2);
  });

  it('keeps the first connection time, not the latest', async (ctx) => {
    if (!reachable) return ctx.skip();
    const session = sessionId(2);
    await applyBatch(pool, [matchCreated(session)]);

    // Collab emits this per room opened, so a session whose participants leave
    // and return produces several, in order. The first is the one that means
    // anything.
    await applyBatch(pool, [
      event('session.started', { sessionId: session, connectedAt: '2026-01-01T00:05:00.000Z' }),
    ]);
    await applyBatch(pool, [
      event('session.started', { sessionId: session, connectedAt: '2026-01-01T00:09:00.000Z' }),
    ]);

    const { rows } = await pool.query<{ first_connected_at: Date }>(
      'SELECT first_connected_at FROM stats.session_summaries WHERE session_id = $1',
      [session],
    );
    expect(rows[0]!.first_connected_at.toISOString()).toBe('2026-01-01T00:05:00.000Z');
  });

  it('rolls the whole batch back when one event in it is malformed', async (ctx) => {
    if (!reachable) return ctx.skip();
    const good = sessionId(3);

    // The second event is missing `sessionId`. Without the transaction the
    // first would be written and then redelivered on top of itself; with it,
    // the batch that comes back finds the database exactly as it left it.
    await expect(
      applyBatch(pool, [matchCreated(good), event('session.ended', { endedAt: 'now' })]),
    ).rejects.toThrow(/missing "sessionId"/);

    expect(
      await count('SELECT count(*) AS n FROM stats.session_summaries WHERE session_id = $1', good),
    ).toBe(0);
  });
});

describe('the read side', () => {
  it('shows a summary to a participant and hides it from everyone else', async (ctx) => {
    if (!reachable) return ctx.skip();
    const session = sessionId(4);
    await applyBatch(pool, [
      matchCreated(session, { participants: `alice-${suffix},bob-${suffix}` }),
    ]);

    expect((await readSummary(pool, session, `alice-${suffix}`))?.topic).toBe('os');
    expect((await readSummary(pool, session, `bob-${suffix}`))?.topic).toBe('os');

    // Not an error, and not a 403 either: the route turns this into a 404,
    // because 403 would confirm the session exists to somebody with no
    // business knowing that.
    expect(await readSummary(pool, session, `carol-${suffix}`)).toBeNull();
  });

  it('never returns the other participant', async (ctx) => {
    if (!reachable) return ctx.skip();
    const session = sessionId(5);
    await applyBatch(pool, [
      matchCreated(session, { participants: `alice-${suffix},bob-${suffix}` }),
    ]);

    // The uids are in the table, because membership cannot be checked without
    // them. They must not come back out: a session is anonymous everywhere
    // else, and a summary is not the place that stops being true.
    const summary = await readSummary(pool, session, `alice-${suffix}`);
    expect(JSON.stringify(summary)).not.toContain(`bob-${suffix}`);
  });
});
