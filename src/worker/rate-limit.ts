import { HttpError } from './http';
import type { RateLimit } from './env';

/**
 * Spends one unit of a caller's quota, or rejects them with a 429.
 *
 * Per-uid limit, keyed by uid so one account cannot exhaust the shared daily
 * quota or spam Stripe however many IPs its bot uses. An absent binding
 * (local dev, tests) is a no-op: the limit is an edge feature, not app logic
 * worth faking.
 */
export async function limitByUid(limiter: RateLimit | undefined, uid: string): Promise<void> {
  if (limiter === undefined) {
    return;
  }

  const result = await limiter.limit({ key: uid });

  if (!result.success) {
    throw new HttpError(429, 'too many requests, slow down');
  }
}
