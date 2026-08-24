import { SignJWT, importJWK, type JWK } from 'jose';
// The attribute is required by the e2e runner, which loads this file as
// plain Node ESM rather than through a bundler.
import fixture from '../fixtures/test-jwks.json' with { type: 'json' };

/** Matches FIREBASE_PROJECT_ID in vitest.workers.config.ts and in
 * playwright.config.ts. */
export const PROJECT = 'test-project';
const ISSUER = `https://securetoken.google.com/${PROJECT}`;

/** A real RS256 Firebase-shaped token, signed with the committed throwaway
 * test key. Overrides exist so tests can craft exactly one wrong claim. */
export async function mintToken(
  sub: string,
  overrides: { aud?: string; iss?: string; expired?: boolean } = {},
): Promise<string> {
  const key = await importJWK(fixture.privateJwk as JWK, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(sub)
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? PROJECT)
    .setIssuedAt(overrides.expired ? now - 7200 : now)
    .setExpirationTime(overrides.expired ? now - 3600 : now + 3600)
    .sign(key);
}

export const WEBHOOK_SECRET = 'whsec_test_secret';

/** A Stripe-Signature header for this body: the same HMAC scheme Stripe
 * uses, under the test secret, so verification in the Worker runs for real. */
export async function stripeSignature(
  body: string,
  opts: { secret?: string; t?: number } = {},
): Promise<string> {
  const t = opts.t ?? Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(opts.secret ?? WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${t}.${body}`)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

/** A checkout.session.completed payload of the shape the Worker consumes. */
export function completedEvent(
  uid: string,
  opts: { eventId?: string; paymentIntent?: string; product?: string } = {},
): string {
  return JSON.stringify({
    id: opts.eventId ?? 'evt_test_0001',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        client_reference_id: uid,
        payment_intent: opts.paymentIntent ?? 'pi_test_0001',
        payment_status: 'paid',
        metadata: { product: opts.product ?? 'lifetime' },
      },
    },
  });
}

export function refundEvent(paymentIntent: string, eventId = 'evt_test_refund'): string {
  return JSON.stringify({
    id: eventId,
    type: 'charge.refunded',
    created: Math.floor(Date.now() / 1000),
    data: { object: { payment_intent: paymentIntent } },
  });
}
