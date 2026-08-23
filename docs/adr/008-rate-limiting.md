# ADR-008: Rate limiting — per-uid binding plus edge rule

**Status:** Accepted, 2026-08-23.

## Context

On the free plan there is no overage billing, so no attacker can produce a
bill — a flood only fails to 429s. Rate limiting therefore defends against
denial-of-service and Stripe abuse, not a surprise invoice. Two attackers
matter: an anonymous flood (many requests, few IPs) and a bought account
spamming (one uid, possibly many IPs).

## Decision

Two layers, each where it is cheapest:
- **Per-IP at the edge** — a Cloudflare rate-limit rule on `/api/*` plus Bot
  Fight Mode, both running before the Worker is invoked (a blocked request is
  never a billable invocation). Dashboard toggles, no code.
- **Per-uid in the Worker** — Cloudflare's native rate-limiting binding, keyed
  by the verified uid (only the Worker knows it; IP does not identify a
  person). Checkout at 5/min (each call reaches Stripe), progress writes at
  60/min.

## Alternatives for the per-uid layer

| Option | Cost | Verdict |
|---|---|---|
| **Native binding, keyed by uid** | free; runs at the edge; ~10 lines | ✅ chosen — no new infrastructure to operate |
| Durable Object counter | a billable DO request per check, a component to run | ❌ the expensive way to the same result |
| In-Worker in-memory counter | a Worker invocation per check | ❌ false comfort: isolates are many and short-lived, the count resets |

## Consequences

Reads are left to the edge layer (high quota, harmless 429). An absent binding
is a no-op, so local dev and tests run unthrottled. The full order of defence:
(1) every write and paid read needs a valid token, so abuse costs an account;
(2) the per-IP edge rule; (3) the per-uid binding; (4) the free-tier ceiling,
which fails to 429 while the free static site keeps serving.
