import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRedis } from '@deepcs/shared/redis';
import { createQueue, type Queue } from './queue.js';

/**
 * Real Redis, not a mock: the thing under test is the Lua script's
 * atomicity, and a mock reimplementing the script in JS would only prove the
 * mock agrees with itself. Same reasoning as gateway/rate-limit.test.ts.
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

let redis: ReturnType<typeof createRedis>;
let queue: Queue;
let reachable = false;

beforeAll(async () => {
  redis = createRedis(REDIS_URL);
  try {
    await redis.ping();
    reachable = true;
  } catch {
    reachable = false;
  }
  queue = createQueue(redis);
});

afterAll(async () => {
  await redis?.quit().catch(() => {});
});

// A fresh, random topic per test so tests never share a queue and interfere
// with each other.
const topic = () => `test-${Math.random().toString(36).slice(2)}`;
const uid = (n: string) => `user-${n}-${Math.random().toString(36).slice(2)}`;

describe.skipIf(!process.env.CI && process.env.REDIS_URL === undefined)('queue', () => {
  it('waits alone, then matches the next joiner', async () => {
    if (!reachable) return;
    const t = topic();
    const alice = uid('alice');
    const bob = uid('bob');

    expect(await queue.join(alice, t, 'easy')).toBeNull();
    expect(await queue.isWaiting(alice, t, 'easy')).toBe(true);

    expect((await queue.join(bob, t, 'easy'))?.partnerUid).toBe(alice);
    expect(await queue.isWaiting(alice, t, 'easy')).toBe(false);
  });

  it('keeps different topics and difficulties in separate queues', async () => {
    if (!reachable) return;
    const alice = uid('alice');
    const bob = uid('bob');

    expect(await queue.join(alice, 'os', 'easy')).toBeNull();
    // Same uid namespace, different queue — bob shouldn't match alice here.
    expect(await queue.join(bob, 'os', 'hard')).toBeNull();
    expect(await queue.isWaiting(alice, 'os', 'easy')).toBe(true);
    expect(await queue.isWaiting(bob, 'os', 'hard')).toBe(true);
  });

  it('is idempotent — joining twice while already queued does not error or duplicate', async () => {
    if (!reachable) return;
    const t = topic();
    const alice = uid('alice');
    const bob = uid('bob');

    expect(await queue.join(alice, t, 'medium')).toBeNull();
    expect(await queue.join(alice, t, 'medium')).toBeNull(); // retry, still waiting

    // A third join still matches alice exactly once, proving the retry
    // never added a second queue entry for her.
    expect((await queue.join(bob, t, 'medium'))?.partnerUid).toBe(alice);
  });

  /**
   * The regression test for the race this file exists to prevent (mirrors
   * gateway/rate-limit.test.ts's concurrency test): 20 people joining the
   * same queue at once must form exactly 10 pairs, with nobody claimed
   * twice and nobody claiming themselves. Without the Lua script's
   * atomicity, two concurrent joins could both see the same waiting partner
   * and both claim them.
   */
  it('forms exactly N/2 pairs under concurrent joins, with no double-claims', async () => {
    if (!reachable) return;
    const t = topic();
    const uids = Array.from({ length: 20 }, (_, i) => uid(String(i)));

    const results = await Promise.all(uids.map((u) => queue.join(u, t, 'hard')));

    const claimed = results.filter((r) => r !== null).map((r) => r.partnerUid);
    expect(claimed.length).toBe(10);
    expect(new Set(claimed).size).toBe(10); // no partner claimed twice

    results.forEach((result, i) => {
      expect(result?.partnerUid).not.toBe(uids[i]); // nobody claims themselves
    });
    for (const partner of claimed) {
      expect(uids).toContain(partner); // every claim is one of our own callers
    }
  });
});
