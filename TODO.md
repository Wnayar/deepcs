# TODO: before real money

Everything else is live at deepcs.org: real content, Google and GitHub
sign-in (no passwords), a sandbox purchase verified end to end on the real
domain, CI deploying on every content push, adaptive pricing enabled, and
the edge protections on. What remains:

1. Privacy policy and terms pages: required for live payments, and the
   prerequisite for Google consent-screen branding (logo upload triggers
   Google's brand verification, which wants a privacy policy URL).
2. Playwright e2e flows (DESIGN.md §11): sign-in, read, tick, paywall,
   purchase, against the real stack.
3. Stripe live mode: activate the account (business and payout details,
   Managed Payments as merchant of record). Review takes time; start it
   before it blocks anything.
4. The live switch, in one sitting: create the live $57 price (tax
   inclusive) and live webhook at https://deepcs.org/api/webhooks/stripe
   (same two events), swap STRIPE_PRICE_ID in wrangler.toml,
   `wrangler secret put` the live secret key and signing secret, enable
   Adaptive Pricing in live settings, deploy.
5. Run `scripts/reconcile.mjs` against the live ledger; sandbox-era test
   unlocks vanish with it.
6. Soft launch: a few real people through sign-up and purchase, plus one
   real refund to prove the revoke path, before any public post.
