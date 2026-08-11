import type { FastifyRequest } from 'fastify';

/**
 * The two headers that carry identity and trace across the six services.
 * Named here rather than typed as string literals at each use site, because a
 * typo in one service produces a request that authenticates fine and arrives
 * anonymous — a failure with no error attached to it.
 */
export const USER_ID_HEADER = 'x-user-id';
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Read the caller's identity in a downstream service.
 *
 * **Absent means anonymous, never "trust whatever arrived."** the overview §6 flags
 * this as the header-forgery mistake reached from the other direction: the
 * question bank and /stats are public, so `X-User-Id` is legitimately missing on
 * some requests, and a downstream service that treats missing as "skip the
 * check" is exactly as broken as one that trusts a forged value.
 *
 * The header is trustworthy *only* because the Gateway strips any inbound copy
 * before setting its own, and because only the Gateway is reachable from
 * outside: under compose nothing else is published to a browser, and on the
 * cluster only the Gateway has an Ingress. Both halves are required — either
 * one alone leaves the header forgeable.
 */
export function getUserId(req: FastifyRequest): string | null {
  const raw = req.headers[USER_ID_HEADER];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw;
}

/**
 * Same, but for routes where anonymous is not a valid state. Returns null and
 * leaves the caller to reply 401 — it does not throw, because "who should
 * answer an unauthenticated request" is a routing decision, not a library one.
 */
export function requireUserId(req: FastifyRequest): string | null {
  return getUserId(req);
}
