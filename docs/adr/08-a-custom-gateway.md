# A custom gateway instead of Kong

Context: the Gateway does JWT
verification, routing, CORS and distributed rate limiting — all four of which
Kong DB-less provides, the rate limiter included, via its `policy: redis`
plugin. Decision: build it anyway. The token bucket is the one component here
whose concurrency bug a product would otherwise fix on my behalf — two
stateless instances doing read-then-write on a shared bucket double-count
under load — and the fix (a Lua script Redis executes atomically) is only
meaningful if you've seen the broken version fail. Matching's pair claim
(see decision 3) is the same race, but there is no product to buy instead, so it was
never a build-vs-buy decision at all. Rejected: **Kong DB-less**, the honest alternative, ~15
lines of config and what I'd deploy commercially; **Envoy**, frequently
suggested but a worse fit — its local rate-limit filter is per-instance and
its global one delegates to a separate Redis-backed service, so the problem is
relocated, not solved; **GCP API Gateway**, which doesn't proxy WebSockets;
**Cloud Armor**, which needs an external load balancer at roughly $18/month
standing charge and breaks §7. Tradeoffs accepted: no circuit breaking,
retries or mTLS, none of which this system needs; a hand-written proxy is a
single point of failure I now own; and every WebSocket burns a concurrency
slot on the Gateway as well as on Collab (§5). **Note the symmetry with
ADR-04** — same test, opposite answer: auth bought because it is risk without
insight, the gateway built because the insight is what's inside it.
