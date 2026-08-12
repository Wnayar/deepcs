import type Redis from 'ioredis';

/**
 * Token-bucket rate limiting. Each client gets a bucket of N tokens, a request
 * spends one, and tokens refill at a steady rate: bursts allowed, sustained
 * flooding blocked.
 *
 * **The bug this file exists to prevent.** Two Gateway instances, one user's
 * bucket, one token left:
 *
 *     instance A: read tokens = 1
 *     instance B: read tokens = 1     <- reads before A has written
 *     instance A: write tokens = 0    <- A lets its request through
 *     instance B: write tokens = 0    <- B lets its through too
 *
 * A's decrement is lost, and note what that does *not* require: no threads, no
 * shared memory — two ordinary processes on two machines are enough. Which is
 * also why an in-process mutex is not a fix. Atomicity has to live where the
 * single copy of the state lives, and that is Redis, which runs one script
 * start to finish before beginning the next.
 *
 * Full reasoning, including why not Kong: docs/system/01-gateway.md §4.
 */

const SCRIPT = `
-- KEYS[1] bucket key
-- ARGV[1] capacity      (tokens)
-- ARGV[2] refill rate   (tokens per second)
-- ARGV[3] cost          (tokens for this request)

local capacity = tonumber(ARGV[1])
local refill   = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

-- Redis' own clock, not the caller's. Two Gateway instances have two clocks
-- that disagree by an unknown amount; taking the timestamp from the single
-- place the state lives removes skew from the refill maths entirely. TIME is
-- allowed here because Redis replicates script *effects*, not the script.
local t   = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000

local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts     = tonumber(bucket[2])

-- A bucket that has expired or never existed starts full, which is what makes
-- a first-time caller indistinguishable from an idle one.
if tokens == nil or ts == nil then
  tokens = capacity
  ts     = now
end

-- max(0, ...) guards against a clock that moved backwards; without it a
-- negative elapsed would silently *remove* tokens.
local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
if tokens >= cost then
  tokens  = tokens - cost
  allowed = 1
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)

-- Expire after the time a full refill takes, so idle buckets do not accumulate
-- in Redis forever. Redis holds every key in memory, and an unbounded key
-- space for per-IP buckets is how a small instance runs out of it.
redis.call('EXPIRE', KEYS[1], math.ceil(capacity / refill) + 1)

local retry_after_ms = 0
if allowed == 0 then
  retry_after_ms = math.ceil(((cost - tokens) / refill) * 1000)
end

-- Redis converts Lua numbers to integers on the way out, so every value
-- returned here is floored deliberately rather than by accident.
return { allowed, math.floor(tokens), retry_after_ms }
`;

export interface Bucket {
  /** Maximum tokens, and therefore the largest burst allowed. */
  capacity: number;
  /** Tokens added per second. Sustained throughput settles here. */
  refillPerSecond: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the next token is available. 0 when allowed. */
  retryAfterMs: number;
  limit: number;
}

/**
 * Per-IP for unauthenticated traffic, per-user for authenticated. The per-user
 * allowance is larger because an IP can be a whole university NAT, while a user
 * is one person.
 *
 * Both numbers matter outside this file: `make k8s-check` runs forty identities
 * rather than one, because a single prober flat out would measure the rate
 * limiter instead of the rolling update.
 */
export const BUCKETS = {
  ip: { capacity: 60, refillPerSecond: 1 },
  user: { capacity: 120, refillPerSecond: 2 },
} as const satisfies Record<string, Bucket>;

export interface RateLimiter {
  consume(key: string, bucket: Bucket, cost?: number): Promise<RateLimitResult>;
}

/** `defineCommand` adds a method ioredis cannot know the shape of, so the cast
 * happens once, here, rather than at the call site. */
interface WithTokenBucket {
  tokenBucket(
    key: string,
    capacity: string,
    refill: string,
    cost: string,
  ): Promise<[allowed: number, remaining: number, retryAfterMs: number]>;
}

export function createRateLimiter(redis: Redis): RateLimiter {
  /**
   * Registers the script once and calls it by SHA thereafter, falling back to a
   * full EVAL if Redis has forgotten it — which happens after a restart, and on
   * any replica that has not seen it. Doing this by hand is the usual source of
   * a rate limiter that works until the first failover.
   */
  redis.defineCommand('tokenBucket', { numberOfKeys: 1, lua: SCRIPT });
  const script = redis as unknown as WithTokenBucket;

  return {
    async consume(key, bucket, cost = 1): Promise<RateLimitResult> {
      const [allowed, remaining, retryAfterMs] = await script.tokenBucket(
        key,
        String(bucket.capacity),
        String(bucket.refillPerSecond),
        String(cost),
      );

      return { allowed: allowed === 1, remaining, retryAfterMs, limit: bucket.capacity };
    },
  };
}
