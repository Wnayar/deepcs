import type Redis from 'ioredis';

export interface CacheResult<T> {
  value: T;
  /** Surfaced as `X-Cache` so a cache hit is demoable, not just faster. */
  hit: boolean;
}

/**
 * Read-through cache for the list/search endpoint (DESIGN.md §Questions): the
 * bank is read-heavy and almost never written, so caching it is a pure
 * optimisation — unlike the Gateway's rate-limit script, correctness never
 * depends on this. A cache miss or a Redis outage just means falling through
 * to Postgres, so failures here are swallowed rather than propagated.
 */
export async function cached<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<CacheResult<T>> {
  try {
    const hit = await redis.get(key);
    if (hit !== null) return { value: JSON.parse(hit) as T, hit: true };
  } catch {
    // Fall through to Postgres; a cache read failure must not fail the request.
  }

  const value = await compute();

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Best-effort — a write failure just means the next request misses too.
  }

  return { value, hit: false };
}
