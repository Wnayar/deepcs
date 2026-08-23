# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## Project context

**This is DeepCS v2: a deployed product.** One Cloudflare Worker serves the
React SPA and free content as static assets and runs a six-route API
(progress, entitlement, checkout, webhook, paid-content gate) against D1.
Identity is Firebase Auth verified in-Worker; payments are Stripe Managed
Payments (merchant of record). **DESIGN.md is the constitution** — every
architectural decision, with the alternatives it beat, lives there. When a
change contradicts DESIGN.md, update the document in the same change or
don't make it.

- **Real content never enters this repo.** It lives in the private
  `deepcs-content` repo (all 10 topics, `access: free|paid` per topic) and
  joins this code only at deploy time. This repo carries clearly-labeled
  sample fixtures in `content/`, including one paid fixture topic so the
  paywall is testable here. This rule is the paywall: treat any real lesson
  text appearing in this repo as an incident, not a style issue.
- The distributed v1 (six services, Yjs collab, matching, Redis, k8s) is
  preserved in the private `deepcs-v1` repo. Don't rebuild what it proved;
  don't describe this repo as if it still is that system.

## Running it

```bash
pnpm build && npx wrangler dev        # the whole stack on :8787
npx wrangler d1 migrations apply deepcs --local   # once per fresh checkout
pnpm dev                              # Vite only: hot reload, ungated content
CONTENT_DIR=../deepcs-content pnpm build          # build against real content
pnpm test                             # unit
pnpm test:integration                 # builds, then real Worker in workerd
```

## Conventions

**Security shape (DESIGN.md §12) — preserve these by construction:**

- **No route ever accepts a uid.** The surface is `/api/me/*`; identity
  comes only from the verified token's `sub`. Adding a route that names a
  user re-opens the IDOR class the shape currently makes inexpressible.
- **The paid gate is server-side only.** Paid bytes are served by the
  Worker after a token + entitlement check; UI locks are presentation.
  Paid paths live under `/content/paid/*`, which `run_worker_first` routes
  to the Worker — a paid file on any other path is publicly served.
- **Exactly two secrets** (Stripe secret key, webhook signing secret), set
  with `wrangler secret put`, never in git, never in wrangler.toml. The
  Firebase project id and API key are public identifiers.
- **The webhook route's credential is its signature**, not a Firebase
  token: HMAC verified over the raw body, timestamp-bounded, idempotent by
  event id. Never trust a payload field the signature doesn't cover.
- The Worker can only *verify* tokens (`jose` + Google's JWKS). Nothing
  here can mint one; keep it that way — no `firebase-admin`.

**Data:**

- D1 via numbered migrations in `migrations/`, applied by wrangler and
  tracked by the platform — no hand-editing applied files.
- D1 is a cache of Stripe's ledger for entitlements (DESIGN.md §9):
  `scripts/reconcile.mjs` can rebuild the table. Progress and entitlements
  are the only state anywhere.
- Writes are idempotent: progress PUT replaces state, entitlement grant is
  `INSERT OR IGNORE` on event id + primary key.

**Content:**

- Fix content at the source: a typo is a commit in `deepcs-content` and a
  redeploy, never a render-time patch.
- `scripts/build-content.mjs` is both the tier-splitter and the validator
  (missing lessons, orphans, unknown steps, empty free tier, em/en dashes).
  A content mistake should fail the build, not surface as a broken deploy.
- **No em or en dashes in anything a reader sees** (lessons, questions,
  answers, titles, UI strings). The validator asserts it. Code comments and
  these docs are exempt.

**The browser:**

- **Every screen is a URL**, no exceptions in v2, and a route refetches
  rather than trusting handed state. The SPA fallback (unknown path →
  index.html, 200) is asserted by an integration test.
- **Every poll is bounded.** The only poll in the app is /upgrade/thanks
  asking for the entitlement a few times after checkout. Anything new that
  asks on a timer needs a reason to exist and a bound on three sides.
- Interactive elements do not nest; colours live in `:root` custom
  properties; both inherited from v1 and still true.

**Testing (DESIGN.md §15):**

- Pyramid, no coverage target: many unit tests (pure logic), ~24
  integration tests (the real Worker in workerd with real local D1), e2e
  thin. Every test pins a named failure.
- **Never stub verification.** Integration tests mint real RS256 tokens
  against the committed throwaway key pair (`test/fixtures/test-jwks.json`)
  and really-sign webhook payloads; the Worker verifies both exactly as in
  production. A mock here would happily approve the bug the test exists to
  catch.

### Comment style (inherited from v1, still the rule)

- Plain sentences, not arrow-chain shorthand.
- Non-obvious logic gets a short comment with a concrete example.
- A citation names its document: `DESIGN.md §9`, never a bare `§9`.
- One fact, one home: a comment carries the mechanism and the consequence,
  then points at DESIGN.md; the copy nobody updates is the one in the
  comment.
