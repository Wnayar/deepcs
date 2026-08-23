# ADR-002: Platform — Cloudflare Workers

**Status:** Accepted, 2026-08-23. Pricing checked the same day.

## Context

The app is idle almost all of the time, then a link is shared: **the cold
path is the common path.** Two questions decide the platform, in order: what
does the meter do while idle, and what happens at the ceiling. Tie-breaker:
how many things to deploy.

## Decision

Cloudflare Workers with static assets. Static requests are free, unlimited,
and never invoke the Worker; the API is the only compute.

## Alternatives considered

| Option | Idle meter | Cold path | At the ceiling | Deploys | Verdict |
|---|---|---|---|---|---|
| **Cloudflare Workers + static assets** | $0; static never invokes the Worker | V8 isolate, no container: single-digit ms | past the daily quota, `/api/*` returns 429 while static keeps serving; no bill | 1 | ✅ chosen |
| Firebase Hosting + Cloud Run (min-instances=0) | $0 compute, but Hosting transfer is metered (10 GB free, then $0.15/GB **billed**) | container start 0.5–2 s on every idle-then-visited request | over transfer → a bill | 2 | ❌ |
| Cloud Run min-instances=1 | ~$92/mo always-on | none | n/a | 2 | ❌ pays for absence |
| Small VM (Hetzner/Fly/droplet) | $4–5/mo, full price idle | none | you are the ceiling: patching, TLS, backups | 1 | ❌ closest call; right only if a long-lived process were needed |
| Vercel/Netlify + functions | $0 idle | good | per-project fair-use with billed overage | 1–2 | ❌ no advantage here, weaker fail-refuse |

## Consequences

The free plan caps CPU at **10 ms per request**. Verifying a JWT against a
cached JWKS, one D1 read, and a webhook HMAC are each 1–3 ms (the Stripe call
in checkout is I/O, not CPU), so the API fits with room to spare — but this
choice is only correct while the API stays this small. A feature needing real
compute revisits it. Verify before relying on it (DESIGN.md risks).
