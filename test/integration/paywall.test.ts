import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { completedEvent, mintToken, refundEvent, stripeSignature } from './helpers';

/** The paywall end to end: the webhook that mints an entitlement, the gate
 * that enforces it, and the refund that takes it back. */

const base = 'https://deepcs.test';
const PAID_FILE = '/content/paid/lessons/sample-premium-1.md';

async function deliver(body: string, signature?: string) {
  return SELF.fetch(`${base}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'stripe-signature': signature ?? (await stripeSignature(body)) },
    body,
  });
}

async function gated(token?: string) {
  return SELF.fetch(
    `${base}${PAID_FILE}`,
    token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
  );
}

describe('the gate', () => {
  it('answers 401 to an anonymous request, with no content bytes', async () => {
    const res = await gated();
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('locked lesson');
  });

  it('answers 402 to a signed-in reader who has not paid, with no content bytes', async () => {
    const res = await gated(await mintToken('user-a'));
    expect(res.status).toBe(402);
    expect(await res.text()).not.toContain('locked lesson');
  });
});

describe('the webhook', () => {
  it('a valid completed checkout entitles exactly the named uid', async () => {
    expect((await deliver(completedEvent('user-a'))).status).toBe(200);

    const entitled = await gated(await mintToken('user-a'));
    expect(entitled.status).toBe(200);
    expect(await entitled.text()).toContain('locked lesson');
    expect(entitled.headers.get('cache-control')).toContain('private');

    // Somebody else's payment is not yours.
    expect((await gated(await mintToken('user-b'))).status).toBe(402);
  });

  it('delivered twice, grants once', async () => {
    await deliver(completedEvent('user-a'));
    await deliver(completedEvent('user-a'));

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM entitlements').first<{
      n: number;
    }>();
    expect(count?.n).toBe(1);
  });

  it('rejects a tampered body', async () => {
    const body = completedEvent('user-a');
    const signature = await stripeSignature(body);
    const tampered = body.replace('user-a', 'user-b');
    expect((await deliver(tampered, signature)).status).toBe(400);
    expect((await gated(await mintToken('user-b'))).status).toBe(402);
  });

  it('rejects a signature under the wrong secret', async () => {
    const body = completedEvent('user-a');
    const forged = await stripeSignature(body, { secret: 'whsec_attacker' });
    expect((await deliver(body, forged)).status).toBe(400);
  });

  it('rejects a stale signature (replay outside the tolerance)', async () => {
    const body = completedEvent('user-a');
    const old = await stripeSignature(body, { t: Math.floor(Date.now() / 1000) - 3600 });
    expect((await deliver(body, old)).status).toBe(400);
  });

  it('a signed event for some other product grants nothing', async () => {
    const res = await deliver(completedEvent('user-a', { product: 'something-else' }));
    expect(res.status).toBe(200); // acknowledged, so Stripe stops retrying
    expect((await gated(await mintToken('user-a'))).status).toBe(402);
  });

  it('a refund revokes: the gate answers 402 again', async () => {
    await deliver(completedEvent('user-a', { paymentIntent: 'pi_refund_me' }));
    expect((await gated(await mintToken('user-a'))).status).toBe(200);

    await deliver(refundEvent('pi_refund_me'));
    expect((await gated(await mintToken('user-a'))).status).toBe(402);

    const flag = await SELF.fetch(`${base}/api/me/entitlement`, {
      headers: { authorization: `Bearer ${await mintToken('user-a')}` },
    });
    expect(((await flag.json()) as { entitled: boolean }).entitled).toBe(false);
  });
});

describe('checkout', () => {
  it('requires a signed-in caller: the purchase binds to an account', async () => {
    const res = await SELF.fetch(`${base}/api/checkout`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('says plainly when payments are not configured', async () => {
    // The test env sets no STRIPE_SECRET_KEY on purpose.
    const res = await SELF.fetch(`${base}/api/checkout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await mintToken('user-a')}` },
    });
    expect(res.status).toBe(503);
  });
});
