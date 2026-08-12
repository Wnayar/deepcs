# Data

One PostgreSQL instance, five schemas, five roles, and no foreign key crossing a
boundary. One Redis, doing five unrelated jobs. Migrations are numbered `.sql`
files and there is no ORM.

The decisions are
[`../adr/09-one-database-one-schema-per-service.md`](../adr/09-one-database-one-schema-per-service.md)
and
[`../adr/10-hand-written-sql-for-now.md`](../adr/10-hand-written-sql-for-now.md).
This page is what they look like in the schema.

---

## 1. What is where

| Schema | Role | Tables |
|---|---|---|
| `users` | `users_svc` | `profiles` |
| `questions` | `questions_svc` | `bank`, `topics` |
| `matching` | `matching_svc` | `sessions` |
| `collab` | `collab_svc` | `snapshots` |
| `stats` | `stats_svc` | `session_summaries`, `signups`, `queue_joins` |
| `public` | (owner only) | `schema_migrations` |

*Why one instance and not a database per service?* A database per service costs
cross-service atomicity and forces a saga for anything spanning two of them, for
a system that runs on one machine. A schema per service with a role per service
buys the enforcement without the operational weight — and the enforcement is the
part that was actually wanted.

`schema_migrations` lives in `public` because it belongs to none of the five, and
putting it in one would give that service's role a reason to be granted something
it otherwise does not need.

---

## 2. `GRANT USAGE` is the service boundary

[`002_service_roles.sql`](../../packages/db/migrations/002_service_roles.sql)

**The failure this prevents:** six services share one database. Someone writes a
query joining across two services' tables because it is easier. The services are
no longer independently deployable and nobody notices for a year.

**The mechanism:** each service connects as its own Postgres role with `USAGE` on
its own schema only. Without `USAGE`, every reference to a table in another
schema fails at *name resolution*, before table-level permissions are even
considered. One missing grant is the whole boundary.

```
SELECT count(*) FROM users.profiles;   -- as users_svc: works
SELECT 1 FROM matching.sessions;       -- as users_svc: permission denied for schema matching
```

The boundary is enforced by the database, not by convention. A cross-service
query does not get reviewed; it gets refused. That is a test, not a comment —
[`users/src/repository.test.ts`](../../services/users/src/repository.test.ts)
asserts the database's refusal.

**Three more lines matter as much as the grants:**

- **`ALTER DEFAULT PRIVILEGES`** covers tables created by *later* migrations.
  Without it every future migration would have to remember to re-grant, and the
  one that forgets produces a service that starts fine and fails on its first
  query.
- **`REVOKE CREATE ON SCHEMA public FROM PUBLIC`.** Postgres 15+ does this by
  default, but stating it means the guarantee does not depend on which server
  version an environment happens to run.
- **`ALTER ROLE … SET search_path`** is defence in depth. Queries are written
  fully qualified anyway; this only decides what a *mistake* does, resolving an
  unqualified name inside the service's own schema rather than letting it fall
  through to `public`.

**The boundary also lives in compose and in the ConfigMap.** Each service is
given its own `DATABASE_URL` with its own role. A single shared `DATABASE_URL` in
the compose anchor would be the one line silently undoing everything in this
section, which is why the anchor comment says so explicitly.

**No `GRANT` in that file crosses a boundary, and none ever should.** Stats reads
other services' data through the event log, not through their tables. If a
crossing grant ever appears there, the decision has been abandoned and the doc
should say so rather than the schema quietly disagreeing with it.

### No foreign key crosses a schema

`matching.sessions` stores `user_a_uid`, `user_b_uid` and `question_id` as plain
columns. `collab.snapshots` stores `session_id` the same way. None of them is a
foreign key, because a cross-schema FK would re-couple services that are supposed
to deploy independently.

They are validated by an **HTTP call at creation time** and never checked again:
Matching asks Users whether a uid exists and Questions for a matching question,
Collab asks Matching whether a uid is in a session. That is the concrete thing
given up, and it is deliberate.

---

## 3. The tables

**`users.profiles`** — `firebase_uid text NOT NULL UNIQUE` is the join key for
the whole system, and `UNIQUE` is what the lazy upsert conflicts against
([`02-users.md`](02-users.md) §2).

**`questions.bank`** — `parts jsonb`, `reference_md text`, `lesson_md text`,
`step int`, `tags text[]` with a GIN index, `difficulty` under a `CHECK`. No
`topic` column: a question's topic is `tags[1]`.

**`questions.topics`** — `depends_on text[]` and `grid_x`/`grid_y`, which are the
roadmap's edges and positions, seeded rather than computed
([`03-questions.md`](03-questions.md) §1).

**`matching.sessions`** — the two uids, the question, `reveal_consents text[]`
and a nullable `ended_at`. The consents are an array rather than a join table
because a session has exactly two participants and always will. `ended_at` is
nullable rather than a `status` column: "not ended" is the absence of an end
time, not a second state to keep in sync.

Two plain indexes on the uid columns, because a lookup asks "does this user
appear as *either* side", and two **partial** indexes `WHERE ended_at IS NULL` on
top, because from the moment `ended_at` existed that question meant unended
sessions only ([`04-matching.md`](04-matching.md) §8).

**`collab.snapshots`** — `session_id uuid PRIMARY KEY`, `state bytea`. One row
per session; `state` is `Y.encodeStateAsUpdate(doc)`.

**`stats.*`** — three tables and not one counter among them, which is the whole
point ([`06-events-and-stats.md`](06-events-and-stats.md) §4).

---

## 4. Migrations

[`packages/db/migrate.mjs`](../../packages/db/migrate.mjs) is the whole runner:
numbered `.sql` files applied in filename order, each inside a transaction, each
recorded in `public.schema_migrations` so it is never applied twice.

It is under a hundred lines because **Postgres has transactional DDL** — a
migration that fails halfway leaves nothing behind. In MySQL each statement commits on its own
and a half-applied file has to be unwound by hand, which is where migration
libraries earn their weight.

It runs as the **owner** role, never a service role: creating schemas and handing
out grants is exactly what the service roles are forbidden from doing.

*Why not a migration library?* The ORM is deferred, and a library would bring back
the schema-definition language that deferral exists to avoid. The `GRANT`/`REVOKE`
work in §2 stays literal SQL rather than something generated.

**Migrations are additive and never edited in place** — except that seeds
sometimes have to be, and then there is one thing to know. A migration is
recorded by filename, so **changing an already-applied file is a no-op until its
row is deleted**:

```bash
docker compose exec -T postgres psql -U deepcs -d deepcs \
  -c "DELETE FROM public.schema_migrations WHERE filename LIKE '%009%';"
DATABASE_URL="postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs" \
  pnpm --filter @deepcs/db migrate
```

The seeds are written to be re-runnable precisely so this is safe. `005` and
`009` both use `ON CONFLICT … DO UPDATE`, keyed on a unique index over the
question title and on the topic key: without a key to conflict on, re-running
against a database whose bookkeeping table was wiped would silently double every
question, and `DO UPDATE` additionally means editing the content and re-running
refreshes the row rather than being ignored.

**Questions caches the roadmap for 60 seconds**, so after re-seeding, also
`redis-cli DEL questions:roadmap` or wait a minute before believing the API.

`make up` migrates on its own: compose runs a one-shot `migrate` service that
every other service waits on, so nothing races a half-migrated database. The
separate `make migrate` target is for the case that does not cover, which is
adding a migration while the stack is already running.

---

## 5. The access layer

`pg` plus hand-written parameterized SQL. No ORM, no query builder.

The cost is one hand-written row mapping per repository — the single place a
snake_case schema and a camelCase API meet — so schema drift shows up in one
function rather than at five call sites. Drizzle is **deferred, not rejected**;
it is the first item in the additive backlog. It should not be introduced ad hoc.

**One `pg.Pool` per service process**, and the comment on it is the part worth
reading: the pool avoids a handshake per query *within one process*, and it is
not and cannot be the thing that bounds total connections, because every replica
runs its own copy and none of them can see the others. `max` is a per-instance
number and the figure that matters is `max × replicas × services`. Bounding the
total needs something every replica passes through, which is a pooler in front of
Postgres.

Two pool settings are failure-mode choices rather than tuning: `idleTimeoutMillis`
returns a connection after 30s idle, because an idle connection is a Postgres
backend process charged for in memory and in the connection limit whether or not
a query arrives; and `connectionTimeoutMillis` fails fast, because without it a
service with a bad `DATABASE_URL` reports itself live and merely never answers,
which reads as a slow dependency instead of a misconfiguration.

**`pingDb` is `SELECT 1`, deliberately, and not a query against a real table.**
Readiness asks whether traffic may be routed here. A service whose own tables are
missing is a migration problem that a restart will not fix, which is a *liveness*
answer, not a readiness one.

That choice has a consequence on the cluster: a service started before the
migration Job would pass its readiness probe against an empty database and serve
queries against tables that do not exist, which is why the ordering in
`k8s/up.sh` is a script rather than a set of manifests
([`09-running-it.md`](09-running-it.md) §2).

---

## 6. Redis, and its five jobs

Split from Postgres by **access pattern** — ephemeral shared state against
durable relational data — rather than by service.

| Job | Keys | Owner |
|---|---|---|
| Rate-limit buckets | `rl:ip:<ip>`, `rl:user:<uid>` | Gateway |
| Match queue | `match:queue:<topic>:<difficulty>` | Matching |
| Pub/sub | `match:session:<id>`, `match:user:<uid>`, `collab:doc\|awareness\|sync:<id>` | Matching, Collab |
| Event stream | `events` (one stream, group `stats`) | everyone appends, Stats reads |
| Question cache | `questions:list:<filters>`, `questions:roadmap` | Questions |

Only the last is a pure optimisation. The first two are correctness requirements
that depend on Redis running a Lua script start to finish with nothing
interleaved, which is why both live in Lua and not in application code.

**ioredis rather than node-redis** for one reason: `defineCommand` registers a
script once and calls it by SHA thereafter, with an automatic fallback to `EVAL`
if Redis has forgotten it. The rate limiter's atomicity depends on that script,
so the client's script handling is not an incidental detail.

**The client fails fast by default**, and that default is overridden in exactly
three places. `maxRetriesPerRequest: 2` and `enableOfflineQueue: false` mean a
Redis outage produces requests that 503 rather than requests that hang — and a
hanging request holds a concurrency slot, so the outage spreads. That suits a
client whose first command arrives with a user's request. It is wrong for a
long-lived subscriber (Collab's rooms, Matching's event stream), which subscribes
at startup, and for the Stats job, whose first command races its own connect
because there is no request to wait for. In both, failing fast means failing at
startup for a socket that is about to be ready, which is not a useful kind of
fast.

**No persistence anywhere.** Redis holds queue state, buckets, a cache and the
event log; on the cluster saving is turned off outright. Losing it costs the
event backlog and whoever was mid-queue, and costs nothing that a Postgres row
was the record of.

---

## 7. Tests use the real thing

Real Postgres and real Redis, never mocks. The properties under test are a Lua
script's atomicity, a role being refused a schema, cursor pagination not skipping
rows under concurrent inserts, and `ON CONFLICT` semantics. A mock would only
prove it agrees with itself — and the racy rate limiter would pass.

`make test` needs the stack up for exactly this reason, and the guard that makes
a bare checkout still pass is why the target passes six environment variables
rather than being `pnpm -r test`
([`09-running-it.md`](09-running-it.md) §1).
