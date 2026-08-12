# ADR-09 — One Postgres instance, one schema and one role per service

**Decision:** a single Postgres instance with a schema per service (`users`,
`questions`, `matching`, `collab`, `stats`), each accessed by its own role
granted privileges **only** on its own schema. A cross-service read is rejected
by the database, not discouraged by convention.

**No foreign key crosses a schema boundary.** A session row stores
`firebase_uid` and `question_id` as plain columns, validated by an API call at
creation time. That is the concrete thing given up, and it is deliberate: a
cross-schema FK would re-couple the services through the database.

**Rejected: database-per-service**, the textbook answer. Session creation
touches profiles, questions and sessions, and across separate databases no
transaction covers them — it would need a **saga** (each step given an explicit
compensating action, plus persisted saga state and a sweeper for crashed runs),
which is a large amount of machinery for a two-person editor.

**Also rejected: a shared schema**, which removes the boundary entirely and
makes the services non-independently-deployable in practice — a distributed
monolith.

**Tradeoffs accepted:** one instance is a shared failure domain and a shared
connection budget, which would need a pooler in front of it before many replicas
were real; and the "microservices" claim rests on services owning their
*tables*, not their *instances*.

**The condition to split:** one service's data outgrowing the instance or
needing a different store — Collab snapshots moving to object storage is the
likeliest first case — or separate teams needing independent migrations. At that
point cross-service atomicity is lost and session creation needs a saga. The
ordering here is chosen so that split stays cheap, because no query crosses a
boundary today.

See [`../system/08-data.md`](../system/08-data.md) §2.
