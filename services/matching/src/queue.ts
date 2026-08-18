import type Redis from 'ioredis';

/**
 * How long a queue entry stays claimable. A browser that closes its tab has no
 * way to say so, and there is no leave endpoint, so an entry left behind is
 * claimed by whoever joins next and pairs them with somebody who is not there.
 * Expiring entries is what stops that, and it is why the score is the join
 * time rather than a counter.
 *
 * It matches the frontend's own give-up window (frontend/src/queue.ts), so a
 * person stops asking at roughly the moment they stop being claimable.
 */
export const WAIT_TTL_SECONDS = 60;

/**
 * Prepended to both scripts below. Reads Redis' clock into `now` and drops
 * everyone who joined more than the ttl ago, so neither operation can see a
 * stale entry. Redis' own clock, not the caller's, so join order stays correct
 * even if two Matching instances have clocks that disagree (same reasoning as
 * the Gateway's rate limiter — see rate-limit.ts).
 */
const PRUNE = `
local ttl = tonumber(ARGV[2])
local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000
-- Formatted rather than passed as a Lua number, because the score is
-- fractional and the default conversion would round it to the second.
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', string.format('%.6f', now - ttl))
`;

const JOIN_SCRIPT =
  PRUNE +
  `
-- KEYS[1] = the sorted-set queue for one topic+difficulty pair
-- ARGV[1] = the calling user's uid
-- ARGV[2] = seconds an entry stays claimable

local uid = ARGV[1]

-- A retried join call while already queued does nothing — still waiting. After
-- the prune, so somebody whose entry just expired rejoins with a fresh score
-- rather than being told they are still in a queue they have fallen out of.
if redis.call('ZSCORE', KEYS[1], uid) then
  return false
end

-- Someone else is already waiting: claim the oldest one as a partner.
-- WITHSCORES because the score is when they joined, and that number is gone
-- the instant the claim removes them. It is the only place the wait can be
-- measured, so it leaves with the answer.
local waiting = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if #waiting > 0 then
  local partner = waiting[1]
  local joined = tonumber(waiting[2])
  redis.call('ZREM', KEYS[1], partner)
  -- A string, not a number: Redis converts Lua numbers to integers on the way
  -- out and a sub-second wait would arrive as 0.
  return { partner, tostring(now - joined) }
end

-- Nobody waiting yet — add the caller to the queue.
redis.call('ZADD', KEYS[1], now, uid)
return false
`;

const WAITING_SCRIPT =
  PRUNE +
  `
-- Same prune as the join path, so a caller who has aged out is told they are
-- not waiting rather than being left to ask forever.
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  return 1
end
return 0
`;

function queueKey(topic: string, difficulty: string): string {
  return `match:queue:${topic}:${difficulty}`;
}

export interface Claim {
  partnerUid: string;
  /** How long the partner waited before this call claimed them. */
  waitedSeconds: number;
}

export interface Queue {
  /**
   * Tries to pair `uid` with whoever has been waiting longest for the same
   * topic and difficulty. For example, `join('alice', 'os', 'hard')` returns
   * the claimed partner and how long they waited, or `null` if nobody was
   * waiting — in which case `alice` is now in the queue herself.
   *
   * Anyone who joined more than the ttl ago is dropped first, so a claim is
   * never handed a partner who has stopped asking.
   *
   * If two people call this for the same topic+difficulty at the exact same
   * moment, only one of them can end up claiming the other — Redis runs the
   * whole check-and-claim as a single atomic script, so there's no gap where
   * both calls could see the same waiting partner and both try to claim
   * them. It's the same fix as the Gateway's rate limiter, for the same
   * shape of race.
   */
  join(uid: string, topic: string, difficulty: string): Promise<Claim | null>;

  /** True if `uid` is currently sitting in this topic+difficulty queue and has
   * not aged out of it. */
  isWaiting(uid: string, topic: string, difficulty: string): Promise<boolean>;
}

/** `ttlSeconds` is a parameter so a test can age an entry out without waiting a
 * real minute; nothing in the services passes it. */
export function createQueue(redis: Redis, ttlSeconds: number = WAIT_TTL_SECONDS): Queue {
  redis.defineCommand('matchJoin', { numberOfKeys: 1, lua: JOIN_SCRIPT });
  redis.defineCommand('matchWaiting', { numberOfKeys: 1, lua: WAITING_SCRIPT });

  const ttl = String(ttlSeconds);

  return {
    async join(uid, topic, difficulty) {
      const claimed = await (
        redis as unknown as {
          matchJoin(key: string, uid: string, ttl: string): Promise<[string, string] | null>;
        }
      ).matchJoin(queueKey(topic, difficulty), uid, ttl);

      if (!claimed) return null;
      return { partnerUid: claimed[0], waitedSeconds: Number(claimed[1]) };
    },

    async isWaiting(uid, topic, difficulty) {
      const waiting = await (
        redis as unknown as {
          matchWaiting(key: string, uid: string, ttl: string): Promise<number>;
        }
      ).matchWaiting(queueKey(topic, difficulty), uid, ttl);

      return waiting === 1;
    },
  };
}
