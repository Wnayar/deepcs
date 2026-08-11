# One service per capability (6 deployables)

Context: six capabilities —
verify/route, profiles, question bank, matching, real-time sync, stats.
Decision: each is its own deployable. Two of the six are not really splits at
all: the **Gateway** is a *position* (a cross-cutting enforcement point must
sit in front of what it protects), and **Stats** is a *job* (time-triggered,
which a scale-to-zero service physically cannot do). **Collab is forced by the
workload:** concurrency and timeout are per-service settings,
and a 20-minute WebSocket needs the opposite values from a 30 ms request — one
service cannot hold both. Rejected: **grouping Users + Questions + Matching
into one service**, which a strict scaling-forces test would recommend, since
they share a request shape, failure domain and deploy cadence; an earlier
draft did exactly that. Chosen against for independent deploy and rollback per
capability, one clear owner per capability, and because operating a genuinely
distributed system is a stated goal of the project. Also rejected: **one
service per database table**, which aligns boundaries with no force at all.
Tradeoffs accepted: six CI pipelines; two extra network hops on the match
path; four processes in one request chain; contract tests as the
price of independent deploys; and no transaction spanning a service boundary
(see ADR-09). **The condition to merge back:** if cold-start latency on the
match path or the per-service ops overhead starts dominating, Users +
Questions + Matching recombine cheaply — they already share a database
instance, so it's a code move, not a data migration.
