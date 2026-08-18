# ADR-03 — Reactive matching with an atomic pair claim

**Decision:** pairing runs at the moment a user joins, and the claim is a Redis
Lua script.

**Why not a loop scanning the queue every second:** it is easier to reason about,
but it needs an always-on process, which nothing else in this system requires,
and it adds up to a second of latency for no benefit.

**What being reactive costs:** the claim has to be atomic, because two users can
join at the same instant and race for the same partner. Redis runs one script
start to finish before beginning the next, which is where that atomicity comes
from. It is the same race, and the same fix, as the Gateway's rate limiter
([ADR-08](08-a-custom-gateway.md)) — except that nobody sells you a matchmaker,
so this one was never a build-vs-buy decision.

**What the same script picked up later:** a queue entry is only claimable for
sixty seconds, pruned at the top of the script rather than by a sweeper, because
nothing tells the server a browser has gone
([ADR-11](11-polling-over-server-sent-events.md)). Reactive pairing has no
always-on process to hang a cleanup off, so the cleanup rides on the operations
that already touch the queue.

See [`../system/04-matching.md`](../system/04-matching.md) §2.
