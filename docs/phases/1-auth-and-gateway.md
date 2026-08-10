# Phase 1 — Auth, the Gateway, and the schema boundary

**What this phase proves** (DESIGN.md §10):

- an emulator token → a protected call succeeds
- a tampered or expired token → 401
- the `users` row appears **once**, no matter how many times the client calls
- a service querying another's schema is **rejected by Postgres**

Every heading below links to the code it describes. Open the file alongside this
page — the comments in the source explain *what*, this document explains *why*
and how the pieces connect.

---

# The four things — read this page, then stop if you're short on time

Phase 1 is ~270 lines of actual code and **four ideas**. Everything else is
plumbing that follows from them. Each one below is a failure that would be
invisible until it mattered, the line that prevents it, and the version you'd say
out loud.

## 1. The audience check · ~5 min

📄 [`auth.ts:96`](../../services/gateway/src/auth.ts#L96)

**The failure:** you verify a Firebase token's signature, its expiry, and its
issuer. All three pass. It was issued for someone else's Firebase project, and
you have just authenticated their user as one of yours.

**Why it happens:** Google signs *every* Firebase project's ID tokens with the
same key set. Signature alone therefore proves the token came from Google — not
that it was meant for you.

**Say it as:** *"Signature proves who signed it. `aud` proves who it was for.
With a shared key set you need both, and `aud` is the one people forget."*

## 2. The lost update · ~15 min — the one worth the most in an interview

📄 [`rate-limit.ts:31-85`](../../services/gateway/src/rate-limit.ts#L31) ·
test at [`rate-limit.test.ts:90`](../../services/gateway/src/rate-limit.test.ts#L90)

**The failure:** a user's rate-limit bucket has one token left. Two Gateway
instances each read `1`, each decide they may proceed, each write `0`. Two
requests allowed, one token spent. The limit is now a suggestion.

**Why an in-process lock doesn't fix it:** it would guard one instance's own
memory, at an address the other instance cannot reach and has never heard of.
This needs no threads and no shared memory — two ordinary processes on two
machines are enough.

**The fix:** atomicity has to live where the single copy of the state lives. A
Redis Lua script runs start-to-finish with nothing interleaved.

**Why a script and not `INCR`:** a fixed window is one atomic operation. A token
bucket reads two values, computes a refill from elapsed time, and writes both
back — three steps, so atomicity has to wrap them.

**Say it as:** *"Read-modify-write across two processes is a lost update. You
can't lock it locally because the state isn't local. Put the operation where the
state is."*

## 3. `ON CONFLICT DO NOTHING RETURNING` · ~5 min

📄 [`repository.ts:36`](../../services/users/src/repository.ts#L36)

**The failure:** you emit `user.signed_up` every time the client calls
`/users/me`, which is on every sign-in. Your sign-up metric is a request counter.

**The mechanism:** `ON CONFLICT … DO NOTHING` returns **no row** when the row
already existed. An empty result is therefore proof this was the first sight of
that UID — and since there is no signup endpoint, it is the only such proof
available.

**Say it as:** *"The empty result is the signal. `DO UPDATE` would return a row
every time and destroy it."*

## 4. `GRANT USAGE` is the service boundary · ~5 min

📄 [`002_service_roles.sql:44`](../../packages/db/migrations/002_service_roles.sql#L44)

**The failure:** six services share one database. Someone writes a query joining
across two services' tables because it is easier. The services are no longer
independently deployable and nobody notices for a year.

**The mechanism:** each service connects as its own Postgres role with `USAGE` on
its own schema only. Without `USAGE`, every reference to a table in another
schema fails at name resolution — *before* table-level permissions are even
considered. One missing grant is the whole boundary.

**Say it as:** *"The boundary is enforced by the database, not by convention. A
cross-service query doesn't get reviewed — it gets refused."*

---

**If you have 20 minutes total:** read the four above, then run Part 6's demo.
Everything between is reference for when something breaks.

---

## Read the code in this order

Roughly 700 lines total, and the first three files are 80% of the ideas.

| # | File | Lines | What it is |
|---|---|---|---|
| 1 | [`services/gateway/src/auth.ts`](../../services/gateway/src/auth.ts) | 207 | Token verification. Start here. |
| 2 | [`services/gateway/src/rate-limit.ts`](../../services/gateway/src/rate-limit.ts) | 155 | The Lua token bucket — ADR-08's whole reason to exist. |
| 3 | [`services/gateway/src/index.ts`](../../services/gateway/src/index.ts) | 256 | Wires both into hooks, then proxies. |
| 4 | [`services/users/src/repository.ts`](../../services/users/src/repository.ts) | 104 | The lazy upsert and why `RETURNING` matters. |
| 5 | [`packages/db/migrations/002_service_roles.sql`](../../packages/db/migrations/002_service_roles.sql) | 75 | The schema boundary, as literal SQL. |
| 6 | [`packages/shared/src/headers.ts`](../../packages/shared/src/headers.ts) | 43 | Why "absent" is a state, not a gap. |

Supporting, read when you need them:
[`packages/db/migrate.mjs`](../../packages/db/migrate.mjs) ·
[`packages/shared/src/db.ts`](../../packages/shared/src/db.ts) ·
[`packages/shared/src/redis.ts`](../../packages/shared/src/redis.ts) ·
[`services/users/src/index.ts`](../../services/users/src/index.ts) ·
[`docker-compose.yml`](../../docker-compose.yml)

---

# Part 1 — The map

```mermaid
flowchart TD
    C["Browser<br/>Firebase JS SDK"]
    FB["<b>Firebase Auth</b><br/>owns credentials<br/>issues ID tokens (RS256)"]
    GW["<b>Gateway</b> :8080<br/>verifies · rate-limits · routes"]
    RD["Redis<br/>token buckets"]
    US["<b>Users</b> :8081"]
    QS["Questions :8082"]
    MT["Matching :8083"]
    CB["Collab :8084"]
    PG[("Postgres<br/>schema + role per service")]

    C -->|"sign in (never touches our services)"| FB
    FB -->|ID token| C
    C -->|"Authorization: Bearer …"| GW
    GW <-->|token bucket| RD
    GW -->|"X-User-Id · X-Request-Id"| US
    GW --> QS
    GW --> MT
    GW --> CB
    US -->|"users_svc role"| PG

    classDef bought fill:#fef3c7,stroke:#d97706,color:#78350f
    class FB bought
```

Three things are true about that diagram and each is load-bearing:

**Login does not traverse the Gateway.** The browser talks to Firebase directly,
so no service here ever sees a password (ADR-04). The consequence, stated in the
ADR rather than hidden: the Gateway's rate limiter does not protect the login
endpoint — Google's abuse controls do instead.

**Authentication happens once**, at the Gateway (§6). Downstream services never
re-verify; they read `X-User-Id` and trust it.

**Authorization cannot happen at the Gateway**, which has no domain data. It
lives with whoever owns the record. Nothing in phase 1 needs it yet; Matching and
Collab will.

---

# Part 2 — Verifying a token

📄 [`services/gateway/src/auth.ts`](../../services/gateway/src/auth.ts)

## Why `jose` and not the Firebase Admin SDK

→ [`auth.ts:18`](../../services/gateway/src/auth.ts#L18) — the JWKS URL ·
[`auth.ts:80`](../../services/gateway/src/auth.ts#L80) — where the key set is built

Verification needs only Google's **public** keys. Using the Admin SDK would mean
this service holding a service-account credential, and therefore holding the
ability to **mint and revoke** tokens. It does not need that ability, so it does
not get it: the blast radius of a compromised Gateway is "can read traffic", not
"can issue identities".

`createRemoteJWKSet` is the entire JWKS story — it fetches on first use, honours
the response's `Cache-Control`, and re-fetches when a token arrives with a `kid`
it has not seen, which is what turns Google's roughly-daily key rotation into a
non-event. It is built once at module scope; per-request would put a network
round trip to Google on the hot path of every request.

## What is actually checked

→ [`auth.ts:87-98`](../../services/gateway/src/auth.ts#L87)

```mermaid
sequenceDiagram
    participant C as Browser
    participant GW as Gateway
    participant G as Google JWKS
    participant US as Users

    C->>GW: GET /users/me + Bearer token
    GW->>GW: strip any inbound X-User-Id
    GW->>G: fetch signing keys (first time only, then cached)
    G-->>GW: JWKS
    GW->>GW: signature · exp · iss · aud
    GW->>GW: consume a rate-limit token
    GW->>US: GET /users/me + X-User-Id + X-Request-Id
    US-->>C: profile
```

**`aud` is the line that matters most** →
[`auth.ts:96`](../../services/gateway/src/auth.ts#L96).

Google signs every Firebase project's tokens with the *same* key set. A
validly-signed token issued for someone *else's* project therefore passes
signature, `exp`, and an `iss`-shaped check. Without an audience check the
Gateway would accept it and hand the request a stranger's UID. This is the
classic mistake in Firebase verification, and it is tested explicitly at
[`auth.test.ts:86`](../../services/gateway/src/auth.test.ts#L86).

**The UID comes from `sub`, not `user_id`** →
[`auth.ts:148`](../../services/gateway/src/auth.ts#L148). Firebase puts the same
value in both, but `sub` is the registered JWT claim. Keying off the standard one
is what keeps ADR-04's "migration is a re-registration flow, not a rewrite" true.

**Failure reasons are logged, not returned** →
[`auth.ts:160`](../../services/gateway/src/auth.ts#L160) maps jose's error codes,
and [`index.ts:117-118`](../../services/gateway/src/index.ts#L117) logs the reason
while replying with a flat 401. Telling a caller whether a token was expired,
forged, or issued for another project is free information about what to try next.

## The three cases, and the one people miss

→ [`auth.ts:187`](../../services/gateway/src/auth.ts#L187) (`bearerToken`) ·
[`index.ts:88-122`](../../services/gateway/src/index.ts#L88) (the hook)

| Request | Result |
|---|---|
| No `Authorization` header | **Anonymous.** Valid — the question bank and `/stats` are public (§2). Falls back to per-IP rate limiting. |
| A malformed or expired token | **401.** Presenting something broken is an attempt to authenticate, and a failed one. |
| A valid token | `X-User-Id` injected from `sub`. |

The middle row is the one that gets skipped. "No token" and "bad token" are
different states; collapsing them either locks anonymous users out of public
routes or lets broken tokens through. `bearerToken` returns `null` for the first
and the verifier throws for the second — that is the whole distinction.

## The header-forgery line

→ [`index.ts:99`](../../services/gateway/src/index.ts#L99)

```ts
delete req.headers[USER_ID_HEADER];
```

Without that one line the entire scheme is decorative. A client could send
`X-User-Id: <someone else>` and — since downstream services trust the header *by
design* — be that person. Deleting it unconditionally, before any other work,
means the only way the header exists downstream is because the Gateway put it
there.

That guarantee has **two** halves and both are required. The other is Cloud Run's
internal ingress (phase 6), which makes the four downstream services unreachable
from the public internet. Either half alone leaves the header forgeable.

The other side of the same idea lives in
[`headers.ts:26`](../../packages/shared/src/headers.ts#L26): downstream, absent
must be read as *anonymous*, never as "skip the check".

## The emulator, and the guard around it

→ [`auth.ts:117-139`](../../services/gateway/src/auth.ts#L117) (emulator path) ·
[`auth.ts:71-77`](../../services/gateway/src/auth.ts#L71) (the guard)

The Auth emulator issues **unsigned** tokens — `"alg": "none"`, empty signature.
There is nothing to verify, so `jwtVerify` would reject them outright and local
development would be impossible.

Emulator mode therefore skips the signature and checks **everything else**:
`iss` ([L128](../../services/gateway/src/auth.ts#L128)),
`aud` ([L131](../../services/gateway/src/auth.ts#L131)),
`exp` ([L134](../../services/gateway/src/auth.ts#L134)),
and the presence of `sub`. Keeping those checks on the local path is what stops a
bug in the claim logic hiding until deploy day.

Because that path accepts tokens anyone can forge in a text editor, DESIGN.md §7
requires it be **impossible in production**. Impossible is enforced by refusing
to boot:

```
FIREBASE_AUTH_EMULATOR_HOST is set with NODE_ENV=production.
The emulator issues unsigned tokens; accepting them in production means
accepting forged identities. Refusing to start.
```

A crash on boot is loud. A Gateway that started with signature checking disabled
would look completely healthy while accepting anything. Tested at
[`auth.test.ts:119`](../../services/gateway/src/auth.test.ts#L119).

**One consequence worth stating plainly:** in emulator mode, tampering with the
*signature* is undetectable, because there is no signature. Only payload and
claim tampering are caught locally. The signature path runs only against real
Firebase.

---

# Part 3 — The rate limiter

📄 [`services/gateway/src/rate-limit.ts`](../../services/gateway/src/rate-limit.ts)

This is why the Gateway is built rather than bought (ADR-08). Kong DB-less would
do routing, JWT verification, CORS and rate limiting in fifteen lines of config —
and would solve the one race in this system that a product would otherwise solve
*on your behalf*.

## The bug it prevents

Two Gateway instances, one user's bucket, one token left in it:

```mermaid
sequenceDiagram
    participant A as Gateway instance A
    participant R as Redis
    participant B as Gateway instance B

    A->>R: read tokens
    R-->>A: 1
    B->>R: read tokens
    R-->>B: 1
    Note over A,B: both believe they hold the last token
    A->>R: write tokens = 0
    B->>R: write tokens = 0
    Note over R: A's decrement is lost —<br/>two requests allowed, one token spent
```

Note what that does **not** require: no threads, no shared memory. Two ordinary
processes on two different machines are enough.

Which is also why an in-process mutex is not a fix — it would guard one
instance's own memory, at an address the other instance cannot reach and has
never heard of. **Atomicity has to live where the single copy of the state
lives**, and that is Redis.

The regression test for exactly this is
[`rate-limit.test.ts:90`](../../services/gateway/src/rate-limit.test.ts#L90):
twenty concurrent consumes against a ten-token bucket, asserting that exactly ten
pass. Without atomicity, more would.

## Why a Lua script and not `INCR`

→ [`rate-limit.ts:31-85`](../../services/gateway/src/rate-limit.ts#L31) — the
script, with the reasoning inline

A fixed-window counter needs only `INCR`, which is already atomic — that is how
Kong's plugin does it. A **token bucket** reads two values (tokens remaining,
last refill time), computes a refill from elapsed time, and writes both back.
That is multi-step, so atomicity has to be wrapped around it. Redis runs a script
start-to-finish with nothing interleaved.

The bucket is worth the extra work because it permits bursts, which a fixed
window either forbids or lets through at the boundary.

## Four details that are easy to get wrong

**The clock comes from Redis, not the caller** →
[`rate-limit.ts:45`](../../services/gateway/src/rate-limit.ts#L45). Two Gateway
instances have two clocks that disagree by an unknown amount; taking the
timestamp from the single place the state lives removes skew from the refill
maths entirely.

**A backwards clock cannot remove tokens** →
[`rate-limit.ts:61`](../../services/gateway/src/rate-limit.ts#L61). The
`math.max(0, …)` is what stops a negative elapsed silently draining the bucket.

**Buckets expire** →
[`rate-limit.ts:75`](../../services/gateway/src/rate-limit.ts#L75). Per-IP
buckets are an unbounded key space, and Upstash caps both storage and commands
per month (§7).

**The limiter fails open** →
[`index.ts:151-165`](../../services/gateway/src/index.ts#L151). A Redis outage
logs an error and allows the request. Failing closed would turn a cache outage
into a total outage. This is a deliberate availability-over-enforcement choice,
defensible only because the thing being protected is request volume rather than
money or data — `--max-instances` still caps what the traffic can cost.

**The buckets themselves** →
[`rate-limit.ts:109`](../../services/gateway/src/rate-limit.ts#L109). Per-IP 60
tokens refilling at 1/s; per-user 120 at 2/s. Per-user is larger because an IP
can be an entire university NAT while a user is one person. Which bucket a
request draws on is decided at
[`index.ts:146`](../../services/gateway/src/index.ts#L146), *after* auth — because
the answer depends on whether the request turned out to be authenticated.

**Two things the per-IP bucket quietly depends on**, both added later once it
became clear the limiter did not actually work without them:

- **`trustProxy: 1`** in
  [`createService`](../../packages/shared/src/service.ts). Fastify's `req.ip`
  is the socket's peer address, which behind Cloud Run is Google's front end
  rather than the caller — so *every* anonymous request would share one bucket
  and one client could lock out everyone. It reads `X-Forwarded-For` instead.
  `1` and not `true`: whatever sits in front appends to any header the caller
  supplied, so only the rightmost entry is trustworthy, and trusting the whole
  chain would let a client mint a fresh bucket per forged header. Both
  behaviours are pinned by tests in
  [`service.test.ts`](../../packages/shared/src/service.test.ts).
- **`/health*` is exempt** ([`index.ts:144`](../../services/gateway/src/index.ts#L144)).
  Registering the health routes before this hook exists does not exempt them —
  Fastify binds hooks to every route at boot — so an uptime probe was drawing
  from the same anonymous bucket as real traffic, and at more than one probe a
  second it exhausts capacity 60 on its own.

**Script registration** →
[`rate-limit.ts:126`](../../services/gateway/src/rate-limit.ts#L126).
`defineCommand` registers the script once and calls it by SHA thereafter, falling
back to a full `EVAL` if Redis has forgotten it — which happens after a restart,
and on Upstash whenever a request lands on a node that has not seen it. Doing
this by hand is the usual source of a rate limiter that works until the first
failover.

---

# Part 4 — Users, and why the upsert is written that way

📄 [`services/users/src/repository.ts`](../../services/users/src/repository.ts) ·
[`services/users/src/index.ts`](../../services/users/src/index.ts)

→ [`repository.ts:36-53`](../../services/users/src/repository.ts#L36)

```sql
INSERT INTO users.profiles (firebase_uid)
VALUES ($1)
ON CONFLICT (firebase_uid) DO NOTHING
RETURNING id, firebase_uid, display_name, preferred_topics, created_at
```

**`RETURNING` is load-bearing.** `ON CONFLICT … DO NOTHING` returns **no row**
when the UID already existed. An empty result is therefore the signal that this
was a genuine first sight of the UID — the `created` flag at
[`repository.ts:21`](../../services/users/src/repository.ts#L21) — and since
there is no signup endpoint (§5), it is the **only** place `user.signed_up` can
be emitted from in phase 7. It is a log line for now at
[`index.ts:45`](../../services/users/src/index.ts#L45).

Get it wrong and the event fires on every request, and the sign-up count in
`/stats` becomes a request count. Tested at
[`repository.test.ts:53`](../../services/users/src/repository.test.ts#L53) and,
under concurrency, at
[`repository.test.ts:67`](../../services/users/src/repository.test.ts#L67) — a
double-mounted React effect fires this call twice and must still produce one row.

**Why not `DO UPDATE SET firebase_uid = EXCLUDED.firebase_uid`?** It returns a
row every time, which destroys the signal — and it takes a row lock on every
sign-in for no reason.

**Why `UNIQUE` on the column matters** →
[`003_users_profiles.sql:19`](../../packages/db/migrations/003_users_profiles.sql#L19).
It is what `ON CONFLICT` keys on. Without it the upsert has nothing to conflict
against and every sign-in inserts a duplicate.

**Why the ordering is pinned to this call** →
[`index.ts:32`](../../services/users/src/index.ts#L32). Matching validates a UID
against Users via
[`GET /users/:uid/exists`](../../services/users/src/index.ts#L74), so a user going
straight from sign-in to the queue would be rejected for having no row yet. The
client calls `GET /users/me` immediately after sign-in, and that is what
guarantees the row exists before anything else asks about it.

**The hand-written row mapping** →
[`repository.ts:96`](../../services/users/src/repository.ts#L96) is the cost
ADR-10 accepts by deferring Drizzle. It is one function, so schema drift shows up
in one place rather than at five call sites.

---

# Part 5 — The schema boundary

📄 [`packages/db/migrations/002_service_roles.sql`](../../packages/db/migrations/002_service_roles.sql)

ADR-09: one Postgres instance, one schema per service, **one role per service**,
each granted privileges only on its own schema — so a cross-service read is
rejected by the database, not discouraged by convention.

```mermaid
flowchart LR
    subgraph PG["One Postgres instance"]
      SU["users<br/>profiles"]
      SQ["questions"]
      SM["matching"]
      SC["collab"]
      SS["stats"]
    end

    RU(["users_svc"]) -->|USAGE| SU
    RU -.->|"permission denied"| SM
    RQ(["questions_svc"]) -->|USAGE| SQ
    RM(["matching_svc"]) -->|USAGE| SM
```

**`USAGE` on the schema is the gate** →
[`002:44`](../../packages/db/migrations/002_service_roles.sql#L44). Without it
every reference to a table inside that schema fails with `permission denied for
schema`, regardless of any table-level grant. That single missing grant is the
whole boundary. Tested at
[`repository.test.ts:109`](../../services/users/src/repository.test.ts#L109).

**`ALTER DEFAULT PRIVILEGES` matters as much as the grants** →
[`002:57`](../../packages/db/migrations/002_service_roles.sql#L57). It covers
tables created by *later* migrations. Without it every future migration would
have to remember to re-grant, and the one that forgets produces a service that
starts fine and fails on its first query.

**Nobody creates tables in `public`** →
[`002:30`](../../packages/db/migrations/002_service_roles.sql#L30). Postgres 15+
revokes this by default, but stating it means the guarantee does not depend on
which server version a future environment happens to run.

**`search_path` as defence in depth** →
[`002:68`](../../packages/db/migrations/002_service_roles.sql#L68). Queries are
written fully qualified anyway; this only decides what a *mistake* does — an
unqualified table name resolves inside the service's own schema rather than
falling through to `public`.

**The boundary is also in compose** →
[`docker-compose.yml:14`](../../docker-compose.yml#L14) and
[`:152`](../../docker-compose.yml#L152). Each service gets its own
`DATABASE_URL` with its own role. A single shared `DATABASE_URL` in the anchor
would have been the one line silently undoing everything in this section, which
is why the anchor comment says so explicitly.

**Why this is phase 1 and not later.** DESIGN.md §10 answers it: *"a boundary
that isn't enforced from the first table will be violated by the third, and
retrofitting grants means untangling queries that already cross."*

**No foreign key crosses a schema.** Other services store `firebase_uid` as a
plain column and validate it by API call. That is the concrete thing given up,
and it is deliberate — a cross-schema FK would re-couple the services through the
database.

## The migration runner

📄 [`packages/db/migrate.mjs`](../../packages/db/migrate.mjs) — 75 lines

Numbered `.sql` files applied in filename order, each in a transaction
([`migrate.mjs:61`](../../packages/db/migrate.mjs#L61)), each recorded in
`public.schema_migrations`
([`migrate.mjs:37`](../../packages/db/migrate.mjs#L37)) so it is never applied
twice.

It is this short because **Postgres has transactional DDL** — a migration that
fails halfway leaves nothing behind. In MySQL each statement commits on its own
and a half-applied file has to be unwound by hand, which is where migration
libraries earn their weight.

It runs as the owner role, never a service role: creating schemas and handing out
grants is exactly what the service roles are forbidden from doing.

---

# Part 6 — Demonstrating the four claims

```bash
docker compose up -d --build
```

The `migrate` service ([`docker-compose.yml:90`](../../docker-compose.yml#L90))
runs to completion first, and every other service waits on
`service_completed_successfully`
([`:31`](../../docker-compose.yml#L31)) — so nothing races a half-migrated
database.

## Get a token from the emulator

```bash
curl -s -X POST "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"password123","returnSecureToken":true}'
```

Save the `idToken` from the response as `$TOKEN`. The emulator UI at
`http://localhost:4000` lists the users you create.

## Claim 1 — a valid token reaches a protected route

```bash
curl -i -H "Authorization: Bearer $TOKEN" http://localhost:8080/users/me
```
**201** the first time with a profile body; **200** and the same `id` thereafter.

## Claim 2 — broken tokens are refused

```bash
curl -i http://localhost:8080/users/me                          # 401 — no token
curl -i -H "X-User-Id: victim" http://localhost:8080/users/me   # 401 — header stripped
```

The second is the one worth pausing on: it is the difference between an
authentication system and a suggestion.

For expired and wrong-project tokens, the unit tests
([`auth.test.ts:73`](../../services/gateway/src/auth.test.ts#L73)) are faster than
constructing them by hand.

## Claim 3 — the row appears once

```bash
for i in $(seq 1 5); do
  curl -s -o /dev/null -w "%{http_code} " -H "Authorization: Bearer $TOKEN" \
    http://localhost:8080/users/me
done
```
`201 200 200 200 200`. One creation, four reads.

## Claim 4 — Postgres rejects a cross-schema read

```bash
docker compose exec postgres psql -U users_svc -d deepcs \
  -c "SELECT count(*) FROM users.profiles;"      # works

docker compose exec postgres psql -U users_svc -d deepcs \
  -c "SELECT 1 FROM matching.sessions;"          # ERROR: permission denied for schema matching
```

## Bonus — watch the bucket empty

```bash
for i in $(seq 1 70); do
  curl -s -o /dev/null -w "%{http_code} " http://localhost:8080/questions/
done
```
Sixty responses, then `429`s. `x-ratelimit-remaining` and `retry-after` are on
every reply. (The 404s are correct — proxying works, and Questions has no routes
until phase 2.)

## Running the tests yourself

```bash
export DATABASE_URL=postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs
export USERS_DATABASE_URL=postgresql://users_svc:users_svc@127.0.0.1:5432/deepcs
export REDIS_URL=redis://127.0.0.1:6379
pnpm test
```

They run against real Postgres and Redis, never mocks (§8) — the properties under
test are a Lua script's atomicity and a role being refused a schema, and a mock
would only prove it agrees with itself.

---

# Part 7 — What phase 1 does *not* do

Stated so a green demo does not imply more than it covers.

- **Internal ingress and invoker IAM** are listed in §10's phase 1 row but are
  Cloud Run settings, and nothing is deployed until phase 6. They land there.
  Until then, the "downstream services are unreachable directly" half of the
  header-forgery guarantee is **not** in force — locally, ports 8081–8084 are
  open on your machine.
- **`user.signed_up` is a log line**, not an event
  ([`index.ts:45`](../../services/users/src/index.ts#L45)). Phase 7 puts it behind
  the `EventLog` interface. It is logged now so the once-per-user property is
  observable before there is a consumer to prove it.
- **No tighter rate-limit bucket on `/match/*`** — §6 asks for one. Per-user
  limiting itself exists (`BUCKETS.user`); what is missing is a *stricter*
  allowance on the matching routes specifically. Phases 3 and 4 both shipped
  without it, so this is now a known gap rather than a scheduled one — the
  routes are cheap enough that the general per-user bucket has been sufficient.
- **Signature verification is not exercised locally.** The emulator issues
  unsigned tokens; that path runs only against real Firebase.
- **`GET /users/me` does not accept a profile update yet.** `display_name` and
  `preferred_topics` are columns with no write path until the frontend needs one.
- **`/metrics` is not implemented.** §6 wants Prometheus-format metrics on every
  service; that lands with observability in phase 6.
