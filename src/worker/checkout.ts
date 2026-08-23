import { HttpError, json } from './http';
import { requireUid } from './auth';
import { isEntitled } from './entitlement';
import type { Env } from './env';

/**
 * POST /api/checkout — create a Stripe Checkout Session bound to the
 * verified caller and hand back its hosted URL (DESIGN.md §9.1).
 *
 * `client_reference_id` is the uid the webhook will entitle, set here from
 * the verified token — the one place a uid crosses to a third party, and
 * worth nothing to forge, because forging it means paying for someone
 * else's upgrade. `metadata.product` is what the webhook checks so a signed
 * event for some other thing this account might ever sell cannot mint a
 * lifetime unlock.
 */
export async function checkout(request: Request, env: Env): Promise<Response> {
  const uid = await requireUid(request, env);

  // Unconfigured is a state the public repo runs in (fixtures, no Stripe):
  // fail plainly rather than pretending a checkout could start.
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID)
    throw new HttpError(503, 'payments are not configured');

  if (await isEntitled(env, uid)) throw new HttpError(409, 'already unlocked');

  const origin = new URL(request.url).origin;
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price]': env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    client_reference_id: uid,
    'metadata[product]': 'lifetime',
    success_url: `${origin}/upgrade/thanks`,
    cancel_url: `${origin}/upgrade`,
  });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) throw new HttpError(502, 'checkout could not be created');

  const session = (await res.json()) as { url?: string };
  if (!session.url) throw new HttpError(502, 'checkout came back with no URL');
  return json({ url: session.url });
}
