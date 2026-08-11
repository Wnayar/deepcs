import type Redis from 'ioredis';

/**
 * Token-bucket rate limiting (the overview §5, ADR-08).
 *
 * Each client gets a bucket of N tokens; a request spends one; tokens refill at
 * a steady rate. Bursts are allowed, sustained flooding is not.
 *
 * **The bug this file exists to prevent.** Two Gateway instances, one user's
 * bucket, one token left:
 *
 *     instance A: read tokens = 1
 *     instance B: read tokens = 1     <- reads before A has written
 *     instance A: write tokens = 0    <- A lets its request through
 *     instance B: write tokens = 0    <- B lets its through too
 *
 * A's decrement is lost. Note what that does *not* require: no threads, no
 * shared memory — two ordinary processes on two different machines are enough.
 * Which is also why an in-process mutex is not a fix: it would guard one
 * instance's own memory, at an address the other instance cannot reach.
 *
 * Atomicity has to live where the single copy of the state lives, and that is
 * Redis, which runs one script start-to-finish before beginning the next.
 *
 * *Why a script and not INCR?* A fixed-window counter needs only INCR, which is
 * already atomic — that is how Kong's plugin does it. A token bucket reads two
 * values (tokens, last refill), computes a refill from elapsed time, and writes
 * both back. That is multi-step, so atomicity has to be wrapped around it.
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
 * §6: per-IP at the Gateway for unauthenticated traffic, per-user for
 * authenticated. The per-user allowance is larger because an IP can be a whole
 * university NAT, while a user is one person.
 *
 * §6 also asks for a tighter bucket on /match/* specifically. That one is not
 * built: phases 3 and 4 shipped without it, and those routes turned out cheap
 * enough that this allowance covers them. Noted here rather than silently
 * dropped, because the design doc still calls for it.
 */
export const BUCKETS = {
  ip: { capacity: 60, refillPerSecond: 1 },
  user: { capacity: 120, refillPerSecond: 2 },
} as const satisfies Record<string, Bucket>;

export interface RateLimiter {
  consume(key: string, bucket: Bucket, cost?: number): Promise<RateLimitResult>;
}

export function createRateLimiter(redis: Redis): RateLimiter {
  /**
   * `defineCommand` registers the script once and calls it by SHA thereafter,
   * falling back to a full EVAL automatically if Redis has forgotten it — which
   * happens after a restart, and on any replica that has not seen the script
   * before. Doing this by hand is the usual source of a rate limiter that works
   * until the first failover.
   */
  redis.defineCommand('tokenBucket', { numberOfKeys: 1, lua: SCRIPT });

  return {
    async consume(key, bucket, cost = 1): Promise<RateLimitResult> {
      const [allowed, remaining, retryAfterMs] = (await (
        redis as unknown as {
          tokenBucket(
            key: string,
            capacity: string,
            refill: string,
            cost: string,
          ): Promise<[number, number, number]>;
        }
      ).tokenBucket(
        key,
        String(bucket.capacity),
        String(bucket.refillPerSecond),
        String(cost),
      )) as [number, number, number];

      return {
        allowed: allowed === 1,
        remaining,
        retryAfterMs,
        limit: bucket.capacity,
      };
    },
  };
}
