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

/** Quotes one value for SQL, doubling any quote inside it. */
function sq(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** One page of completed checkout sessions, oldest cursor first. */
async function fetchPage(after) {
  const url = new URL('https://api.stripe.com/v1/checkout/sessions');
  url.searchParams.set('limit', '100');
  url.searchParams.set('status', 'complete');

  if (after !== null) {
    url.searchParams.set('starting_after', after);
  }

  const res = await fetch(url, { headers: { authorization: `Bearer ${key}` } });

  if (!res.ok) {
    console.error(`stripe answered ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  return await res.json();
}

/** True when this session is a paid lifetime purchase with a uid to grant. */
function isGrantable(session) {
  if (session.metadata?.product !== 'lifetime') {
    return false;
  }

  if (session.payment_status !== 'paid') {
    return false;
  }

  return Boolean(session.client_reference_id && session.payment_intent);
}

/** The INSERT that re-grants one session's entitlement. */
function insertFor(session) {
  const values = [
    sq(session.client_reference_id),
    "'lifetime'",
    sq(session.payment_intent),
    // No webhook event id here; the session id is just as unique.
    sq(`reconciled:${session.id}`),
    sq(new Date(session.created * 1000).toISOString()),
  ];

  return (
    'INSERT OR IGNORE INTO entitlements (uid, product, provider_order_id, provider_event_id, purchased_at) VALUES (' +
    values.join(', ') +
    ');'
  );
}

let after = null;
let count = 0;

for (;;) {
  const page = await fetchPage(after);

  for (const session of page.data) {
    after = session.id;

    if (!isGrantable(session)) {
      continue;
    }

    count += 1;
    console.log(insertFor(session));
  }

  if (!page.has_more) {
    break;
  }
}

console.error(`${count} entitlement(s) emitted; refunds are not walked — revoke by hand if any.`);
