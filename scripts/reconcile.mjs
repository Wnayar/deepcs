// Rebuilds the entitlements table from Stripe's ledger, the authoritative
// record of who paid. Emits idempotent SQL rather than writing directly:
//
//   STRIPE_SECRET_KEY=sk_... node scripts/reconcile.mjs > recover.sql
//   npx wrangler d1 execute deepcs --remote --file recover.sql

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('set STRIPE_SECRET_KEY (a restricted, read-only key is enough)');
  process.exit(1);
}

const sq = (s) => `'${String(s).replaceAll("'", "''")}'`;
let after = null;
let count = 0;

do {
  const url = new URL('https://api.stripe.com/v1/checkout/sessions');
  url.searchParams.set('limit', '100');
  url.searchParams.set('status', 'complete');
  if (after) url.searchParams.set('starting_after', after);

  const res = await fetch(url, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) {
    console.error(`stripe answered ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const page = await res.json();

  for (const s of page.data) {
    after = s.id;
    if (s.metadata?.product !== 'lifetime') continue;
    if (s.payment_status !== 'paid') continue;
    if (!s.client_reference_id || !s.payment_intent) continue;
    count += 1;
    console.log(
      'INSERT OR IGNORE INTO entitlements (uid, product, provider_order_id, provider_event_id, purchased_at) VALUES (' +
        [
          sq(s.client_reference_id),
          "'lifetime'",
          sq(s.payment_intent),
          // No webhook event id here; the session id is just as unique.
          sq(`reconciled:${s.id}`),
          sq(new Date(s.created * 1000).toISOString()),
        ].join(', ') +
        ');',
    );
  }
  if (!page.has_more) break;
} while (true);

console.error(`${count} entitlement(s) emitted; refunds are not walked — revoke by hand if any.`);
