# ADR-01 — One service per capability, six deployables

**Decision:** six capabilities — verify and route, profiles, the question bank,
matching, real-time sync, stats — each become their own deployable.

**Two of the six are not really splits.** The Gateway is a *position*: a
cross-cutting enforcement point has to sit in front of what it protects. Stats
is a *job*, time-triggered, which a service that is not running between requests
physically cannot be. Judging either by scaling profiles is a category error.

**Collab is forced by the workload.** Concurrency and timeout are per-service
settings, and a 20-minute WebSocket needs the opposite values from a 30 ms
request. One service cannot hold both.

**Rejected: grouping Users, Questions and Matching into one service**, which a
strict scaling-forces test would recommend — they share a request shape, a
failure domain and a deploy cadence, and an earlier draft did exactly that.
Chosen against for independent deploy and rollback per capability, one clear
owner per capability, and because operating a genuinely distributed system is a
stated goal of the project. Also rejected: one service per database table, which
aligns boundaries with no force at all.

**Tradeoffs accepted:** a match request chains four processes, so four network
hops and four chances to be waiting on a pod that has just been rescheduled;
contract tests as the price of independent deploys; and no transaction spanning
a service boundary ([ADR-09](09-one-database-one-schema-per-service.md)).

**The condition to merge back:** if latency on the match path or the per-service
overhead starts dominating, Users, Questions and Matching recombine cheaply.
They already share a database instance, so it is a code move, not a data
migration.
