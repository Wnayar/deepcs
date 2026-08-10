import type Redis from 'ioredis';

const SCRIPT = `
-- KEYS[1] = the sorted-set queue for one topic+difficulty pair
-- ARGV[1] = the calling user's uid

local uid = ARGV[1]

-- A retried join call while already queued does nothing — still waiting.
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
  local t = redis.call('TIME')
  local now = tonumber(t[1]) + tonumber(t[2]) / 1000000
  -- A string, not a number: Redis converts Lua numbers to integers on the way
  -- out and a sub-second wait would arrive as 0.
  return { partner, tostring(now - joined) }
end

-- Nobody waiting yet — add the caller to the queue. The score is Redis'
-- own clock, not the caller's, so join order stays correct even if two
-- Matching instances have clocks that disagree (same reasoning as the
-- Gateway's rate limiter — see rate-limit.ts).
local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000
redis.call('ZADD', KEYS[1], now, uid)
return false
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
   * If two people call this for the same topic+difficulty at the exact same
   * moment, only one of them can end up claiming the other — Redis runs the
   * whole check-and-claim as a single atomic script, so there's no gap where
   * both calls could see the same waiting partner and both try to claim
   * them. It's the same fix as the Gateway's rate limiter, for the same
   * shape of race.
   */
  join(uid: string, topic: string, difficulty: string): Promise<Claim | null>;

  /** True if `uid` is currently sitting in this topic+difficulty queue. */
  isWaiting(uid: string, topic: string, difficulty: string): Promise<boolean>;
}

export function createQueue(redis: Redis): Queue {
  redis.defineCommand('matchJoin', { numberOfKeys: 1, lua: SCRIPT });

  return {
    async join(uid, topic, difficulty) {
      const claimed = await (
        redis as unknown as {
          matchJoin(key: string, uid: string): Promise<[string, string] | null>;
        }
      ).matchJoin(queueKey(topic, difficulty), uid);

      if (!claimed) return null;
      return { partnerUid: claimed[0], waitedSeconds: Number(claimed[1]) };
    },

    async isWaiting(uid, topic, difficulty) {
      const score = await redis.zscore(queueKey(topic, difficulty), uid);
      return score !== null;
    },
  };
}
