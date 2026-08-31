# Six hours to own DeepCS

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

## Block 5 (3:40 to 4:15) Bullet 5: the three test layers

**Read:** `DESIGN.md:466-499` (section 11), `docs/adr/010-testing-strategy.md`,
the header comment in `test/fixtures/test-jwks.json`, then
`test/integration/helpers.ts` (all 79 lines) beside the bindings block in
`vitest.workers.config.ts:24-31`, then skim `test/integration/paywall.test.ts`.
CI moved to Block 6.

**Numbers:** 66 tests. 31 unit, 26 integration, 9 e2e. All offline and
credential-free.

**a) Three layers, and where each one lives.** The layout is itself the
argument:

| Layer | Lives | Runs against |
|---|---|---|
| Unit | beside its subject, `src/**/*.test.ts` | nothing, pure functions |
| Integration | `test/integration/` | the real Worker in workerd, real local D1 |
| E2E | `test/e2e/` | Chromium against `wrangler dev` |

A unit test sits next to its code because it belongs to one module and should
move and die with it. The other two belong to no single file, need a built
`dist/` and their own runtime, so they get their own tree. Only `*.test.ts`
and `*.spec.ts` are collected as suites; everything else under `test/` is
support, and knowing which is which is most of reading the folder:
`helpers.ts` builds inputs, `setup.ts` applies migrations before each file,
`fixtures/` is fixed data rather than code, `env.d.ts` is types only.

**b) The fixture chain. The one setup worth being able to draw.** This is what
"tests mint real tokens" actually means, and it is five steps:

1. `test/fixtures/test-jwks.json` holds **one RSA key pair, both halves**,
   committed deliberately. Its header comment says why.
2. The **public** half is handed to the Worker as configuration.
   `vitest.workers.config.ts:27` reads the file and binds it as
   `AUTH_JWKS_JSON`; `playwright.config.ts:43` passes the same thing to
   `wrangler dev`.
3. `src/worker/auth.ts:33-38` branches on that binding: **a JWKS present means
   tests**, so build a local key set; **absent means production**, so fetch
   Google's. That single branch is the entire difference between a test run
   and a live one.
4. The **private** half never leaves `helpers.ts`, where `mintToken` (`:13-27`)
   signs a Firebase-shaped token with it.
5. The Worker then runs the same `jwtVerify` it always runs: signature,
   issuer, audience, expiry.

Say it as **same lock, different key.** What is swapped is which key pair,
never whether the checking happens.

Stripe works the same way and is simpler, because HMAC is symmetric and needs
no pair: one shared string, `whsec_test_secret`, in `helpers.ts:29` and
configured at `vitest.workers.config.ts:29`. `stripeSignature` computes a real
signature over the real body; `webhook.ts` recomputes it and compares.

**c) The overrides are the point.** `mintToken` and `stripeSignature` each take
an options object whose only job is to produce a credential that is **perfect
in every respect except one**: a token whose audience is another project, a
body signed with the wrong secret, a signature carrying an hour-old timestamp.
Those near-misses are the actual attacks, and they are what Block 3b's
audience claim rests on (`test/integration/api.test.ts:32`). A stub can
express none of them, because with a stub there is no audience being checked
in the first place.

**d) Never stub verification, and what that does not mean.** The rule is
narrow on purpose: never fake the two checks that decide whether to believe a
caller, the Firebase token and the Stripe signature. Everything the app trusts
flows from those two answers. The reasoning is the part worth saying out loud:
**verification code is precisely what a mock would fake, so faking it would
test nothing**, and a broken auth check does not crash or log, it silently
admits strangers.

It is not a ban on test doubles. `src/worker/rate-limit.test.ts:4` fakes the
Cloudflare rate-limit binding, and that is correct: the binding has no local
existence to run, and what is under test is the branching around it, not the
binding. **Stub a dependency you are not asserting on; never stub the thing
whose correctness is the claim.**

**e) The middle layer is the interesting one.**
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

**Run all three, then break one thing:**

```bash
pnpm test               # 31 unit, milliseconds, no runtime
pnpm test:integration   # builds, then 26 inside workerd
pnpm test:e2e           # builds, migrates, 9 in Chromium
```

Then delete `audience: env.FIREBASE_PROJECT_ID` from `src/worker/auth.ts:61`
and run `pnpm test:integration` again. Exactly one test goes red. That is what
an unstubbed trust boundary buys you, and it is the fastest way to feel why
the rule exists. Put the line back.

**If you want the number, it is one command:**

```bash
pnpm test:coverage      # unit layer only
```

It prints **8.72% of statements**, and that figure argues for ADR-010's "no
coverage target" rather than against it. Three things in the output say why:

- It counts everything it can see, including `playwright.config.ts`,
  `scripts/reconcile.mjs`, and every page component that only the browser
  flows exercise. None of those are unit-testable and none should be.
- It reports `src/worker` at **5%**, which is the most thoroughly tested code
  in the repo. The 26 integration tests drive `auth.ts`, `webhook.ts`,
  `content.ts` and `entitlement.ts` hard, and this number cannot see any of it.
- Coverage cannot run on the integration suite at all. `@vitest/coverage-v8`
  imports `node:inspector`, which workerd does not have, so the run dies
  before collecting a single test. Cloudflare documents it as a known issue.

The sharper point is the one below: both untested paths in the next paragraph
would report as **covered**, because the lines execute. Coverage measures
lines reached, not cases distinguished.

**The answer to "what is your coverage?"** is not a percentage. It is: no
target, on purpose, and here are the paths that are not covered, by name.

**Weak spots to own here.** How the key pair was generated is written down
nowhere; it arrived whole in commit `0be2ea9`. Nothing regenerates it, so if
it were lost the answer is "generate another RS256 pair and match the `kid` on
both halves", not "recover it". And two webhook paths have no test, because
the helper cannot build the input: `webhook.ts` accepts **several** `v1`
signatures to cover Stripe's secret rotation, but `stripeSignature` only ever
emits one; and `completedEvent` has no way to set `payment_status`, so the
`isPaid` condition of the grant is unpinned.

**Self-test:** without looking, explain how a token this repo signs itself
ends up accepted by the same code that accepts one from Google.

---

## Block 6 (4:15 to 4:35) CI, CD, and why they live in different repos

**Read:** `.github/workflows/ci.yml` (all of it, it is short),
`DESIGN.md:336-377` (section 7, the two repos and the deploy),
`docs/adr/007-free-paid-line-two-repos.md`, and the **Deploying** section of
`CLAUDE.md`.

This is the part that sounds wrong until you say why. **The repo you are
looking at has no deploy path at all**, on purpose.

```
  deepcs (public)                       deepcs-content (private)
  code, sample fixtures                 real lessons, deploy.yml, CF token
        |                                             |
        | ci.yml                                      | deploy.yml
        | typecheck + 3 test layers                   | checks out BOTH repos
        | zero secrets                                | builds CONTENT_DIR=../deepcs-content
        | never deploys                               | wrangler deploy
        |                                             |
        +---------------> dist/ <---------------------+
                  the only place code and
                  content ever meet
```

**a) CI here cannot reach production, and that is the design.** No Cloudflare
token exists in this repo or its Actions secrets. `ci.yml` runs typecheck,
unit, integration and Chromium e2e on every push to `main` and every PR, and
stops. It can afford to be credential-free because the tests are: they sign
their own tokens and webhook payloads (Block 5b), so nothing needs an account.

**b) The only deploy is `deploy.yml` in the private content repo.** It holds
the Cloudflare token, checks out both repos, builds with
`CONTENT_DIR=../deepcs-content`, and runs `wrangler deploy`. It fires on a
push to that repo's `main`, or on manual dispatch from its Actions tab. It
always checks out **this** repo's `main`.

**c) So shipping a code change is two moves:** merge to `main` here, then run
that workflow there. A content change does both at once, because the workflow
always takes this repo's `main` along with it.

**d) Why split at all** (ADR-007): the content is the product. Real lesson
text in a public repo is not a style problem, it is the paywall failing. The
split enforces that in git rather than in review, and the deploy credential
sits with the content because that is the side that must not leak.

**e) The hazard to name before they ask.** `wrangler deploy` from a local tree
uploads whatever `dist/` holds, and a plain `pnpm build` fills `dist/` with
the sample fixtures. Running it locally would replace every real lesson with a
fixture and lock paying customers out of what they bought. The guard is a
habit rather than a mechanism: build with `CONTENT_DIR` and read back the
topic count `scripts/build-content.mjs` prints.

**f) Display prices live in `deploy.yml`, not here.** `.env.production` is
gitignored and reaches local builds only, so editing it changes nothing a
buyer sees. Worth knowing before you go looking for the price in this repo
and conclude it is wrong.

**The line that lands:** *my CI cannot deploy, because the deploy credential
belongs with the content, not with the code.*

**Weak spots to own.** There is **no staging environment**: the workflow's
only target is production, and the sole pre-flight check is a printed topic
count. The deploy workflow is also not visible from this repo, so you cannot
show it in an interview, only describe it. And nothing here fails a build that
was made against the wrong `CONTENT_DIR`; it only prints a number a human is
supposed to read.

**Self-test:** you fix a typo in a lesson and a bug in the Worker on the same
afternoon. What do you push, where, and in what order?

---

## Block 7 (4:35 to 4:55) Run it and break it

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

## Block 8 (4:55 to 5:40) The frontend, end to end

**No resume bullet claims this**, which is exactly why it earns 45 minutes: it
is the first thing an interviewer opens, and every claim in Blocks 1 and 3 has
a visible consequence here.

**Read:** `docs/adr/009-frontend-react-vite.md`, then `src/app/App.tsx` (all
252 lines, it is the whole route table), `src/app/auth.ts` (72),
`src/app/api.ts:1-60`, `src/app/progress.ts` (109), then skim
`src/app/pages/Step.tsx` and `src/app/pages/Roadmap.tsx`.

**The shape:** a React + Vite SPA, about 3,600 lines across eight pages. No
SSR, no state library, no component framework, one stylesheet. ADR-009's
reason is the one to give: **the build output *is* the asset directory**, and
any SSR framework reintroduces compute on the read path that static assets had
just made free.

**a) Every screen is a URL, and every route refetches.** `App.tsx:182-212` is
the entire route table; read it once and you have the app. An open topic panel
gets its own URL (`/topic/:topic`) so **Back closes the panel instead of
leaving the site**. No route trusts state handed to it by the previous screen,
so any link rebuilds its screen from scratch. The SPA fallback that makes deep
links survive a refresh is one line of `wrangler.toml`, pinned by an
integration test.

**b) Identity is the SDK's, never ours.** Google and GitHub popups only, no
passwords: nothing to brute force, no verification emails to run, and a bot
needs a real provider account per fake user. The ID token is fetched **per
request and never cached** (`auth.ts:64`), because tokens last an hour and a
cached copy silently turns into 401s. `api.ts:28-37` attaches it; signed out
sends no header at all, which is how the free tier works with no identity.

**c) The Firebase config is public on purpose** (`src/app/config.ts`). The API
key identifies the project, it does not authorize anything. Volunteer that
before someone "catches" you shipping a key in a bundle.

**d) The lock is presentation; the gate is the Worker.** `Step.tsx:41` holds
`denied: 401 | 402 | null`, taken from the status on a thrown `ApiError`, and
renders either the sign-in prompt or the upgrade prompt. **The page never
decides access, it renders a decision already made server-side.** This is
Block 3c seen from the other end, and it is the answer to the paywall
challenge in the rehearsal.

**e) Writes are optimistic, with rollback.** `progress.ts:71-80`: redraw
first, then tell the server; a failed write puts the checkbox back. The route
is a PUT that **replaces** rather than toggles, so a burst of clicks settles
on the last one instead of racing.

**f) One poll in the entire app, bounded on both sides.** `Upgrade.tsx:130`:
eight tries, two seconds apart, then it says refresh in a minute. It exists
because the webhook usually beats Stripe's redirect, but not always (Block 4).

**g) The map is pure geometry plus a thin component.** `roadmap-layout.ts`
keeps `fitView`, `zoomAt` and `edgePath` as pure functions, which is the only
reason they are unit-testable at all (Block 5a); `Roadmap.tsx` wraps them in
an SVG canvas with drag, wheel and pinch. The bug worth telling: **a
zero-height canvas produced a negative scale**, so the tree drew mirrored and
microscopic and the roadmap looked empty. Nothing threw and nothing warned,
which is why the test for it asserts on a refusal rather than on a number.

**h) Markdown renders client-side, with four house marks.**
`src/app/markdown.ts` turns `> **TLDR:**`, `> **Example:**`,
`> **Interview phrasing:**` and `**term** [gloss]` into the coloured asides
and the italic gloss. Those four strings are **a contract between the lessons
and the renderer**: rename a label and every lesson using it silently
un-styles, so `markdown.test.ts` pins the exact strings.

**i) Theming is CSS custom properties and nothing else.** One stylesheet,
colours defined only on `:root` with a `[data-theme='dark']` override, so a
theme switch is one attribute on the root element. No CSS framework anywhere.

**Weak spots to own.** There are **no component tests and no visual
regression tests**: the unit layer covers pure functions (markdown, section
splitting, geometry) and e2e covers whole flows, but nothing renders a
component in isolation. That follows from the pyramid in ADR-010, so say it as
a choice, not an oversight. Second, 3,600 lines with no state library is a
choice that stops working at some size; the honest defence is that eight pages
sharing one progress object sits well under that line, and `useProgress` is
the one piece of shared state in the app.

**Self-test:** an interviewer says *"your paywall is client-side, I can just
edit the React state and read the paid lessons."* Answer in two sentences.

---

## Block 9 (5:40 to 6:00) Rehearse out loud

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
7. I can edit your React state, so I can read the paid lessons. (No: the lock
   is presentation, the bytes never leave the Worker unentitled.)
8. You changed one line in the Worker. How does it reach production, and what
   would happen if you ran `wrangler deploy` yourself?
9. What is the weakest part of this system?

Question 9 separates people. Pick one and mean it: the 10ms CPU estimate is
unmeasured, a stolen ID token is undetectable for an hour, reconcile does not
walk refunds, single-vendor exposure. Give it without being asked.

---

## If there are only 90 minutes

`README.md`, all of `src/worker/` (700 lines, reads in one sitting),
`DESIGN.md:415-449`, and `test/integration/paywall.test.ts`. That covers
bullets 1, 3, 4 and 5. Bullet 2 needs the private archive regardless.
