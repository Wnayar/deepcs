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

## 1. The two rows

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

`preferred_topics` is empty by default and has no write path. `display_name` is
nullable for the same original reason, that the row is created from a token
alone, and now has exactly one writer: the sign-up form, on the insert that
creates the row (§4). Null therefore means an account made before names existed,
which the session room renders as no name rather than as a placeholder.

### What the reader has marked

[`011_question_progress.sql`](../../packages/db/migrations/011_question_progress.sql)

```sql
CREATE TABLE IF NOT EXISTS users.question_progress (
  uid         text NOT NULL REFERENCES users.profiles (firebase_uid) ON DELETE CASCADE,
  question_id uuid NOT NULL,
  done        boolean NOT NULL DEFAULT false,
  starred     boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uid, question_id)
);
```

**It lives here rather than in Questions because it is state about a person.**
Questions has no idea users exist, and giving it a table keyed by uid would make
it a second owner of identity. The cost is that the roadmap screen fetches two
things and joins them itself (§4).

**The composite primary key is what makes the write an upsert**: one row per
person per step, so ticking a box twice lands on the same row instead of stacking
up a history nobody asked for. Every read is "everything for one person", which
that key already serves as its leading column, so no second index exists.

**This foreign key is allowed where the others are not**, because it stays inside
the `users` schema. Progress cannot exist for somebody who never signed in, and
deleting a profile takes their marks with it. `question_id` has no such key — it
points at `questions.bank`, which is across a boundary, so it is a plain `uuid`
exactly like `matching.sessions.question_id`.

**Two flags rather than one status column**, because starring something you have
*not* done yet is most of the point of starring it.

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

## 4. The routes

```
GET /users/me?displayName=Alex       -> 201 + profile on first sight, 200 + profile after
GET /users/:uid/exists               -> { "exists": true }
GET /internal/users/:uid/profile     -> { "displayName": "Alex" }   (not proxied)
GET /users/me/progress               -> { "progress": [{ questionId, done, starred }] }
PUT /users/me/progress/:questionId   -> the stored row  { done, starred }
```

`GET /users/me` is **not** public. `X-User-Id` absent means anonymous, and
anonymous here is a 401 — but note that the *decision* is made by this service,
which owns the resource, rather than by the header reader. `getUserId` returns
null and says nothing about what a route should do with it.

### The display name is set once, by the statement rather than by a rule

`displayName` on `GET /users/me` is used **only by the insert**. `ON CONFLICT DO
NOTHING` means a later call carrying a different name does not write, so "set at
sign-up, not editable" is a property of the upsert rather than something a
future route has to remember to refuse. Giving names a write path later means
adding one on purpose, which is the right amount of friction for a field another
person sees.

An unparseable name is ignored rather than refused. This route's job is making
sure the row exists before anything else asks about it (§3), and failing a
sign-in over a name would be a worse outcome than a row with no name in it.

`GET /internal/users/:uid/profile` is how Matching puts a name in the session
room. **The `/internal` prefix is the access control**: the Gateway proxies
nothing under it, so the route is unreachable from a browser and cannot be used
to turn a uid into a person. That is a door that is not connected, rather than a
check that has to be kept correct. It answers with the name and nothing else,
and Matching passes on the name and never the uid it looked up
([`04-matching.md`](04-matching.md) §9).

`GET /users/:uid/exists` is Matching's validation call, and it is deliberately
thin: it answers one question and reveals nothing else, because Matching has no
business knowing anything else about a user. The uid is bounded at 128 characters
as a sanity check rather than a format assertion — Firebase UIDs are 28 today,
and pinning the exact length would break this service the day Google changes it,
for no security benefit. The UID was already proven by a signature check before
it reached the header.

### The two progress routes are where the schema boundary shows

`GET /users/me/progress` returns everything this reader has ticked or starred,
in one query. The whole set rather than a page of it, for the same reason the
roadmap itself is one call: the map draws ten topics and thirty steps at
once and cannot render a partial graph, so paginating costs more requests than
it saves bytes.

**The roadmap and the progress are two requests, merged in the browser, and they
have to be.** The steps live in `questions.bank` and the marks live in
`users.question_progress`, and a query spanning the two schemas is refused by the
database rather than merely discouraged ([ADR-09](../adr/09-one-database-one-schema-per-service.md)).
This is the clearest place in the system where that boundary has a visible cost,
and the cost is small: two requests that do not depend on each other, and a
`Map` lookup per step.

`PUT` **replaces state rather than toggling it**, and both flags are always
sent. That is what lets the browser fire a write on every click without waiting
for the answer: the same request arriving twice, or two arriving out of order
after a retry, land on the same row. A toggle endpoint would flip twice on a
retry and leave the box showing the opposite of the truth, with nothing able to
detect it. Sending only the flag that moved has the same problem in a quieter
form — the other one's absence would have to mean "leave it alone", and two
clicks racing could then resurrect a stale value.

The question id is **not** validated against the bank, because Users cannot see
that table. A row for a question that does not exist is harmless: the roadmap
decides which steps are drawn, and a mark for one it does not list is never read
back.

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
