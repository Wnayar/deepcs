# TODO: before the public post

The site is live and taking real money at deepcs.org: real content, Google
and GitHub sign-in (no passwords), Stripe in live mode with the live $57
price, the live webhook and both secrets, the legal pages published and
linked from Stripe's own checkout, CI deploying on every content push, and
the edge protections on. Pricing stays in USD; Adaptive Pricing was more
trouble than it was worth. Reconcile has been run against the live ledger.

One thing remains, and it is not code.

1. **Soft launch.** A few real people through sign-up and purchase, plus one
   real refund to prove the revoke path, before any public post. This is also
   where real provider sign-in and Stripe's hosted checkout get exercised: the
   e2e flows cannot reach either offline (ADR-011). Expect the first payout
   about seven days after the first sale, which is Stripe's hold on the seller
   and nothing the buyer sees.

Neither of these blocks it, whenever there is time:

- **A licensed read of `/privacy` and `/terms`.** Both were checked against
  PDPC's published list of the eleven obligations and the gaps closed:
  overseas transfer, protection, consent and its withdrawal, and the
  thirty-day answer on access requests. The load-bearing facts hold too:
  Stripe is merchant of record, the email lives in Firebase Auth where the
  operator can see it, the window is 14 days, no personal name or address is
  published. What is missing is a licensed pair of eyes, not a known defect.
  NUS Enterprise or the law faculty's pro bono office are the free routes; a
  fixed-fee review from an SME firm is the paid one, worth it once sales
  justify it.
- **A logo on the Google consent screen**, which triggers brand verification
  and wants the privacy URL that now exists.

Delete this file once 1 is done. DESIGN.md describes the system; this only
describes the gap between built and launched.
