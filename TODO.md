# TODO: launch

1. `wrangler login` (interactive, browser auth).
2. `wrangler d1 create deepcs`, paste the id into wrangler.toml
   `database_id`, then `wrangler d1 migrations apply deepcs --remote`.
3. Set Firebase values: `VITE_FIREBASE_*` in the build env and the
   `FIREBASE_PROJECT_ID` var; add deepcs.org and deepcs.workers.dev to
   Firebase Authentication authorized domains.
4. `wrangler deploy`, then attach the deepcs.org custom domain in the
   Cloudflare dashboard.
5. Stripe sandbox: create the lifetime product and price, set the
   `STRIPE_PRICE_ID` var, `wrangler secret put STRIPE_SECRET_KEY` and
   `STRIPE_WEBHOOK_SECRET`, point a webhook at
   https://deepcs.org/api/webhooks/stripe (events: checkout.session.completed,
   charge.refunded).
6. Deploy workflow in deepcs-content: checkout both repos, content lint,
   `CONTENT_DIR` build, `wrangler deploy`; needs a Cloudflare API token in
   that repo's secrets.

Before real money: Stripe live-mode activation, the live price, and the
Playwright e2e flows (DESIGN.md §15.3).
