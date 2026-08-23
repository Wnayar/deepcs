# ADR-006: Monetization — Stripe Managed Payments, lifetime unlock

**Status:** Accepted, 2026-08-23. Individual onboarding completed, sandbox
active.

## Context

Two choices, decided together: who is legally the seller, and what is sold.
The seller is an individual with no registered company. Whoever is the
merchant owes sales-tax/VAT collection and filing in every buyer's
jurisdiction (for digital goods the EU charges VAT from the first euro, no
threshold), plus chargebacks and disputes.

## Decision

**Stripe Managed Payments** as merchant of record, selling a **one-time
lifetime unlock**.

## Alternatives — who is the seller

| Option | Fee/sale | Who owes tax & chargebacks | Verdict |
|---|---|---|---|
| **Stripe Managed Payments (MoR)** | processing + 3.5% (≈ $7 on $99) | Stripe: liable for global tax/VAT, automates fraud/disputes | ✅ chosen — buys away the tax problem an individual cannot own, on the best API |
| Lemon Squeezy | ~5% + 50¢ | they do (also MoR) | ❌ Stripe-owned, in maintenance mode; its own onboarding recommends Managed Payments |
| Stripe Checkout, classic | 2.9% + 30¢ | **you do**, personally | ❌ only sensible after a company exists; kept as the fallback (the flow is provider-generic) |
| Paddle | 5% + 50¢ | they do (also MoR) | ❌ site-review onboarding, slow before launch |
| Gumroad | ~10% | they do (also MoR) | ❌ double the fee, weaker API |

## Alternatives — what is sold

| Option | Machinery | Verdict |
|---|---|---|
| **One-time lifetime unlock** | one immutable row; two events matter (paid, refunded) | ✅ chosen |
| Annual subscription | a state machine: expiry, renewal, grace, cancellation — ~80% of the payments code — and a renewal implies a content treadmill | ❌ deferred, not rejected: a later second product plus an `expires_at` column |
| Both | both, on day one | ❌ builds the subscription machine for the smaller half of demand |

Lifetime is uniquely safe here: marginal cost per user is ~$0 (static serves
plus a few Worker requests inside the free tier), and interview prep is a
burst, not a habit, so a subscriber would churn after one cycle anyway.

## Consequences

The 3.5% MoR fee is the price of never touching tax. "Lifetime" obligates
access while the product exists (standard ToS) and the refund window (Stripe's
to process), not new content forever. Pricing corridor from a friends survey
(**N = 6**, lowest-option anchoring, so a ceiling not a demand curve):
$149–199 lifetime; launch inside **$99–149**, a Stripe dashboard value
revisited on real sales. Progress stays free for everyone — it is the
conversion funnel, and the product sells content, not the checkbox.
