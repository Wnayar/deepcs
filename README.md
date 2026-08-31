# deepcs

**A computer-science revision site with a paid tier. Live at
[deepcs.org](https://deepcs.org), taking real payments.**

Ten topics arranged by what makes what easier to read. Each opens into steps:
a lesson, then the interview questions it prepares you for, with self-serve
reference answers. Two topics are free; one payment unlocks the rest, for
good.

One person: the architecture, the payments integration, the writing, and the
deploy.

---

## How it is built

One Cloudflare Worker is the entire deployment. The platform serves the React
SPA and free content straight from the edge cache without invoking it; the
Worker runs only for `/api/*` and paid content.

| | |
|---|---|
| **Backend** | one Worker, 697 lines, six routes |
| **Database** | D1 (SQLite), two tables, no user table |
| **Identity** | Firebase Auth, verified in-Worker with `jose` |
| **Payments** | Stripe Managed Payments, merchant of record |
| **Frontend** | React + Vite, no server rendering |
| **Cost** | $0 idle, $0 busy; fees only as a share of revenue |

Reading is a file fetch from the edge. Writing is a token plus one upsert.
Buying is a redirect plus one signed webhook. That is the whole system.

## Three decisions worth the click

**[Security is by shape](./DESIGN.md#9-security), not by checking.** No route
accepts a user id. The surface is `/api/me/*` and identity comes only from the
verified token's `sub`, so the entire IDOR class is not defended against, it is
unrepresentable. The paid gate is server-side only: locked bytes never reach an
unentitled browser, and the lock in the UI is presentation.

**[Stripe is the seller, not me](./docs/adr/006-monetization-stripe-lifetime.md).**
Managed Payments makes Stripe merchant of record, so VAT in every buyer's
jurisdiction, chargebacks, and disputes are theirs. An individual with no
registered company cannot own global tax compliance; the fee is the price of
never having to.

**[Idle months cost nothing](./DESIGN.md#12-cost).** No meter here runs on
wall-clock: compute is per-request, the database per-row, payments per-sale.
Every ceiling fails by refusing service rather than by charging, so there is no
path to a surprise bill. That is what makes a lifetime unlock safe to promise.

## The reasoning is written down

[DESIGN.md](./DESIGN.md) states what the system is. [`docs/adr/`](./docs/adr/)
records why: eleven records, each naming the options it rejected and the
tradeoff it accepted. A decision that weighed alternatives belongs in an ADR,
not in a comment.

## Why there are no lessons in this repo

The content is the product, so it lives in a private repo and meets this code
only at deploy time. What ships here is a small set of clearly labelled sample
fixtures, including one *paid* fixture topic, so the paywall stays runnable and
testable from the public repo alone.

## Tests

Sixty-six across three layers, every one of them offline and credential-free
in CI. Verification is never stubbed: the tests mint real RS256 tokens against
a committed throwaway key pair and really sign webhook payloads, so the Worker
verifies both exactly as it does in production. The middle layer runs the real
Worker inside `workerd` against a real local D1, which is where the trust
boundary, the paywall, webhook forgery and replay, and refund revocation are
each pinned to a named failure.

## Running it

```bash
pnpm install && pnpm build
npx wrangler d1 migrations apply deepcs --local
npx wrangler dev     # whole stack on :8787, on the sample fixtures
```

Then `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`. No accounts, no
secrets, no network beyond the install.
