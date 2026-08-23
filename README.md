# deepcs

**A CS-fundamentals roadmap: read the lessons in the order the map
recommends, answer the questions, tick off what you can explain.**

Ten topics laid out by what makes what easier to read, each opening into
steps: a lesson plus the questions it prepares you for, with self-serve
reference answers. The first three topics are free; a one-time purchase
unlocks the rest. Live at **[deepcs.org](https://deepcs.org)**.

**Stack:** one Cloudflare Worker (static assets + a six-route API) · D1 ·
React + Vite · Firebase Auth (verified in-Worker with `jose`) · Stripe
Managed Payments. The full design, with every decision and the alternatives
it beat, is in [DESIGN.md](./DESIGN.md).

---

## This repo runs on sample content

The real lessons live in a private content repo and meet this code only at
deploy time (DESIGN.md §8). What ships here is a small set of clearly
labeled fixtures — including one *paid* fixture topic, so the paywall is
runnable and testable from this repo alone. Everything below works with no
accounts, no secrets, and no network beyond `pnpm install`.

## Running it

```bash
pnpm install
pnpm build                                  # SPA + content split into dist/client
npx wrangler d1 migrations apply deepcs --local
npx wrangler dev                            # the whole stack on :8787
```

`pnpm dev` runs Vite alone with hot reload (content served ungated, no API).
`CONTENT_DIR=../deepcs-content pnpm build` builds against real content, for
whoever has that repo.

## Testing

```bash
pnpm test               # unit: pure logic, milliseconds, no I/O
pnpm test:integration   # the real Worker in workerd, real local D1,
                        # really-signed JWTs and webhooks (DESIGN.md §15)
```

The trust boundary, the paywall, webhook forgery and replay, refund
revocation, and the SPA deep-link promise are all asserted against the
production runtime, offline.

## History

This is v2. Its predecessor was a six-service distributed system — Yjs
collaborative editing, matchmaking, Redis streams, a local Kubernetes
cluster, a k6 measurement harness — built, measured, and then simplified
away when a user survey showed no demand for pair-solving. That repo is
private (code and measurements intact); ask if you'd like a look.
