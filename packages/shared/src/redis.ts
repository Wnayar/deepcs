import Redis, { type RedisOptions } from 'ioredis';

/**
 * Redis does five jobs in this system (§4): rate-limit state, match queue,
 * cross-instance pub/sub, event stream, question cache. Phase 1 uses the first.
 *
 * ioredis rather than node-redis: `defineCommand` registers a Lua script once
 * and then calls it by SHA with an automatic fallback to EVAL if Redis has
 * forgotten it (after a restart, or on a different Upstash node). The rate
 * limiter's atomicity depends on that script, so the client's script handling
 * is not an incidental detail.
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
     * request holds a Cloud Run concurrency slot, so the outage spreads.
     */
    maxRetriesPerRequest: 2,

    /**
     * Don't buffer commands issued before the socket is ready; surface the
     * error instead. Same reasoning: visible failure over silent latency.
     */
    enableOfflineQueue: false,

    /**
     * Upstash requires TLS and the URL says so with the `rediss://` scheme,
     * which ioredis reads on its own. Local compose uses plain `redis://`.
     * Nothing to configure here — noted because the missing extra `s` is the
     * usual cause of a connection that works locally and refuses in production.
     */

    /**
     * Overrides, and there is only one thing anybody overrides: the offline
     * queue, back on. The default suits a client whose first command arrives
     * with a user's request, long after the socket connected. It is wrong for
     * two other shapes, both of which exist here:
     *
     *   - a long-lived subscriber, which subscribes at startup (Collab's rooms,
     *     Matching's event stream),
     *   - a job, whose first command races its own connect because there is no
     *     request to wait for.
     *
     * In both, failing fast means failing at startup for a socket that is
     * about to be ready, which is not a useful kind of fast.
     */
    ...overrides,
  });
}

export async function pingRedis(redis: Redis): Promise<void> {
  await redis.ping();
}
