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

## The project

DeepCS: a deployed CS-fundamentals roadmap with a free tier and a one-time
paid unlock. One Cloudflare Worker serves the React SPA and free content as
static assets and runs a six-route API (progress, entitlement, checkout,
webhook, paid-content gate) against D1. Firebase Auth is verified in-Worker;
Stripe Managed Payments is the merchant of record. **DESIGN.md states what
the system is; `docs/adr/` records why.** When a change contradicts DESIGN.md,
update it in the same change or don't make the change; a decision that weighs
alternatives goes in a new ADR, not inline.

**Real content never enters this repo.** It lives in the private
`deepcs-content` repo and joins this code at deploy time. This repo carries
clearly-labeled sample fixtures in `content/`, one fixture topic paid so the
paywall is testable here. This rule is the paywall: real lesson text in this
repo is an incident, not a style issue.

## Commands

```bash
pnpm build && npx wrangler dev        # the whole stack on :8787
npx wrangler d1 migrations apply deepcs --local   # once per fresh checkout
pnpm dev                              # Vite only: hot reload, ungated content
CONTENT_DIR=../deepcs-content pnpm build          # build against real content
pnpm test                             # unit
pnpm test:integration                 # builds, then the real Worker in workerd
```

## Invariants

**Security is by shape; preserve the shapes:**

- **No route accepts a uid.** The surface is `/api/me/*`; identity comes
  only from the verified token's `sub`.
- **The paid gate is server-side only.** Paid files live under
  `/content/paid/*` (run_worker_first); UI locks are presentation. A paid
  file on any other path is publicly served.
- **Exactly two secrets** (Stripe secret key, webhook signing secret), set
  with `wrangler secret put`, never in git or wrangler.toml.
- **The webhook route's credential is its signature**: HMAC over the raw
  body, timestamp-bounded, idempotent by event id. Never trust a field the
  signature doesn't cover.
- The Worker can only verify tokens, never mint them: no `firebase-admin`.
- **Mutating routes are per-uid rate limited** (checkout, progress write) via
  the native binding, keyed by uid so IP spread does not evade it. Absent
  binding is a no-op, so local dev and tests run unthrottled.

**Data:**

- D1 through numbered migrations in `migrations/`, wrangler-tracked; never
  edit an applied file.
- Entitlements are a cache of Stripe's ledger; `scripts/reconcile.mjs`
  rebuilds them. Writes are idempotent (PUT replaces, grant is INSERT OR
  IGNORE).

**Content:**

- Fix content at the source: a typo is a commit in `deepcs-content` plus a
  redeploy, never a render-time patch.
- `scripts/build-content.mjs` validates and splits content by tier; a
  content mistake must fail the build.
- **No em or en dashes in anything a reader sees.** The validator asserts
  it. Code comments and these docs are exempt.

**The browser:**

- Every screen is a URL, and a route refetches rather than trusting handed
  state. The SPA fallback is asserted by an integration test.
- Every poll is bounded. The only one is the post-checkout entitlement poll.
- Interactive elements do not nest; colours live in `:root` custom
  properties only.

**Testing:**

- Pyramid, no coverage target: every test pins a named failure.
- **Never stub verification.** Integration tests sign real tokens with the
  committed throwaway key pair and really-sign webhook payloads; the Worker
  verifies both exactly as in production.

## Comment style

Google-lean: every comment fights for its life. A comment states a
constraint the code cannot show, in plain sentences; no narration of what
the next line does. A citation names its document (`DESIGN.md §9`, never a
bare `§9`). One fact, one home: mechanism in the comment, reasoning in
DESIGN.md.
