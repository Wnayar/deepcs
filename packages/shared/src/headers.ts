import type { FastifyRequest } from 'fastify';

/**
 * The header that carries identity between the six services. Named here rather
 * than written as a string literal at each use site, because a typo in one
 * service produces a request that authenticates fine and arrives anonymous — a
 * failure with no error attached to it.
 */
export const USER_ID_HEADER = 'x-user-id';

/**
 * Read the caller's identity in a downstream service.
 *
 * **Absent means anonymous, never "trust whatever arrived."** The question bank
 * and /stats are public, so the header is legitimately missing on some
 * requests, and a service that reads missing as "skip the check" is as broken
 * as one that trusts a forged value.
 *
 * The header is trustworthy only because the Gateway strips any inbound copy
 * before setting its own, *and* because nothing else is reachable from outside.
 * Either half alone leaves it forgeable. See docs/system/01-gateway.md §3.
 */
export function getUserId(req: FastifyRequest): string | null {
  const raw = req.headers[USER_ID_HEADER];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw;
}
