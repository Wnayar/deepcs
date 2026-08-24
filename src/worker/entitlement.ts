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
 * Grant from a verified webhook. A row that is still live is left untouched,
 * which is the idempotency: a redelivered event changes nothing. A revoked
 * row is replaced, because a refund leaves the row in place and the next
 * purchase by that uid is a real one that has to unlock again. The event id
 * must differ for that, or redelivering the refunded purchase's own event
 * would undo the refund.
 */
export async function grant(
  env: Env,
  args: { uid: string; orderId: string; eventId: string; purchasedAt: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entitlements
       (uid, product, provider_order_id, provider_event_id, purchased_at)
     VALUES (?, 'lifetime', ?, ?, ?)
     ON CONFLICT (uid, product) DO UPDATE SET
       provider_order_id = excluded.provider_order_id,
       provider_event_id = excluded.provider_event_id,
       purchased_at      = excluded.purchased_at,
       revoked_at        = NULL
     WHERE entitlements.revoked_at IS NOT NULL
       AND entitlements.provider_event_id <> excluded.provider_event_id`,
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
