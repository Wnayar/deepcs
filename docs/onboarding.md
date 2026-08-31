# Five hours to own DeepCS

Personal interview prep, not project documentation. DESIGN.md states what the
system is and `docs/adr/` records why; this file only says what to read, in
what order, to be able to defend the work out loud.

Written 2026-08-29; line numbers re-verified 2026-08-31 after the
explicit-style rewrite.

The five resume bullets this covers:

1. Deployed on Cloudflare Workers and D1, serving app and content from the
   edge at $0 idle cost.
2. Re-architected a 6-service microservices backend into a single edge Worker
   after user feedback showed no demand for live collaboration.
3. Secured the API with Firebase JWT verification, a server-side paywall gate,
   and per-user rate limiting, no route trusting a client-sent user id.
4. Payments on Stripe with signature-verified idempotent webhooks, Stripe's
   ledger as the source of truth.
5. Unit, integration and end-to-end tests running in CI on every push.

**Bullet 2 has no evidence in this repo.** See Block 2.

---

## Block 0 (0:00 to 0:15) The whole system in one breath

**Read:** `README.md`, then `DESIGN.md:1-52` (goals, non-goals, the workload
table).

Memorize this. It is the spine of every answer:

> **Reading is a file fetch from the edge. Writing is a token plus one upsert.
> Buying is a redirect plus one signed webhook.**

The shape: **one Worker, 6 routes, ~700 lines, 2 tables, no user table.**

Self-test: name the six routes without looking. (`src/worker/index.ts:29-66`:
paid content, `GET /api/me`, `GET /api/me/entitlement`,
`PUT /api/me/progress/:stepId`, `POST /api/checkout`,
`POST /api/webhooks/stripe`.)

---

## Block 1 (0:15 to 1:00) Bullet 1: edge, D1, $0 idle

**Read:** `wrangler.toml` (all of it, it is the entire deployment),
`DESIGN.md:53-150` (architecture plus both mermaid diagrams),
`DESIGN.md:500-522` (cost), `docs/adr/002-platform-cloudflare-workers.md`,
`docs/adr/004-database-d1.md`.

- `run_worker_first = ["/api/*", "/content/paid/*"]` is the most important
  line in the repo. Everything else is served from the edge and never invokes
  the Worker, so free reads cost zero compute and zero database.
- `not_found_handling = "single-page-application"` gives deep links a 200 with
  `index.html`, so `/step/abc` survives a refresh.
- $0 idle is literal: **no meter runs on wall-clock.** Compute is per-request,
  D1 per-row, Stripe per-sale. That is why a lifetime unlock is safe to sell.
- **Free plan, not pay-as-you-go.** No overage billing exists, so past the
  ceiling `/api/*` returns 429 and the static free site keeps serving. **It
  fails by refusing, never by charging.** The upgrade path if it ever hits is
  Workers Paid at $5/month, roughly 100x the headroom, no architecture change.
  The only guaranteed spend is the domain, about $10/year.
- Why not a VM or Cloud Run: Cloud Run with min-instances=0 pays a 0.5 to 2
  second container start on every visit, and **the cold path is the common
  path here**; min-instances=1 is about $92/mo to sit idle; a VM is $4 to
  $5/mo plus you own patching, TLS and backups.

**Weak spot to own:** the free plan caps CPU at **10ms per request**. "JWT
verify plus one D1 read is 1 to 3ms" is an estimate, not a measurement
(`DESIGN.md:525`). The tell is Cloudflare error 1102.

---

## Block 2 (1:00 to 1:40) Bullet 2: the re-architecture

**Read:** `docs/adr/001-one-deployable.md` (especially the alternatives table
and Consequences), `DESIGN.md:29-35` (non-goals), `DESIGN.md:37-51`
(workload).

The story in order:

1. v1 was six services with Docker, Redis, WebSockets and Postgres, built
   around live collaboration.
2. Users did not want live collaboration. That killed the only requirement
   with its own scaling profile and the only long-lived connection.
3. With no component scaling independently, **everything that existed only to
   coordinate replicas becomes dead weight**: the shared Redis rate-limit
   bucket, cross-instance pub/sub, the gateway as trust boundary. That
   sentence is the sharpest thing to say here.
4. What replaced them: shared Redis bucket became Cloudflare's rate-limit
   binding keyed by uid (`src/worker/rate-limit.ts`, 22 lines); the gateway
   trust boundary became one `requireUid` call (`src/worker/auth.ts:44`);
   Postgres became two D1 tables.

**The pushback is coming** ("you just deleted your work", "microservices
scale"). Answer from `DESIGN.md:37`: mostly anonymous reads, about 30 write
rows per user ever, a few purchases a month. Microservices buy independent
deployment and independent scaling; nothing here needs either. Not against
microservices, against paying their coordination cost for a workload with no
seams.

> **This bullet has no evidence in this repo.** History was rewritten and v1
> was made private (ADR-007), so the public repo starts fresh at v2. The only
> traces here are `docs/adr/001-one-deployable.md:21` and `DESIGN.md:29`. Open
> the private archive and skim its `docker-compose.yml` and service list
> before any interview.

---

## Block 3 (1:40 to 2:40) Bullet 3: security by shape

The densest hour, and the bullet most likely to get drilled.

**Read in order:** `DESIGN.md:415-449` (section 9), then `src/worker/auth.ts`
(all 77 lines), then `src/worker/content.ts` (all 38), then
`src/worker/manifest.ts` and `src/worker/progress.ts:37-70`, then
`src/worker/rate-limit.ts` with `docs/adr/008-rate-limiting.md`, then
`docs/adr/005-identity-firebase.md`.

**a) No route accepts a uid.** The surface is `/api/me/*`; identity comes only
from the verified token's `sub` (`src/worker/auth.ts:70`). Say it precisely:
**the IDOR class is not defended against, it is unrepresentable**, because
there is no parameter to tamper with. The one deliberate exception,
`client_reference_id`, is set server-side at `src/worker/checkout.ts:38`, and
forging it means paying for a stranger's upgrade.

**b) The audience check is load-bearing.** `src/worker/auth.ts:59-63`. Google
signs every Firebase project's tokens with the **same key set**, so a token
from a stranger's project passes signature, expiry and issuer shape. Only
`audience: projectId` rejects it. Volunteer this unprompted; most people who
"verify JWTs" miss it. Pinned by `test/integration/api.test.ts:31-41`.

**c) The paid gate is server-side only.** `src/worker/content.ts:20-24`:
verify the token, read one entitlement row, then 401 or 402 **before any bytes
move**. The UI lock is presentation. Those paths are reachable only through
the Worker because of `run_worker_first`, which is why a paid file on any
other path would be publicly served. Entitled bytes go out
`Cache-Control: private` so they never land in a shared cache.

**d) Rate limiting is per-uid, not per-IP.** `src/worker/rate-limit.ts:17`
keys on the verified uid because **IP does not identify a person**, and one
account across many IPs would evade a per-IP limit. Checkout is 5/min (the
only route with an external abuse cost, each call reaches Stripe); writes are
60/min (worst case past it is quota, which fails safe). A second per-IP layer
runs at the edge before the Worker is invoked, so a blocked request is never a
billable invocation. An absent binding is a no-op, which is why dev and tests
run unthrottled.

**Also:** `stepId` is validated against the shipped manifest
(`src/worker/manifest.ts`) **before any SQL**, which stops one user writing
unbounded rows. Bodies are zod-validated to exactly two booleans
(`src/worker/progress.ts:9`). Exactly two secrets, both Stripe; no database
credential, because D1 is a binding. No `firebase-admin` anywhere, so **the
Worker can verify tokens but can never mint one**.

**Residual risk, say it before they find it** (`DESIGN.md:445`): a stolen ID
token works for up to an hour and nothing detects it. Accepted, because behind
it is checkbox state and paid prose, never money. The mitigation is not
shipping XSS, hence the CSP at `vite.config.ts:15-31` that forbids inline
script.

---

## Block 4 (2:40 to 3:40) Bullet 4: payments

**Read:** `DESIGN.md:375-414` (section 8), `src/worker/webhook.ts` (all 185
lines), `src/worker/entitlement.ts` (all 60), `src/worker/checkout.ts`,
`migrations/0002_entitlements.sql`, `scripts/reconcile.mjs`,
`docs/adr/006-monetization-stripe-lifetime.md`.

**The flow:** a signed-in user POSTs `/api/checkout` (sign-in first is what
binds the purchase to an account), the Worker creates a Stripe session stamped
with the verified uid and `metadata.product = 'lifetime'`, the browser lands
on the hosted Stripe page, Stripe POSTs `checkout.session.completed` back, the
Worker verifies the signature and inserts the row. The success URL polls
`GET /api/me/entitlement` a bounded number of times, because the webhook
usually beats the redirect but not always.

**Signature verification** (`src/worker/webhook.ts:42-116`), all four
properties:

- HMAC-SHA256 over `${timestamp}.${rawBody}`, covering the **raw** body
- timestamp-bounded at 300s, which is what makes a captured payload
  non-replayable
- compared with `crypto.subtle.timingSafeEqual`
- **trusts no field the signature does not cover**; `metadata.product` is
  checked at line 162, so a signed event for another product grants nothing

**Idempotency** (`src/worker/entitlement.ts:33-51`), the subtlest code in the
repo. Walk the `ON CONFLICT` clause out loud:

- a live row is left untouched, so a redelivered event changes nothing
  (delivery is at-least-once)
- a **revoked** row is replaced, so a rebuy after a refund unlocks again
- but only when the event id differs, otherwise redelivering the refunded
  purchase's own event would silently undo the refund

Read the two tests that pin those side by side:
`test/integration/paywall.test.ts:104` and `:120`.

**Stripe's ledger is the source of truth**, D1 is a cache of it.
`scripts/reconcile.mjs` walks completed sessions and emits idempotent
`INSERT OR IGNORE` SQL, so losing the table is an inconvenience, not a broken
promise. Volunteer its gap: **reconcile does not walk refunds**, so a rebuild
re-grants anyone who was refunded. The script prints that warning itself.

**Merchant of record:** Stripe Managed Payments makes Stripe the seller, so
VAT in every buyer's jurisdiction, chargebacks and disputes are theirs. The
framing that lands: an individual with no registered company **cannot own
global tax compliance** (the EU charges VAT on digital goods from the first
euro, no threshold), and the 3.5% fee is the price of never having to.

**Two facts that trip you up if you skim the ADR:**

- The ADR's pricing corridor says $99 to $149, but the **live price is $57**
  (`TODO.md`, commit `6a7df69`). Quote $57.
- The refund window is 14 days, held as `REFUND_DAYS` in
  `src/app/pages/Legal.tsx` and rendered into both the terms and the sales
  card so the promise and the code cannot drift. Refunds are always the whole
  price, which is the only reason revoking on any `charge.refunded` is
  correct: Stripe sends that event for partial refunds too
  (`src/worker/webhook.ts:173-175`).

---

> **STOPPED HERE.** Blocks 0 to 4 are done: the whole system, the platform,
> the re-architecture, security by shape, and payments end to end. Resume
> below.

## Block 5 (3:40 to 4:20) Bullet 5: tests and CI

**Read:** `DESIGN.md:466-499` (section 11),
`docs/adr/010-testing-strategy.md`, `test/integration/helpers.ts`, then skim
all of `test/integration/paywall.test.ts`, then `.github/workflows/ci.yml`.

**Numbers:** 65 tests. 30 unit, 26 integration, 9 e2e. All offline and
credential-free.

**Lead with: verification is never stubbed.** Tests mint real RS256 tokens
against a committed throwaway key pair (`test/integration/helpers.ts:14-27`)
and really sign webhook payloads with Stripe's own HMAC scheme (`:36-49`). The
reasoning is the good part: **verification code is precisely what a mock would
fake, so faking it would test nothing.**

**The middle layer is the interesting one.**
`@cloudflare/vitest-pool-workers` runs the real Worker inside **workerd, the
production runtime**, against a real local D1 with the real migrations. Name
the rejected alternative: a mocked D1 binding **only ever agrees with
itself**, so it would pass the exact bug the test exists to catch.

**What integration pins:** the trust boundary (missing, expired,
wrong-audience tokens), per-user isolation, the gate returning 401/402 with no
leaked bytes, double-delivery granting once, tampered bodies, wrong-secret
signatures, stale-timestamp replays, refund revocation, rebuy after refund,
the SPA deep-link rewrite, and migrations applying twice cleanly.

**E2E:** four whole-stack flows, including the **degraded** one
(`test/e2e/degraded.spec.ts`) proving the free site still reads with every API
call failing, which is the entire point of splitting assets from the Worker.

**Own the limit:** the Google and GitHub popups and Stripe's hosted checkout
cannot be driven offline, so a test seeds the session a returning reader would
have restored (`test/e2e/session.ts`, ADR-011), and the purchase journey
resumes at the webhook. **What is skipped is Google's login screen, not the
trust boundary**: that seeded token is real and the Worker really verifies it.

**CI** runs typecheck, unit, integration, then Chromium e2e, on every push to
main and every PR, with **zero secrets**. That is deliberate: this repo has no
deploy path. The only deploy is a workflow in the private `deepcs-content`
repo, where the Cloudflare token lives, so nothing public can reach
production.

---

## Block 6 (4:20 to 4:40) Run it and break it

```bash
pnpm install && pnpm build
npx wrangler d1 migrations apply deepcs --local
npx wrangler dev          # :8787
```

Four minutes of poking:

1. `curl -i localhost:8787/api/me` gives **401**
2. `curl -i localhost:8787/content/paid/lessons/sample-premium-1.md` gives
   **401**, and no lesson text in the body
3. `curl -i localhost:8787/step/anything` gives **200** with `index.html`, the
   SPA fallback
4. `curl -i -X POST localhost:8787/api/webhooks/stripe -d '{}'` gives **503**
   or **400**, never a grant

Then `pnpm test && pnpm test:integration` and watch the paywall suite go
green. Note the line `build-content.mjs` prints: topic and step counts, which
is also the check that catches a build against the wrong `CONTENT_DIR`.

---

## Block 7 (4:40 to 5:00) Rehearse out loud

From memory, speaking, not reading. If one stalls, go back to its block.

1. Walk me through what happens when a paying user opens a paid lesson.
2. How do you stop me reading someone else's progress? (There is no uid
   parameter to change.)
3. Someone replays your webhook. What happens? (The 300s tolerance rejects it,
   and even inside the window the grant is idempotent by event id.)
4. Your D1 is wiped. What do you tell the customer who paid? (Stripe's ledger
   is the truth, reconcile rebuilds it; progress is lost, access is not.)
5. Why is a mocked D1 binding worse than no test?
6. Why did you throw away six services?
7. What is the weakest part of this system?

Question 7 separates people. Pick one and mean it: the 10ms CPU estimate is
unmeasured, a stolen ID token is undetectable for an hour, reconcile does not
walk refunds, single-vendor exposure. Give it without being asked.

---

## If there are only 90 minutes

`README.md`, all of `src/worker/` (700 lines, reads in one sitting),
`DESIGN.md:415-449`, and `test/integration/paywall.test.ts`. That covers
bullets 1, 3, 4 and 5. Bullet 2 needs the private archive regardless.
