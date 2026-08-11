# One Postgres instance, one schema per service, one role per service

Context: six services, and the question of who owns which tables. Decision: a
single Postgres instance with a schema per service (`users`, `questions`,
`matching`, `collab`, `stats`), each accessed by its own Postgres role granted
privileges **only** on its own schema — so a cross-service read is rejected by
the database, not discouraged by convention. **No foreign key crosses a schema
boundary**: a session row stores `firebase_uid` and `question_id` as plain
columns, validated by API call at creation time. That's the concrete thing
given up, and it's deliberate — a cross-schema FK would re-couple the services
through the database. Rejected: **database-per-service**, the textbook answer,
because session creation touches profiles, questions and sessions, and across
separate databases there is no transaction covering them — it would need a
**saga** (each step given an explicit compensating action, plus persisted saga
state and a sweeper for crashed runs), which is a large amount of machinery
for a two-person editor and would want an always-on orchestrator that §7
forbids. Also rejected: **a shared schema**, which removes the boundary
entirely and makes the services non-independently-deployable in practice — a
distributed monolith. Tradeoffs accepted: one instance is a shared failure
domain and a shared connection budget (mitigated by a pooled endpoint,
since every service instance holding its own pool would otherwise exhaust the
free tier's connection limit); and the "microservices" claim rests on services
owning their *tables*, not their *instances*. **The condition to split:** one
service's data outgrowing the instance, or needing a different store — Collab
snapshots moving to object storage is the likeliest first case — or separate
teams needing independent migrations. At that point cross-service atomicity is
lost and session creation needs a saga; the ordering here is chosen so that
split stays cheap, because no query crosses a boundary today.
