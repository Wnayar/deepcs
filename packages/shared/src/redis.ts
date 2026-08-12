import Redis, { type RedisOptions } from 'ioredis';

/**
 * Redis does five jobs here: rate-limit state, the match queue, cross-instance
 * pub/sub, the event stream, and the question cache. See docs/system/08-data.md §6.
 *
 * ioredis rather than node-redis for one reason: `defineCommand` registers a
 * Lua script once and calls it by SHA thereafter, falling back to EVAL if Redis
 * has forgotten it (after a restart, or on a replica that has never seen it).
 * The rate limiter's atomicity depends on that script, so the client's script
 * handling is not an incidental detail.
 *
 * TLS is requested by the URL scheme, `rediss://` rather than `redis://`, which
 * ioredis reads on its own. Compose and the cluster both use plain `redis://`.
 */
export function createRedis(url = process.env.REDIS_URL, overrides: RedisOptions = {}): Redis {
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }

  return new Redis(url, {
    /**
     * Fail a command rather than queue it forever when the connection is down.
     * The default (`null`) retries indefinitely, which turns a Redis outage
     * into requests that hang instead of requests that 503 — and a hanging
     * request holds a concurrency slot, so the outage spreads.
     */
    maxRetriesPerRequest: 2,

    /**
     * Don't buffer commands issued before the socket is ready; surface the
     * error instead. Same reasoning: visible failure over silent latency.
     */
    enableOfflineQueue: false,

    /**
     * The only thing anybody overrides is the offline queue, back on. The
     * default above suits a client whose first command arrives with a user's
     * request, long after the socket connected. It is wrong for a long-lived
     * subscriber (Collab's rooms, Matching's event stream) and for a job whose
     * first command races its own connect. In both, failing fast means failing
     * at startup for a socket that is about to be ready.
     */
    ...overrides,
  });
}

export async function pingRedis(redis: Redis): Promise<void> {
  await redis.ping();
}
