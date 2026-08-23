# TODO: before real money

The launch runbook is done: the site is live at deepcs.org with real
content, a sandbox purchase verified end to end, CI deploying on every
content push, and Bot Fight Mode plus the /api/ rate limit at the edge.
What remains is the switch from fake money to real:

1. Stripe live mode: activate the account (business and payout details,
   Managed Payments as merchant of record), then create the live $57
   price (tax inclusive) and a live webhook at
   https://deepcs.org/api/webhooks/stripe with the same two events.
2. Point the Worker at live: swap STRIPE_PRICE_ID in wrangler.toml, then
   `wrangler secret put` the live secret key and signing secret.
3. Run `scripts/reconcile.mjs` against the live ledger; sandbox-era test
   unlocks vanish with it.
4. The Playwright e2e flows (DESIGN.md §11).
5. Soft launch: a few real people through sign-up, purchase, and a
   refund before any public post.
