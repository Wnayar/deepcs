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
  // The offline queue back on, because the first command here races its own
  // connect: `createRedis` defaults it off, so a ping issued before the socket
  // is ready throws instead of waiting, and every test below quietly turns into
  // a no-op that still reports as passing.
  redis = createRedis(REDIS_URL, { enableOfflineQueue: true });
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
    // A random topic like every other test here, and not the seeded "os": the
    // suites run concurrently against one Redis, and Collab's contract test
    // pairs two users on os/hard. Sharing that queue lets the two steal each
    // other's partners, which fails whichever one loses the race.
    const t = topic();
    const alice = uid('alice');
    const bob = uid('bob');

    expect(await queue.join(alice, t, 'easy')).toBeNull();
    // Same uid namespace, different queue — bob shouldn't match alice here.
    expect(await queue.join(bob, t, 'hard')).toBeNull();
    expect(await queue.isWaiting(alice, t, 'easy')).toBe(true);
    expect(await queue.isWaiting(bob, t, 'hard')).toBe(true);
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
   * A tab closed mid-queue leaves its entry behind, because there is no leave
   * endpoint and nothing tells the server. Claiming one of those pairs the next
   * caller with somebody who is not there, and the session that gets created is
   * one nobody ever joins. A one-second ttl is the same expiry the service runs
   * with, only short enough to watch happen.
   */
  it('drops an entry that has aged out, so nobody is matched with a ghost', async () => {
    if (!reachable) return;
    const t = topic();
    const ghost = uid('ghost');
    const bob = uid('bob');
    const brief = createQueue(redis, 1);

    expect(await brief.join(ghost, t, 'easy')).toBeNull();
    expect(await brief.isWaiting(ghost, t, 'easy')).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    // Both paths prune, so both have to agree the entry is gone: the reader
    // stops saying "still waiting", and the next joiner waits rather than
    // claiming a partner who stopped asking.
    expect(await brief.isWaiting(ghost, t, 'easy')).toBe(false);
    expect(await brief.join(bob, t, 'easy')).toBeNull();
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
