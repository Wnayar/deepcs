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

/** Decodes a hex string to bytes, or null if it is not valid hex. */
function hexToBytes(hex: string): Uint8Array | null {
  const hasOddLength = hex.length % 2 !== 0;
  const hasNonHexChar = /[^0-9a-f]/i.test(hex);

  if (hasOddLength || hasNonHexChar) {
    return null;
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    const pair = hex.slice(i * 2, i * 2 + 2);
    bytes[i] = parseInt(pair, 16);
  }

  return bytes;
}

/**
 * Splits `t=123,v1=abc,v1=def` into its keys and their values.
 *
 * A key can repeat: Stripe sends every signature still in its rotation
 * window, so v1 is a list and any one of them matching is enough.
 */
function parseSignatureHeader(header: string): Map<string, string[]> {
  const parts = new Map<string, string[]>();

  for (const piece of header.split(',')) {
    const [rawKey, rawValue] = piece.split('=', 2);

    if (!rawKey || !rawValue) {
      continue;
    }

    const key = rawKey.trim();
    const existing = parts.get(key);

    if (existing === undefined) {
      parts.set(key, [rawValue.trim()]);
    } else {
      existing.push(rawValue.trim());
    }
  }

  return parts;
}

/**
 * True when this header proves Stripe signed this exact body, recently.
 *
 * Everything the route later trusts has to come from `body`, because the
 * signature covers the body and nothing else.
 */
async function signatureIsValid(secret: string, header: string, body: string): Promise<boolean> {
  const parts = parseSignatureHeader(header);
  const timestamps = parts.get('t');
  const candidates = parts.get('v1');

  if (timestamps === undefined || candidates === undefined || candidates.length === 0) {
    return false;
  }

  const timestamp = Number(timestamps[0]);

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);

  if (ageSeconds > TOLERANCE_S) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  const expected = new Uint8Array(signed);

  for (const candidate of candidates) {
    const bytes = hexToBytes(candidate);

    if (bytes === null || bytes.length !== expected.length) {
      continue;
    }

    if (crypto.subtle.timingSafeEqual(bytes, expected)) {
      return true;
    }
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

/** Turns a signed Stripe event into a grant, a revoke, or a bare 200. */
export async function webhook(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new HttpError(503, 'payments are not configured');
  }

  const body = await request.text();
  const header = request.headers.get('stripe-signature');

  if (header === null) {
    throw new HttpError(400, 'bad signature');
  }

  const signed = await signatureIsValid(env.STRIPE_WEBHOOK_SECRET, header, body);

  if (!signed) {
    throw new HttpError(400, 'bad signature');
  }

  const event = JSON.parse(body) as StripeEvent;
  const object = event.data.object;

  if (event.type === 'checkout.session.completed') {
    const uid = object.client_reference_id;
    const orderId = object.payment_intent;
    const isPaid = object.payment_status === 'paid';

    // metadata.product is stamped at session creation (checkout.ts); a
    // signed event for anything else grants nothing.
    const metadata = object.metadata;
    const isLifetime = metadata !== undefined && metadata.product === 'lifetime';

    if (isPaid && isLifetime && typeof uid === 'string' && typeof orderId === 'string') {
      await grant(env, {
        uid,
        orderId,
        eventId: event.id,
        purchasedAt: new Date(event.created * 1000).toISOString(),
      });
    }
  } else if (event.type === 'charge.refunded') {
    // Stripe sends this for partial refunds too. Revoking on the event alone
    // is correct only because refunds here are always the whole price; a
    // partial one would lock out a buyer who still paid most of it.
    const orderId = object.payment_intent;

    if (typeof orderId === 'string') {
      await revoke(env, orderId);
    }
  }

  // Other event types are acknowledged: 200 is what stops Stripe retrying.
  return json({ received: true });
}
