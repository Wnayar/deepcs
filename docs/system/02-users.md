# Users

The smallest service here, and the one that will change least. It owns exactly
one table — the profile row keyed by `firebase_uid` — and answers two questions:
*who am I* for the browser, and *does this uid exist* for Matching.

**It contains no auth code.** Sign-up, sign-in, password storage, token issue and
refresh all happen client-side against Firebase, and no service in this system
ever sees a password
([`../adr/04-managed-auth.md`](../adr/04-managed-auth.md)). What is left after
buying identity is this: the app-owned data Firebase knows nothing about.

Code: [`services/users/src/`](../../services/users/src/) — `repository.ts`,
`index.ts`.

---

## 1. The row

[`003_users_profiles.sql`](../../packages/db/migrations/003_users_profiles.sql)

```sql
CREATE TABLE IF NOT EXISTS users.profiles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid     text NOT NULL UNIQUE,
  display_name     text,
  preferred_topics text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

**`firebase_uid` is the join key for the entire system**, and it is deliberately
opaque. Every other service stores it as a plain `text` column and validates it
by calling this one; nothing anywhere keys off something Firebase-shaped. That is
what makes a provider migration a re-registration flow rather than a rewrite, and
it is the concrete form the vendor lock-in in the managed-auth decision takes.

**`UNIQUE` is load-bearing, not decorative.** It is what `ON CONFLICT` keys on
below, and therefore what makes "first sight of this UID" detectable at all.
Without it the upsert has nothing to conflict against and every sign-in inserts a
duplicate row.

`display_name` and `preferred_topics` are nullable and empty by default, because
the row is created from a token alone, before the user has told us anything.

---

## 2. The lazy upsert, and why `RETURNING` is the point

[`repository.ts`](../../services/users/src/repository.ts)

```sql
INSERT INTO users.profiles (firebase_uid)
VALUES ($1)
ON CONFLICT (firebase_uid) DO NOTHING
RETURNING id, firebase_uid, display_name, preferred_topics, created_at
```

`ON CONFLICT … DO NOTHING` returns **no row** when the UID already existed. An
empty result is therefore proof that this call was a genuine first sight of that
UID, and it is the `created` flag the route reads.

**The failure it prevents:** there is no signup endpoint anywhere in this system,
so if `created` were wrong, `user.signed_up` would fire on every call to
`/users/me` — which is every sign-in — and the sign-up count in `/stats` would
silently be a request counter.

*Why not `DO UPDATE SET firebase_uid = EXCLUDED.firebase_uid`?* It returns a row
every time, which destroys the signal, and it takes a row lock on every sign-in
for no reason.

The existing-row path is a second query rather than one clever statement. It is
the common path and it is a primary-key lookup on a unique index, so the cost is
one round trip — and the alternative (a CTE, or `DO UPDATE`) buys that round trip
back by destroying `created`.

**The impossible case is surfaced, not swallowed.** If neither statement returns
a row, the profile was deleted between them, which only account deletion does.
Throwing keeps "deleted mid-request" from looking like "never existed".

Tested in
[`repository.test.ts`](../../services/users/src/repository.test.ts), including
under concurrency: a double-mounted React effect fires this call twice and must
still produce one row.

---

## 3. The ordering this route guarantees

Matching validates a UID against this service before it touches the queue, so a
user who went straight from sign-in to the queue would be rejected for having no
row yet.

Nothing enforces that ordering except *where the upsert is*. The client calls
`GET /users/me` immediately after sign-in, and that call is what creates the row,
so by the time anything else can ask about the UID it exists. Moving the upsert
anywhere else reintroduces the race.

*Why lazy upsert rather than a Firebase `onCreate` trigger?* One fewer deployed
function, and it cannot drift out of sync with Firebase's user list.

---

## 4. The two routes

```
GET /users/me                 -> 201 + profile on first sight, 200 + profile after
GET /users/:uid/exists        -> { "exists": true }
```

`GET /users/me` is **not** public. `X-User-Id` absent means anonymous, and
anonymous here is a 401 — but note that the *decision* is made by this service,
which owns the resource, rather than by the header reader. `getUserId` returns
null and says nothing about what a route should do with it.

`GET /users/:uid/exists` is Matching's validation call, and it is deliberately
thin: it answers one question and reveals nothing else, because Matching has no
business knowing anything else about a user. The uid is bounded at 128 characters
as a sanity check rather than a format assertion — Firebase UIDs are 28 today,
and pinning the exact length would break this service the day Google changes it,
for no security benefit. The UID was already proven by a signature check before
it reached the header.

---

## 5. Readiness, and the one event

Every route here reads or writes Postgres, so an unreachable database means this
instance can only produce 500s, and `/health/ready` says no rather than accepting
traffic it cannot serve.

Redis is a different matter. It is present only to append to the event log, so
losing it must **not** take the service out of rotation: `emitEvent` swallows the
failure, warns, and the sign-in still succeeds
([`06-events-and-stats.md`](06-events-and-stats.md) §2).

`user.signed_up` is emitted here and nowhere else, on the insert that created the
row, for the reason in §2.

---

## 6. Account deletion

The one flow spanning Firebase and this service: delete from Firebase first, then
here. If the second half fails the row is unreachable — nobody can authenticate
as that UID any more — and a retry is safe.

There is no endpoint for it. `display_name` and `preferred_topics` are columns
with no write path either, and both are here because the schema was written for
what the app owns rather than for what it currently sends.

---

## 7. Where the schema boundary is tested

The assertion that a service **cannot** read another's schema lives in this
service's suite,
[`repository.test.ts`](../../services/users/src/repository.test.ts), because
`users_svc` is the role it is easiest to demonstrate with:

```sql
SELECT count(*) FROM users.profiles;   -- works
SELECT 1 FROM matching.sessions;       -- ERROR: permission denied for schema matching
```

That is a test, not a convention: it asserts the *database* refuses the query.
The grants behind it are in [`08-data.md`](08-data.md) §2.
