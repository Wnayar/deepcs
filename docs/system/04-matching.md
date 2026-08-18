# Matching

Owns the queue, the pair claim, the session row, the consent state behind the
reveal rule, and the end of a session. It is the service with a concurrency
problem of its own: two users joining at the same instant race for the same
partner.

It is also the only service that calls two others. It validates a uid against
Users and finds a question in Questions **by HTTP**, never by SQL — it cannot
join to those tables, because the database refuses it
([`../adr/09-one-database-one-schema-per-service.md`](../adr/09-one-database-one-schema-per-service.md)).

Code: [`services/matching/src/`](../../services/matching/src/) — `queue.ts`,
`repository.ts`, `clients.ts`, `index.ts`.

---

## 1. Matching is reactive

Pairing happens at the moment a user joins, not on a polling timer. On join:
check for an existing session, ask Users whether the caller exists, ask Questions
for a question matching the topic and difficulty, then run the claim.

*Why not a loop scanning the queue every second?* It is easier to reason about
but needs an always-on process, and it adds up to a second of latency for no
benefit. The cost of being reactive is that the claim has to be atomic, which is
the next section
([`../adr/03-reactive-matching-with-an-atomic-claim.md`](../adr/03-reactive-matching-with-an-atomic-claim.md)).

**One sorted set per topic and difficulty** — `match:queue:os:hard`,
`match:queue:networking:easy`. "Filter by compatible topic and difficulty"
happens for free this way: a user can only be matched with someone in the exact
same queue, because there is no other queue to look in.

"Topic" here means a Questions tag, not a separate field. Matching's `topic`
request field is passed straight through as a tag filter, keeping one vocabulary
across both services instead of inventing a second
([`03-questions.md`](03-questions.md) §1).

---

## 2. The claim

[`queue.ts`](../../services/matching/src/queue.ts)

```lua
local uid = ARGV[1]
local ttl = tonumber(ARGV[2])
local t   = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000

-- Everyone who stopped asking, dropped first. See §5 below for why.
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', string.format('%.6f', now - ttl))

-- A retried join while already queued does nothing. After the prune, so
-- somebody who has just aged out rejoins instead of being told to keep waiting.
if redis.call('ZSCORE', KEYS[1], uid) then return false end

-- Someone waiting: claim the oldest, and take their join time with them.
local waiting = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if #waiting > 0 then
  local partner, joined = waiting[1], tonumber(waiting[2])
  redis.call('ZREM', KEYS[1], partner)
  return { partner, tostring(now - joined) }
end

-- Nobody waiting: the caller joins, scored by Redis' own clock.
redis.call('ZADD', KEYS[1], now, uid)
return false
```

The same prune is the first thing `isWaiting`'s script does too, so the two can
never disagree about who is still in the line.

**The failure it prevents:** two users join the same empty queue at the same
instant. Both check "is anyone waiting", both see nobody, both add themselves,
and nobody is matched. Or worse, two different people both see the *same* third
waiting user and both claim them.

This is the same shape as the Gateway's rate-limit bug — read, decide, write,
with a gap in the middle where another caller can act — and it has the same fix:
make the whole thing one atomic operation where the state lives. Redis finishes
one script completely before starting the next. The regression test is twenty
users joining at once, asserting exactly ten pairs form with nobody claimed
twice.

*Why a script and not `MULTI`/`EXEC`?* A transaction queues commands blindly and
runs them without looking at intermediate results, so it cannot make "claim if
someone is waiting, otherwise add myself" a single decision — that decision
depends on what `ZRANGE` returns *during* the operation. A Lua script can branch
on it.

**The score comes from Redis' clock, not the caller's**, so join order stays
correct even when two Matching instances disagree about the time.

**`WITHSCORES` is there for one number.** The score is when the partner joined,
and it is gone the instant `ZREM` removes them: no row anywhere records when
somebody started waiting, so recomputing it afterwards is not possible even in
principle. The script therefore returns it alongside the partner, and
`match.created` carries it into `medianWaitSeconds`. The general shape is worth
keeping — **when a value exists only inside an atomic operation, it leaves with
the result of that operation or it does not leave.** It is returned as a *string*
because Redis converts Lua numbers to integers on the way out and a sub-second
wait would arrive as 0.

---

## 3. Failing cleanly, and joining twice

**Every external call happens before anything is mutated.** `checkUserExists` and
`findQuestion` both run, and both have to succeed, before the join touches Redis
at all. If either fails the route returns 503 or 404 immediately and nothing has
changed in Redis or Postgres. There is no state to clean up because none was
created.

The way to fail cleanly is not to add rollback logic after a partial failure; it
is to do every check that can fail before doing anything that cannot be undone.

**Joining twice is safe at every stage.** A `POST /match/join` that times out may
have succeeded on the server with the response lost, so the client retries. Every
join checks for an existing session *first* and returns it if there is one, and
the Lua script itself is a no-op while already queued. That is what makes the
crash recovery in §6 work at all: a client that has not heard back just calls
`/match/join` again, and it can never double-book.

The typed clients parse every response with zod, which is what makes them contract
tests: if Users renamed `exists`, `checkUserExists` would throw immediately rather
than quietly returning `undefined` and surfacing a bug three steps later. Both
calls carry a 5-second timeout, because an unbounded `fetch` would let a hung
sibling hold this request — and its concurrency slot — open indefinitely.

---

## 4. The routes

```
POST /match/join                          { topic, difficulty } -> matched | waiting
GET  /match/status?topic=&difficulty=      matched | waiting | none
GET  /match/session                        the session I am in right now, if any
GET  /match/sessions/:id/participant       am I in this one?
GET  /match/sessions/:id/partner           the other person's display name
POST /match/sessions/:id/reveal            agree to reveal
GET  /match/sessions/:id/reveal            has my partner agreed?
POST /match/sessions/:id/end               finish it
```

`loadForParticipant` is the shared preamble for the last three: valid uuid,
authenticated caller, real session, caller is one of its two people. A
non-participant gets **403 rather than 404** — they are authenticated and the
session exists, they simply are not in it.

### The participant route is where the access control is

```
GET /match/sessions/:id/participant     with header  X-User-Id: bob
-> { participant: true, questionId }    bob is in this session
-> { participant: false }               session exists, bob is not in it, or it ended
-> 401                                  no caller identity at all
-> 404                                  no such session
```

**The subject is the caller's own header, not a uid in the query string.** This
route sits under the `/match` prefix, which the Gateway proxies, so a browser can
reach it. An earlier version took `?uid=` and answered about anybody, which would
have handed anyone holding a session id the *other* participant's identity. Only
ever answering about yourself makes that impossible to express, rather than
something a future edit has to remember to keep checking.

Collab calls it before allowing any socket, passing the uid the Gateway verified
for that socket ([`05-collab.md`](05-collab.md) §2).

---

## 5. The browser asks

**Being matched is caused by somebody else's request**, and HTTP gives a server
no way to speak first. A waiting client therefore has to ask, and
`GET /match/status?topic=&difficulty=` is the question. The shell asks it every
three seconds, and the answer comes from the Postgres session row rather than
from Redis, so it is the same answer whichever instance happens to serve the
call and whichever instance made the match.

Asking is the expensive shape, so all three of its costs are bounded rather than
accepted:

- **Only somebody actually waiting asks.** The queued flag lives in
  `localStorage` ([`frontend/src/queue.ts`](../../frontend/src/queue.ts)), not in
  React state, so it survives navigation and a refresh, and the shell reads it
  before starting. An earlier version ran whenever anyone was signed in without
  a session: at four seconds that is 21,600 requests for a tab left open
  overnight, and the request count is the small half. An idle database suspends
  and an idle service has nothing to do; a request every four seconds stops
  both, so one idle reader kept a database and two services awake for nobody.
- **It gives up after a minute.** `MAX_WAIT_MS` is 60 seconds, after which
  `readQueued` returns null, the shell stops, and the match screen says nobody
  came. An abandoned tab therefore costs 20 requests in total, not 20 a minute
  forever.
- **Three seconds fits the budget it spends from.** The Gateway allows 120
  requests a minute per user ([`01-gateway.md`](01-gateway.md)), so one waiting
  user spends a sixth of their own allowance and nothing of anybody else's.

**What this costs, stated plainly:** news of a match is up to three seconds late,
and each of those 20 requests per waiting minute is a Gateway hop and a Postgres
read that usually answers "no". That is the trade — it is bounded, but it is not
free, and holding the answer open instead would make it neither.

### The queue entry expires, because nothing tells the server you left

There is no leave endpoint, and a closed tab has no way to announce itself. An
entry left behind is still claimable, so the next person to join is paired with
somebody who is not there and gets a session nobody ever opens.

So an entry is only claimable for `WAIT_TTL_SECONDS`, 60 seconds, matching the
window the browser gives up on. Both Lua scripts in
[`queue.ts`](../../services/matching/src/queue.ts) begin with the same
`ZREMRANGEBYSCORE` against Redis' own clock, so claiming and asking cannot
disagree about who is still in the line. This is what the score being a join
*time* rather than a counter buys, and it is checked by a test that ages an
entry out with a one-second ttl and then fails to claim it.

The prune runs before the "am I already queued" guard, so somebody whose entry
has just expired rejoins with a fresh score instead of being told they are still
in a queue they have fallen out of.

### The session channel is still a channel

Removing the per-user announcement did not remove Redis pub/sub from this
service. `match:session:{id}` carries a session's lifecycle and is what Collab
subscribes to per room ([`05-collab.md`](05-collab.md)), which is how pressing
"end" on one instance tears the room down on every instance holding it. That is
server-to-server, where publishing works: both ends are processes that are
already connected to Redis. Reaching a browser was the part that needed
something else.

---

## 6. Crash recovery, which the same poll covers

The claim lives in Redis and the session row in Postgres, and **no transaction
spans them**. If Matching crashes between the two, a claimed pair is out of the
queue with no session, and would wait forever.

`none` from `/match/status` is what catches it, and it means the same thing for
both ways it can happen — a crash lost the claim, or the entry aged out. Either
way the recovery is to call `/match/join` again, which the shell does inline on
the next tick rather than on a timer of its own. It cannot run past the wait
window, because `readQueued` has already returned null by then.

`GET /match/session` exists because `/match/status` cannot answer it: status
requires a topic and difficulty, and an app that has just loaded has neither.
Without it the UI has no way to know you are mid-session, so navigating away from
the editor looks like leaving and pressing "find a partner" silently drops you
back into the room you never left.

---

## 7. Consent, and the reveal rule's other half

[`008_session_consent.sql`](../../packages/db/migrations/008_session_consent.sql)

```sql
ALTER TABLE matching.sessions
  ADD COLUMN IF NOT EXISTS reveal_consents text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ended_at        timestamptz;
```

An array rather than a `session_consents` table: a session has exactly two
participants and always will, so the join table would buy normalisation nobody
reads. `ended_at` is nullable rather than a `status` column — "not ended" is the
absence of an end time, not a second state to keep in sync, and it doubles as the
timestamp the summary needs.

**Consent is recorded in SQL, not read-modify-write in the route:**

```sql
SET reveal_consents = CASE
      WHEN $2 = ANY (reveal_consents) THEN reveal_consents
      ELSE array_append(reveal_consents, $2)
    END
```

Both people can press Reveal in the same instant, and two concurrent
read-then-writes would drop one of them. The failure would not be an error, it
would be an answer that silently never unlocks. Same shape as the rate limiter
and the pair claim: decide and write in one statement, where the state lives. The
`CASE` also makes pressing twice a no-op, which matters more than it looks — a
length check on the array would otherwise read one enthusiastic user as mutual
consent.

`toRevealResponse` checks that **both** participant uids appear, then and only
then calls Questions over the internal network. Until that moment the response
has no `referenceMd` field at all: not an empty string, not a null, absent. A
test asserts the absence rather than a flag, because a UI trusting
`revealed: false` while the text sits in the payload has leaked it to anyone with
developer tools open.

The response is `{ you, partner, revealed }` rather than the list of uids that
consented. The list was the obvious shape and wrong twice over: it names the
other participant, which nothing else in a session does, and it cannot answer
what the UI is actually asking — "have *I* agreed, and have *they*?" — without
the browser knowing its own uid to look for.

---

## 8. Ending a session is enforced somewhere it is not written

`POST /match/sessions/:id/end` sets `ended_at`, and the participant route then
reports `participant: false`. That route is the single check Collab runs before
allowing any socket, so an ended session stops accepting **new** connections with
no change to Collab at all.

**Which was not enough, and manual testing is what found it.** A socket already
open never re-checks anything. It kept accepting edits and the 30-second snapshot
kept saving them, so the "final" document went on changing after the session was
over and the summary would have read whatever it drifted to. The person who did
not press the button got no indication at all; their editor simply carried on
working.

So Matching also publishes `session.ended` on `match:session:{id}`. Collab
subscribes per room, takes a final snapshot, tears the room down and closes each
socket with code **4001** ([`05-collab.md`](05-collab.md) §6). Authorization
checks run once, at the door; a rule that has to hold for the whole life of a
connection cannot live only there, because something has to reach in and close
what is already open.

Publishing is fire-and-forget: a Redis hiccup must not fail the request, because
the durable record is the Postgres row either way. The consequence of a dropped
`session.ended` is a room that stays open until its last socket leaves, which is
the behaviour that existed before the channel was consumed at all.

**Ending twice keeps the first timestamp** (`WHERE ended_at IS NULL`), so both
people's summaries agree about when it finished.

### The column that arrived with a bug attached

`POST /match/join` uses "does this user already have a session?" as its
idempotence guard. The moment `ended_at` exists, that question has a second
meaning, and the old answer is wrong: a user who finished one session would be
handed that same dead session on every future join, forever, and could never be
matched with anyone again. The feature would have looked complete and quietly
broken re-matching for every user who used it.

The fix is one clause, `AND ended_at IS NULL` in `findActiveSessionForUser`, plus
a partial index per side of the pair. The test that guards it ends a session and
then asserts the same user can match into a different one.

Adding a state to a record changes the meaning of every query that already
filtered on that record. The bug is not in the new code; it is in the old code
that was correct until the state existed.

---

## 9. A session names nobody

No response from this service ever contains the other participant's uid. The
strongest form of that claim is not reading the code — it is being one
participant, touching every route a browser can reach, and searching the returned
bytes for anything belonging to the other one, which is what
[`reveal.test.ts`](../../services/matching/src/reveal.test.ts) does. It asserts
on serialised response bodies rather than named fields, so a uid reintroduced
under any name at any depth fails it.

Two payloads had to change to make it pass, and neither looked like an identity
leak:

- `partnerUid` rode on every session response. Only the match page used it, to
  print one line. Collab parsed it and dropped it.
- `reveal` returned `consented`, the list of uids that had agreed, so the moment
  your partner agreed you held their id.

This matters more than it looks because nothing else about a session carries an
identity a client could act on: awareness carries no identity, and the remote
caret is drawn in one colour precisely so no identity is needed to key it. A single
field in a JSON body undoes all of that silently, because nothing has to render
it for the browser to have been handed it.

### A name is not a uid, and the room shows one

`GET /match/sessions/:id/partner` answers with the other participant's display
name. That is a deliberate reversal of how the room felt, and deliberately *not*
a reversal of what §9 protects, because the two things were bundled under the
word "anonymous" and only one of them was about security:

- **The uid is what every other service keys on.** Handing it to a browser lets
  a client address, look up or impersonate somebody. It still never leaves.
- **The name identifies a person to their partner** and is useless for anything
  else. Showing it changes how a session feels and nothing about what a client
  can do.

So the existing assertion is unchanged and still passes: the uid is absent from
join, status, session and participant. The new route has its own test asserting
that the body contains the name and **not** the uid behind it, checked against
the serialised body for the same reason as above.

Two supporting decisions:

- **The name comes from the server, not from awareness.** Putting it in presence
  would have been less code and would have let any client claim to be anybody in
  the room. A name a peer asserts is a name a peer can forge, which is a worse
  property than the anonymity it replaced.
- **It is a separate route, not a field on the session.** `/match/status` is
  polled every three seconds while somebody waits (§5), so a name there would
  turn one call to Users into twenty a minute for a field nobody can see until
  they are in the room. Matching reaches Users on `/internal`, which the Gateway
  proxies nothing to, so a browser cannot ask that question directly
  ([`02-users.md`](02-users.md) §4).

---

## 10. Known gaps

- **A user queued for two topics at once can be matched twice.** The idempotence
  guard is per queue, so joining `(os, hard)` and then `(databases, easy)` leaves
  you waiting in both and two different people can each claim you. The fix is a
  `match:queued:<uid>` marker checked inside the same Lua script. It is not built
  because nothing in the product lets you join a second queue without leaving the
  first.
- **There is no leave-the-queue endpoint.** Stopping waiting leaves the entry,
  which the next joiner can still claim until it ages out a minute later.
  `queue.ts` has `join` and `isWaiting` and nothing to undo them, so the ttl is
  the only thing that ends a wait early.
- **CI does not orchestrate siblings for the contract tests.**
  `clients.test.ts` calls a real Users and Questions and passes locally; the
  per-service CI matrix brings up only Postgres and Redis, so those cases skip
  there ([`09-running-it.md`](09-running-it.md) §9).
