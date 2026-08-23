import { json } from './http';
import { requireUid } from './auth';
import type { Env } from './env';

/** Entitled: a lifetime row exists and has not been revoked. */
export async function isEntitled(env: Env, uid: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS one FROM entitlements WHERE uid = ? AND product = 'lifetime' AND revoked_at IS NULL",
  )
    .bind(uid)
    .first();
  return row !== null;
}

/** GET /api/me/entitlement: what /upgrade/thanks polls after checkout. */
export async function entitlement(request: Request, env: Env): Promise<Response> {
  const uid = await requireUid(request, env);
  return json({ entitled: await isEntitled(env, uid) });
}

/**
 * Grant from a verified webhook. INSERT OR IGNORE covers both idempotency
 * cases: a redelivered event hits the UNIQUE event id, a second purchase by
 * the same uid hits the primary key.
 */
export async function grant(
  env: Env,
  args: { uid: string; orderId: string; eventId: string; purchasedAt: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO entitlements
       (uid, product, provider_order_id, provider_event_id, purchased_at)
     VALUES (?, 'lifetime', ?, ?, ?)`,
  )
    .bind(args.uid, args.orderId, args.eventId, args.purchasedAt)
    .run();
}

/** Revoke by the payment intent a refund names. Idempotent. */
export async function revoke(env: Env, orderId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE entitlements SET revoked_at = datetime('now') WHERE provider_order_id = ? AND revoked_at IS NULL",
  )
    .bind(orderId)
    .run();
}
