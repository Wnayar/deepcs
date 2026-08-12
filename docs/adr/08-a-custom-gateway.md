# ADR-08 — A custom gateway instead of Kong

**Context:** the Gateway does JWT verification, routing, CORS and distributed
rate limiting — all four of which Kong DB-less provides, the rate limiter
included, via its `policy: redis` plugin.

**Decision:** build it anyway. The token bucket is the one component here whose
concurrency bug a product would otherwise fix on my behalf: two stateless
instances doing read-then-write on a shared bucket double-count under load, and
the fix — a Lua script Redis executes atomically — is only meaningful if you
have seen the broken version fail.

**Rejected:**

- **Kong DB-less**, the honest alternative: roughly fifteen lines of config, and
  what I would deploy commercially.
- **Envoy**, frequently suggested but a worse fit. Its `jwt_authn` filter would
  replace verification cleanly, but its *local* rate-limit filter is
  per-instance — exactly the split-bucket bug — and its *global* one delegates to
  a separate Redis-backed service. Envoy relocates the problem rather than
  removing it.

**Tradeoffs accepted:** no circuit breaking, retries or mTLS, none of which this
system needs; a hand-written proxy is a single point of failure I now own; and
every WebSocket burns a concurrency slot on the Gateway as well as on Collab.

**Note the symmetry with [ADR-04](04-managed-auth.md)** — the same test, the
opposite answer. Auth is bought because it is risk without insight; the gateway
is built because the insight is what is inside it.

See [`../system/01-gateway.md`](../system/01-gateway.md).
