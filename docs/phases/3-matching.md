# Phase 3 — Matching

**What this phase proves** (DESIGN.md §10):

- two users who join with the same topic and difficulty get matched, and a session row exists for them
- a Users outage fails the join cleanly — no half-created queue entry or session, not a corrupted state

Every heading below links to the code it describes. Open the file alongside this
page — the comments in the source explain *what*, this document explains *why*
and how the pieces connect.

---

# The three things — read this page, then stop if you're short on time

## 1. The pair claim is the same race as phase 1's rate limiter · ~10 min

📄 [`queue.ts`](../../services/matching/src/queue.ts) · test at
[`queue.test.ts:84`](../../services/matching/src/queue.test.ts#L84)

**The failure:** two users join the same topic+difficulty queue at the same
instant, and it's empty. Both check "is anyone waiting?" at the same moment,
both see nobody, both add themselves. Nobody gets matched, or worse — two
different people both see the *same* third waiting user and both try to claim
them as a partner.

**The fix:** exactly phase 1's fix, applied to a different queue. Checking
"is someone waiting" and claiming them (or adding yourself) has to happen as
one atomic step, so a Lua script does the whole thing in one round trip to
Redis. Two concurrent join calls can't both see the same waiting partner,
because Redis finishes one script completely before starting the next.

**Say it as:** *"Two users racing for the same partner is the same shape of
bug as two Gateway instances racing the same rate-limit bucket — read, decide,
write, with a gap in the middle where another caller can act. The fix is
always the same: make the whole thing one atomic operation where the state
lives."*

## 2. External calls happen before anything is mutated · ~5 min

📄 [`index.ts:89-114`](../../services/matching/src/index.ts#L89)

**The failure:** join the queue first, *then* check whether the caller is a
real user. If that check fails — Users is down, say — the caller is stuck in
the queue with no way to know they're there, and whoever gets matched with
them will validate against a Users outage too.

**The mechanism:** `checkUserExists` and `findQuestion` both run — and both
have to succeed — before the join call touches Redis at all. If either one
fails, the route returns an error immediately and nothing has changed in
Redis or Postgres. There's no state to clean up because none was created.

**Say it as:** *"The way to fail cleanly isn't to add rollback logic after a
partial failure — it's to do every check that can fail before doing anything
that can't be undone."*

## 3. Joining twice is safe, on purpose · ~5 min

📄 [`index.ts:84-87`](../../services/matching/src/index.ts#L84) ·
[`repository.ts:36`](../../services/matching/src/repository.ts#L36)

**The failure:** a client's `POST /match/join` times out — maybe it actually
succeeded on the server and the response just got lost. The client retries.
If a retry could create a second session or a second queue entry, that
timeout just turned into a double-booked user.

**The mechanism:** every join call checks for an existing session *first*,
before touching the queue, and returns it if one exists. And the Lua script
itself is idempotent while queued — see queue.test.ts's idempotent-retry
test. Retrying is always safe, at every stage, which is what makes the
crash-recovery story in Part 4 work at all: a client that hasn't heard back
just calls `/match/join` again.

---

# Read the code in this order

| # | File | What it is |
|---|---|---|
| 1 | [`packages/db/migrations/006_matching_sessions.sql`](../../packages/db/migrations/006_matching_sessions.sql) | The session row. Start here. |
| 2 | [`services/matching/src/queue.ts`](../../services/matching/src/queue.ts) | The Lua claim script — the one idea worth the most time. |
| 3 | [`services/matching/src/clients.ts`](../../services/matching/src/clients.ts) | Typed calls to Users and Questions, the two internal dependencies. |
| 4 | [`services/matching/src/repository.ts`](../../services/matching/src/repository.ts) | Session persistence. |
| 5 | [`services/matching/src/index.ts`](../../services/matching/src/index.ts) | `POST /match/join`, `GET /match/status` — wires everything above together. |

---

# Part 1 — The session row

📄 [`packages/db/migrations/006_matching_sessions.sql`](../../packages/db/migrations/006_matching_sessions.sql)

```sql
CREATE TABLE IF NOT EXISTS matching.sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_uid    text NOT NULL,
  user_b_uid    text NOT NULL,
  question_id   uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

**No foreign keys into `users.profiles` or `questions.bank`** (ADR-09). Those
tables live in different Postgres schemas, owned by different services with
different roles — a cross-schema foreign key would re-couple two services
that are supposed to deploy independently. Instead, `user_a_uid`,
`user_b_uid`, and `question_id` are validated by an HTTP call at the moment a
session is created (Part 3), and never checked again after that.

**No `topic` or `difficulty` column, and no `status` column.** Topic and
difficulty are queue-time concerns — they decide which Redis queue a user
waits in, not anything that needs to outlive the match. And nothing in this
phase ends a session yet, so a `status` column would have no second value to
ever hold. Both are easy to add in a later migration once something actually
needs them — this repo's migrations are additive, never edited in place
(see phase 2's doc on `migrate.mjs` if that's unfamiliar).

---

# Part 2 — The queue and the claim

📄 [`services/matching/src/queue.ts`](../../services/matching/src/queue.ts)

## One sorted set per topic and difficulty

Each combination gets its own Redis key — `match:queue:os:hard`,
`match:queue:networking:easy`, and so on. "Filter by compatible topic and
difficulty" (DESIGN.md's phrasing for what Matching does on join) happens for
free this way: a user can only ever be matched with someone in the exact same
queue, because there's no other queue to look in.

**"Topic" here means a Questions tag, not a separate field.** Phase 2 already
decided Questions has no dedicated `topic` column — filtering is entirely
through `tags`, and a question's topic is just its first, most general tag.
Matching's `topic` request field is passed straight through as a tag filter
to Questions (Part 3), keeping the same vocabulary across both services
instead of inventing a second one.

## The script

→ [`queue.ts:3-30`](../../services/matching/src/queue.ts#L3)

```lua
local uid = ARGV[1]

if redis.call('ZSCORE', KEYS[1], uid) then
  return false
end

local waiting = redis.call('ZRANGE', KEYS[1], 0, 0)
if #waiting > 0 then
  local partner = waiting[1]
  redis.call('ZREM', KEYS[1], partner)
  return partner
end

local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000
redis.call('ZADD', KEYS[1], now, uid)
return false
```

Three cases, in order: already queued (a retried call) does nothing;
someone else waiting gets claimed and removed; otherwise the caller joins.
**The score comes from Redis' own clock** (`TIME`), not the caller's — the
same reasoning as the Gateway's rate limiter: two Matching instances have two
clocks that can disagree, and taking the timestamp from the one place the
queue actually lives keeps join order correct regardless.

**Why a script and not a Redis transaction (`MULTI`/`EXEC`)?** A transaction
queues commands blindly and runs them without looking at intermediate
results — it can't make "claim if someone's waiting, otherwise add myself" a
single decision, because that decision depends on what `ZRANGE` returns
*during* the operation. A Lua script can branch on that. This is the same
distinction phase 1's rate limiter makes for `INCR` vs. a multi-step token
bucket, one level further along the same spectrum.

The regression test for this is `queue.test.ts`'s concurrency test — 20 users
joining the same queue at once, and asserting exactly 10 pairs form with
nobody claimed twice.

---

# Part 3 — Talking to Users and Questions

📄 [`services/matching/src/clients.ts`](../../services/matching/src/clients.ts)

Two plain HTTP calls, each response parsed with zod:

```ts
checkUserExists(usersUrl, uid)       // GET /users/:uid/exists  -> boolean
findQuestion(questionsUrl, topic, difficulty)  // GET /questions?tags=...&difficulty=...  -> id | null
```

**The zod parsing is the contract test's engine.** §8 asks for contract
tests on the calls between services — Matching→Users and Matching→Questions
here — so that a response-shape change breaks CI instead of production. If
Users ever renamed `exists` to something else, `checkUserExists` would throw
immediately instead of quietly returning `undefined` and letting a bug
surface three steps later. `clients.test.ts` calls both services for real
(not mocked) and asserts the shapes match what `clients.ts` expects.

**What's not wired up yet:** these tests need Users and Questions actually
running, and currently that only happens locally against `docker compose up`
— CI's per-service matrix job builds and tests one service in isolation, so
it doesn't start Matching's two dependencies alongside it. The tests are
real and pass locally; extending CI to orchestrate multiple services for one
job's tests is future work, not done here.

---

# Part 4 — The routes

📄 [`services/matching/src/index.ts`](../../services/matching/src/index.ts)

## `POST /match/join`

```
POST /match/join { "topic": "os", "difficulty": "hard" }
```

In order: check for an existing session (Part 3 of the summary above) →
check the caller exists in Users → find a matching question in Questions →
run the Lua claim. If the claim finds a partner, create the session row and
respond `matched`; if not, the caller is now the one waiting, and the
response is `waiting`.

**Crash recovery, named explicitly rather than hidden.** The claim (Redis)
and the session row (Postgres) are two different systems with no transaction
spanning them. If Matching crashed between the two, a claimed partner would
be out of the queue with no session — stuck. DESIGN.md's answer, and the one
implemented here, is client-driven: a client that hasn't heard back within
about 10 seconds of joining calls `GET /match/status`. If that comes back
`none`, the client just calls `/match/join` again. Because joining is
idempotent at every stage (the three-things summary above), that retry can
never double-book anyone.

## `GET /match/status?topic=...&difficulty=...`

Answers one of three ways: `matched` (with the session, checked first,
straight from Postgres), `waiting` (still in the Redis queue), or `none`
(not in either — the signal to call `/match/join` again).

---

# Part 5 — What this phase deliberately did not build

- **No consent or reveal endpoint.** DESIGN.md says Matching "owns... the
  consent state behind the reveal rule," but nothing calls that yet — the
  reveal UI doesn't exist until phase 5. Building it now would mean guessing
  at the caller's needs; it's cheaper to add when there is one. *(Still true
  after phase 4: Collab shipped without needing it.)*
- **Nothing subscribes to the match-event pub/sub channel.** `index.ts`
  publishes to `match:session:{id}` on every match, per DESIGN.md's design,
  but no consumer exists in this phase. It's there so Collab or a future
  live-status channel has something to listen for without this route changing
  later. *(Phase 4 update: Collab turned out not to need it — a client learns
  its session id from `/match/join` and brings it to the socket. The channel
  is now waiting on phase 5's live status instead.)*
- **No session-ending flow.** Nothing sets a session to "ended," because
  nothing needs to yet. *(Phase 4 update: people can now edit, so this is the
  first deferred item here with a real caller waiting — a session ends when
  phase 5 gives someone a button to end it.)*
- **A user queued for two topics at once can be matched twice.** The
  idempotence guard is per queue, so joining `(os,hard)` and then `(db,easy)`
  leaves you waiting in both, and two different people can each claim you. The
  fix is a `match:queued:<uid>` marker checked inside the same Lua script; it
  is not built because nothing in the product yet lets you join a second queue
  without leaving the first.
- **CI doesn't orchestrate Users + Questions for Matching's contract
  tests.** See Part 3 — they run and pass locally, not yet in the per-service
  CI matrix.
- **`emitEvent` is a log line, not a real event pipeline**, same as phase
  1's `user.signed_up`. `queue.joined` and `match.created` are logged now;
  phase 7 puts them behind the real `EventLog` interface.

---

# Part 6 — Demonstrating the two claims

```bash
docker compose up -d --build
```

## Get tokens for three users

Three, not two: claim 2 needs somebody who has not already been matched.

```bash
sign_up() {
  curl -s -X POST "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"password123\",\"returnSecureToken\":true}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["idToken"])'
}
TOKEN_A=$(sign_up alice@example.com)
TOKEN_B=$(sign_up bob@example.com)
TOKEN_C=$(sign_up carol@example.com)
```

Register all three first, same as phase 1's demo — `/match/join` checks the
caller exists in Users before it touches the queue:

```bash
for T in "$TOKEN_A" "$TOKEN_B" "$TOKEN_C"; do
  curl -s -H "Authorization: Bearer $T" http://localhost:8080/users/me
done
```

## Claim 1 — two users join, get matched, session exists

```bash
curl -s -X POST http://localhost:8080/match/join \
  -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"topic":"os","difficulty":"hard"}'
# {"status":"waiting"}

curl -s -X POST http://localhost:8080/match/join \
  -H "Authorization: Bearer $TOKEN_B" -H 'Content-Type: application/json' \
  -d '{"topic":"os","difficulty":"hard"}'
# {"status":"matched","session":{"id":"...","questionId":"...","partnerUid":"<alice's uid>"}}
```

Confirm from Alice's side too — same session id, `partnerUid` is Bob's:

```bash
curl -s "http://localhost:8080/match/status?topic=os&difficulty=hard" -H "Authorization: Bearer $TOKEN_A"
```

## Claim 2 — a Users outage fails cleanly

```bash
docker compose stop users

curl -si -X POST http://localhost:8080/match/join \
  -H "Authorization: Bearer $TOKEN_C" -H 'Content-Type: application/json' \
  -d '{"topic":"networking","difficulty":"easy"}'
# 503, {"error":"users service unavailable"}

docker compose exec redis redis-cli ZRANGE match:queue:networking:easy 0 -1
# empty — nothing was left half-created

docker compose start users
```

## Running the tests yourself

```bash
export DATABASE_URL=postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs
export MATCHING_DATABASE_URL=postgresql://matching_svc:matching_svc@127.0.0.1:5432/deepcs
export REDIS_URL=redis://127.0.0.1:6379
export USERS_URL=http://127.0.0.1:8081
export QUESTIONS_URL=http://127.0.0.1:8082
pnpm --filter @deepcs/matching test
```

Real Postgres, Redis, Users, and Questions — never mocks (§8). The claim
script's atomicity, the schema boundary, and the Users/Questions response
shapes are all real-system properties; a mock would only prove itself
self-consistent.
