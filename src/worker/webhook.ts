import { HttpError, json } from './http';
import { grant, revoke } from './entitlement';
import type { Env } from './env';

/**
 * POST /api/webhooks/stripe: the source of every entitlement, and the one
 * route not authenticated by Firebase. Its credential is the
 * Stripe-Signature header: HMAC-SHA256 over `${timestamp}.${rawBody}`,
 * timestamp-bounded, compared constant-time.
 */

/** Signatures older than this are replays (Stripe's default tolerance). */
const TOLERANCE_S = 300;

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function signatureIsValid(secret: string, header: string, body: string): Promise<boolean> {
  const parts = new Map<string, string[]>();
  for (const piece of header.split(',')) {
    const [k, v] = piece.split('=', 2);
    if (!k || !v) continue;
    parts.set(k.trim(), [...(parts.get(k.trim()) ?? []), v.trim()]);
  }
  const t = Number(parts.get('t')?.[0]);
  const candidates = parts.get('v1') ?? [];
  if (!Number.isFinite(t) || candidates.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_S) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${t}.${body}`)),
  );

  for (const candidate of candidates) {
    const bytes = hexToBytes(candidate);
    if (bytes && bytes.length === expected.length && crypto.subtle.timingSafeEqual(bytes, expected))
      return true;
  }
  return false;
}

interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: {
    object: {
      client_reference_id?: string | null;
      payment_intent?: string | null;
      payment_status?: string;
      metadata?: Record<string, string>;
    };
  };
}

export async function webhook(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'payments are not configured');

  const body = await request.text();
  const header = request.headers.get('stripe-signature') ?? '';
  if (!(await signatureIsValid(env.STRIPE_WEBHOOK_SECRET, header, body)))
    throw new HttpError(400, 'bad signature');

  const event = JSON.parse(body) as StripeEvent;
  const obj = event.data.object;

  if (event.type === 'checkout.session.completed') {
    // metadata.product is stamped at session creation (checkout.ts); a
    // signed event for anything else grants nothing.
    if (
      obj.payment_status === 'paid' &&
      obj.metadata?.product === 'lifetime' &&
      typeof obj.client_reference_id === 'string' &&
      typeof obj.payment_intent === 'string'
    ) {
      await grant(env, {
        uid: obj.client_reference_id,
        orderId: obj.payment_intent,
        eventId: event.id,
        purchasedAt: new Date(event.created * 1000).toISOString(),
      });
    }
  } else if (event.type === 'charge.refunded') {
    // Stripe sends this for partial refunds too. Revoking on the event alone
    // is correct only because refunds here are always the whole price; a
    // partial one would lock out a buyer who still paid most of it.
    if (typeof obj.payment_intent === 'string') await revoke(env, obj.payment_intent);
  }
  // Other event types are acknowledged: 200 is what stops Stripe retrying.

  return json({ received: true });
}
