import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRedis } from '@deepcs/shared/redis';
import { createRateLimiter, type RateLimiter } from './rate-limit.js';

/**
 * These run against a real Redis, never a mock.
 *
 * The thing under test is a Lua script's atomicity, and a mock that
 * reimplements the script in JavaScript would prove only that the mock agrees
 * with itself. The bugs worth catching are in real Redis semantics.
 *
 * CI provides Redis as a service container; locally, `docker compose up redis`.
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

let redis: ReturnType<typeof createRedis>;
let limiter: RateLimiter;
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
  limiter = createRateLimiter(redis);
});

afterAll(async () => {
  await redis?.quit().catch(() => {});
});

const key = (n: string) => `test:rl:${n}:${Math.random().toString(36).slice(2)}`;

describe.skipIf(!process.env.CI && process.env.REDIS_URL === undefined)('token bucket', () => {
  it('allows a burst up to capacity, then refuses', async () => {
    if (!reachable) return;
    const k = key('burst');
    const bucket = { capacity: 3, refillPerSecond: 0.0001 };

    for (let i = 0; i < 3; i++) {
      const r = await limiter.consume(k, bucket);
      expect(r.allowed).toBe(true);
    }

    const denied = await limiter.consume(k, bucket);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills over time', async () => {
    if (!reachable) return;
    const k = key('refill');
    // 20 tokens/second means one token back in 50ms.
    const bucket = { capacity: 1, refillPerSecond: 20 };

    expect((await limiter.consume(k, bucket)).allowed).toBe(true);
    expect((await limiter.consume(k, bucket)).allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 120));
    expect((await limiter.consume(k, bucket)).allowed).toBe(true);
  });

  it('keeps separate buckets separate', async () => {
    if (!reachable) return;
    const bucket = { capacity: 1, refillPerSecond: 0.0001 };
    const a = key('a');
    const b = key('b');

    expect((await limiter.consume(a, bucket)).allowed).toBe(true);
    expect((await limiter.consume(a, bucket)).allowed).toBe(false);
    // b is untouched — one user exhausting their allowance must not affect
    // anyone else's.
    expect((await limiter.consume(b, bucket)).allowed).toBe(true);
  });

  /**
   * The regression test for ADR-08's whole reason to exist.
   *
   * Twenty concurrent consumes against a bucket holding ten tokens. If the
   * read-modify-write were not atomic, several would interleave — each
   * reading the same remaining count and each writing back a decrement that
   * overwrites the others — and more than ten would be allowed. That is the
   * lost update, and it needs no threads and no shared memory: concurrent
   * requests in flight at once are enough.
   */
  it('never allows more than capacity under concurrency (the lost update)', async () => {
    if (!reachable) return;
    const k = key('race');
    const bucket = { capacity: 10, refillPerSecond: 0.0001 };

    const results = await Promise.all(Array.from({ length: 20 }, () => limiter.consume(k, bucket)));

    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(10);
  });

  it('reports remaining tokens and a retry-after only when denied', async () => {
    if (!reachable) return;
    const k = key('headers');
    const bucket = { capacity: 2, refillPerSecond: 0.0001 };

    const first = await limiter.consume(k, bucket);
    expect(first.limit).toBe(2);
    expect(first.retryAfterMs).toBe(0);

    await limiter.consume(k, bucket);
    const denied = await limiter.consume(k, bucket);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });
});
