# TODO: before the public post

The site is live and taking real money at deepcs.org: real content, Google
and GitHub sign-in (no passwords), Stripe in live mode with the live $57
price, the live webhook and both secrets, the legal pages published, CI
deploying on every content push, and the edge protections on. Pricing stays
in USD; Adaptive Pricing was more trouble than it was worth.

Four things remain, none of them code.

1. **A qualified read of `/privacy` and `/terms`.** They describe this system
   rather than a template, and the load-bearing facts are right: Stripe is
   merchant of record, the email lives in Firebase Auth where the operator can
   see it, PDPA is the regime, the window is 14 days, no personal name or
   address is published. Nobody with a licence has read them.
2. **The terms and privacy URLs in Stripe's public details**, so the hosted
   checkout carries the policies and not only the sales page. A buyer who
   clicks through to pay has left this site, and right now nothing on Stripe's
   page links back to either document.
3. **Soft launch.** A few real people through sign-up and purchase, plus one
   real refund to prove the revoke path, before any public post. This is also
   where real provider sign-in and Stripe's hosted checkout get exercised: the
   e2e flows cannot reach either offline (ADR-011). Expect the first payout
   about seven days after the first sale, which is Stripe's hold on the seller
   and nothing the buyer sees.

Reconcile has been run against the live ledger; it is not repeated here
because it is a recovery tool, not a launch step. Optional whenever: upload a
logo to the Google consent screen, which triggers brand verification and wants
the privacy URL that now exists.

Delete this file once 3 is done. DESIGN.md describes the system; this only
describes the gap between built and launched.
