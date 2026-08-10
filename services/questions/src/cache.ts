import type Redis from 'ioredis';

export interface CacheResult<T> {
  value: T;
  /** True if `value` came from Redis instead of `compute()`. */
  hit: boolean;
}

/**
 * A read-through cache: check Redis first, and on a miss (or any Redis
 * error) fall back to `compute()` and best-effort save the result for next
 * time.
 *
 * The bank rarely changes, so caching it is just a speed optimization, not
 * something correctness depends on — unlike the Gateway's rate-limit script,
 * a broken Redis here should make requests slower, never wrong or failed.
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
