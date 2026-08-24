# TODO: before launch

Everything else is live at deepcs.org: real content, Google and GitHub
sign-in (no passwords), CI deploying on every content push, the edge
protections on, and Stripe in live mode, with the live $57 price, the live
webhook and both secrets set. Pricing stays in USD: Adaptive Pricing was
more trouble than it was worth. What remains:

1. Legal pages: `/privacy` and `/terms` are written, linked from the footer
   of every reading screen and from the sales page. Contact
   `support@deepcs.org`, governing law Singapore, PDPA the privacy regime,
   refund window 14 days, no personal name or address published. No
   placeholders remain. Both documents still want a read by someone
   qualified before live payments. The privacy URL is also the prerequisite
   for Google consent-screen branding, whose logo upload triggers brand
   verification.
2. Set the terms and privacy URLs in Stripe's public details, so the hosted
   checkout carries them and not only the sales page.
3. Run `scripts/reconcile.mjs` against the live ledger; sandbox-era test
   unlocks vanish with it.
4. Soft launch: a few real people through sign-up and purchase, plus one
   real refund to prove the revoke path, before any public post. This is
   also where real provider sign-in and Stripe's hosted checkout get
   exercised; the e2e flows cannot reach either offline (ADR-011).
